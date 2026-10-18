/* 古诗文背诵学习系统 —— 本地数据存储
   纯静态站点没有后端账户，学习和错题数据全部保存在 localStorage。
   这里对损坏 / 禁用 / 配额异常做了容错，保证任何情况下页面都能打开。

   v2 起：
   - 错题不再只记到“篇目”，而是记到「篇目 + 句子下标 + 题型」的题目级（wrongItems），
     wrongBook 是由 wrongItems 汇总出来的篇目级视图，兼容旧的篇目级数据；
   - 每篇增加复习计划 review（下次复习日 + 等级），用于“今日复习”；
   - 新增按题型统计 byMode 与阅读偏好（字号 / 译文 / 专注模式）；
   - 支持学习数据导出 / 导入，全部仍是本机数据。 */
(function (global) {
  'use strict';

  var Utils = global.PoetryUtils;
  var STORAGE_KEY = 'ruishao-poetry-study-v1';
  var SCHEMA_VERSION = 2;
  var DAILY_LIMIT = 60;
  var RECENT_LIMIT = 20;
  var WRONG_LIMIT = 200;
  var WRONG_ITEM_LIMIT = 500;

  /* 合法题型白名单（与 js/quiz.js 的 MODES 保持一致，unit test 会校验两者相等）。
     非法值必须被丢弃：空数组按现有设计表示“随机组合”。 */
  var MODE_KEYS = ['blank-full', 'next', 'prev', 'keyword', 'mixed', 'full', 'translation'];

  /* 复习间隔（天）：答对升一级，答错回到第 1 天。 */
  var SRS_STEPS = [1, 2, 4, 7, 15, 30];
  var SRS_MAX_LEVEL = SRS_STEPS.length;

  /* 页面 UI 只提供这四档题量；localStorage 里的其它数值一律吸附到最近的档位，
     避免出现“没有任何 chip 处于选中态”的不可见状态。 */
  var QUIZ_COUNT_OPTIONS = [5, 10, 20, 30];
  var QUIZ_COUNT_MIN = 1;
  var QUIZ_COUNT_MAX = 60;

  var FONT_SCALES = [0, 1, 2];

  var memoryFallback = null; // localStorage 不可用时退化为内存存储

  function defaults() {
    return {
      version: SCHEMA_VERSION,
      stage: '',              // 最近选择的学习阶段
      selectedIds: [],        // 已选择篇目
      learnedIds: {},         // 已学习篇目 { id: timestamp }
      recents: [],            // 最近学习篇目 [{ id, time }]
      quizStats: {
        total: 0,
        correct: 0,
        wrong: 0,
        byPoem: {},           // { id: { total, correct, wrong, lastTime } }
        byMode: {},           // { mode: { total, correct, wrong } }
      },
      wrongItems: [],         // 题目级错题 [{ key, poemId, mode, index, pairIndex, time, count }]
      wrongBook: [],          // 篇目级汇总（由 wrongItems 派生，保留给旧 UI / 旧数据）
      review: {},             // { id: { level, due, lastTime } }
      daily: {},              // { '2026-09-12': { quiz, correct } }
      prefs: {
        quizCount: 10,
        modes: [],            // 空数组表示“随机组合”
        autoNext: false,
        hideKeywords: false,
        fontScale: 1,         // 0 小 / 1 中 / 2 大
        showTranslation: true,
        focusMode: false,
      },
    };
  }

  function getRaw() {
    if (memoryFallback) return memoryFallback;
    try {
      return global.localStorage.getItem(STORAGE_KEY);
    } catch (err) {
      return null;
    }
  }

  function setRaw(value) {
    try {
      global.localStorage.setItem(STORAGE_KEY, value);
      memoryFallback = null;
      return true;
    } catch (err) {
      // 隐私模式 / 配额满：退化成内存存储，保证本次会话可用
      memoryFallback = value;
      return false;
    }
  }

  function toStringArray(value) {
    return Utils.toArray(value).filter(function (item) {
      return typeof item === 'string' && item;
    });
  }

  function toNumber(value) {
    var n = Number(value);
    return isFinite(n) && n > 0 ? n : 0;
  }

  /** 计数值：非负整数（小数向下取整，负数 / NaN / Infinity → 0） */
  function toCount(value) {
    var n = Number(value);
    if (!isFinite(n) || n <= 0) return 0;
    return Math.floor(n);
  }

  function normalizeMode(value) {
    return typeof value === 'string' && MODE_KEYS.indexOf(value) !== -1 ? value : '';
  }

  /**
   * 统计项业务不变量：correct + wrong === total（两者都是非负整数）。
   * 数据损坏时不猜 total，而是以“对 / 错”两个细粒度计数为准重建 total，
   * 这样正确率永远不可能超过 100%。
   */
  function normalizeStats(item) {
    item.correct = toCount(item.correct);
    item.wrong = toCount(item.wrong);
    item.total = item.correct + item.wrong;
    return item;
  }

  /** 题量规范化：非法值回落到默认 10，合法值吸附到 UI 提供的档位 */
  function normalizeQuizCount(value) {
    var n = Number(value);
    if (!isFinite(n) || n <= 0) return 10;
    n = Utils.clamp(Math.round(n), QUIZ_COUNT_MIN, QUIZ_COUNT_MAX);
    var best = QUIZ_COUNT_OPTIONS[0];
    var bestGap = Math.abs(n - best);
    for (var i = 1; i < QUIZ_COUNT_OPTIONS.length; i += 1) {
      var gap = Math.abs(n - QUIZ_COUNT_OPTIONS[i]);
      if (gap < bestGap) {
        best = QUIZ_COUNT_OPTIONS[i];
        bestGap = gap;
      }
    }
    return best;
  }

  function normalizeFontScale(value) {
    var n = Number(value);
    if (!isFinite(n)) return 1;
    n = Math.round(n);
    if (FONT_SCALES.indexOf(n) === -1) {
      return n <= 0 ? 0 : n >= 2 ? 2 : 1;
    }
    return n;
  }

  function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  /** 把题目级错题统一成安全结构；没有 poemId 或 key 的记录直接丢弃 */
  function normalizeWrongItem(raw) {
    if (!isPlainObject(raw)) return null;
    var poemId = typeof raw.poemId === 'string' && raw.poemId
      ? raw.poemId
      : (typeof raw.id === 'string' ? raw.id : '');
    var key = typeof raw.key === 'string' ? raw.key.trim() : '';
    if (!poemId || !key) return null;
    var index = Number.isInteger(raw.index) && raw.index >= 0 ? raw.index : null;
    var pairIndex = Number.isInteger(raw.pairIndex) && raw.pairIndex >= 0 ? raw.pairIndex : null;
    return {
      key: key,
      poemId: poemId,
      mode: normalizeMode(raw.mode),
      index: index,
      pairIndex: pairIndex,
      time: toNumber(raw.time) || Date.now(),
      count: toCount(raw.count) || 1,
    };
  }

  /** 旧版 wrongBook（篇目级）迁移成一条 key=legacy|id 的题目级记录，保留历史不丢 */
  function legacyWrongItems(rawBook) {
    var out = [];
    var seen = Object.create(null);
    Utils.toArray(rawBook).forEach(function (item) {
      if (!isPlainObject(item) || typeof item.id !== 'string' || !item.id) return;
      var key = 'legacy|' + item.id;
      if (seen[key]) return;
      seen[key] = true;
      out.push({
        key: key,
        poemId: item.id,
        mode: normalizeMode(item.mode),
        index: null,
        pairIndex: null,
        time: toNumber(item.time) || Date.now(),
        count: toCount(item.count) || 1,
      });
    });
    return out;
  }

  /** wrongItems -> 篇目级汇总，保证 UI 只读 wrongBook 也能工作 */
  function syncWrongBook(target) {
    var data = target || state;
    var map = Object.create(null);
    Utils.toArray(data.wrongItems).forEach(function (item) {
      var row = map[item.poemId];
      if (!row) {
        row = { id: item.poemId, time: 0, count: 0, mode: '', items: 0 };
        map[item.poemId] = row;
      }
      row.count += item.count;
      row.items += 1;
      if (item.time >= row.time) {
        row.time = item.time;
        if (item.mode) row.mode = item.mode;
      }
    });
    data.wrongBook = Object.keys(map)
      .map(function (id) {
        return map[id];
      })
      .sort(function (a, b) {
        return b.time - a.time;
      })
      .slice(0, WRONG_LIMIT);
    return data.wrongBook;
  }

  /** 把任意（可能损坏的）数据整理成合法状态 */
  function sanitize(raw) {
    var base = defaults();
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;

    base.stage = raw.stage === '初中' || raw.stage === '高中' ? raw.stage : '';
    base.selectedIds = Utils.unique(toStringArray(raw.selectedIds));

    if (isPlainObject(raw.learnedIds)) {
      Object.keys(raw.learnedIds).forEach(function (id) {
        if (typeof id === 'string' && id) base.learnedIds[id] = toNumber(raw.learnedIds[id]) || Date.now();
      });
    }

    if (Array.isArray(raw.recents)) {
      var recents = raw.recents
        .filter(function (item) {
          return item && typeof item === 'object' && typeof item.id === 'string';
        })
        .map(function (item) {
          return { id: item.id, time: toNumber(item.time) };
        });
      // 同一篇目只保留最近一次，并按时间倒序（“最近学习”必须有确定顺序）
      var recentSeen = Object.create(null);
      base.recents = recents
        .sort(function (a, b) {
          return b.time - a.time;
        })
        .filter(function (item) {
          if (!item.id || recentSeen[item.id]) return false;
          recentSeen[item.id] = true;
          return true;
        })
        .slice(0, RECENT_LIMIT);
    }

    var stats = raw.quizStats;
    if (isPlainObject(stats)) {
      base.quizStats.total = toCount(stats.total);
      base.quizStats.correct = toCount(stats.correct);
      base.quizStats.wrong = toCount(stats.wrong);
      normalizeStats(base.quizStats);
      if (isPlainObject(stats.byPoem)) {
        Object.keys(stats.byPoem).forEach(function (id) {
          var item = stats.byPoem[id];
          if (!id || !isPlainObject(item)) return;
          base.quizStats.byPoem[id] = normalizeStats({
            total: toCount(item.total),
            correct: toCount(item.correct),
            wrong: toCount(item.wrong),
            lastTime: toNumber(item.lastTime),
          });
        });
      }
      if (isPlainObject(stats.byMode)) {
        Object.keys(stats.byMode).forEach(function (mode) {
          var item = stats.byMode[mode];
          var safeMode = normalizeMode(mode);
          if (!safeMode || !isPlainObject(item)) return;
          base.quizStats.byMode[safeMode] = normalizeStats({
            total: toCount(item.total),
            correct: toCount(item.correct),
            wrong: toCount(item.wrong),
          });
        });
      }
    }

    /* 题目级错题：优先读 wrongItems；没有时把旧 wrongBook 迁移过来。
       同一 key 只保留第一条，按最近时间倒序。 */
    var rawItems = Array.isArray(raw.wrongItems) ? raw.wrongItems : null;
    var items = rawItems ? rawItems.map(normalizeWrongItem).filter(Boolean) : legacyWrongItems(raw.wrongBook);
    var itemSeen = Object.create(null);
    base.wrongItems = items
      .sort(function (a, b) {
        return b.time - a.time;
      })
      .filter(function (item) {
        if (itemSeen[item.key]) return false;
        itemSeen[item.key] = true;
        return true;
      })
      .slice(0, WRONG_ITEM_LIMIT);
    syncWrongBook(base);

    if (isPlainObject(raw.review)) {
      Object.keys(raw.review).forEach(function (id) {
        var item = raw.review[id];
        if (!id || !isPlainObject(item)) return;
        var level = Number.isInteger(item.level) ? Utils.clamp(item.level, 0, SRS_MAX_LEVEL) : 0;
        var due = Utils.isValidDayKey(item.due) ? String(item.due).trim() : '';
        base.review[id] = {
          level: level,
          due: due,
          lastTime: toNumber(item.lastTime),
        };
      });
    }

    if (isPlainObject(raw.daily)) {
      // 只认合法日期键（非法 / 空 / 明显不合理的日期直接丢弃），按日期升序后取最近 60 天
      Utils.sortDayKeys(Object.keys(raw.daily)).slice(-DAILY_LIMIT).forEach(function (day) {
        var item = raw.daily[day];
        if (!item || typeof item !== 'object') return;
        var quiz = toCount(item.quiz);
        base.daily[day] = { quiz: quiz, correct: Utils.clamp(toCount(item.correct), 0, quiz) };
      });
    }

    if (isPlainObject(raw.prefs)) {
      base.prefs.quizCount = normalizeQuizCount(raw.prefs.quizCount);
      base.prefs.modes = Utils.unique(
        toStringArray(raw.prefs.modes).filter(function (key) {
          return MODE_KEYS.indexOf(key) !== -1;
        })
      );
      base.prefs.autoNext = !!raw.prefs.autoNext;
      base.prefs.hideKeywords = !!raw.prefs.hideKeywords;
      base.prefs.fontScale = normalizeFontScale(raw.prefs.fontScale);
      base.prefs.showTranslation = raw.prefs.showTranslation !== false;
      base.prefs.focusMode = !!raw.prefs.focusMode;
    }

    return base;
  }

  /**
   * 校验一份数据是否满足 schema 与业务不变量（sanitize 之后必须返回空数组）。
   * 供测试与自检使用，不参与正常页面流程。
   */
  function validate(target) {
    var issues = [];
    var data = target || {};
    if (!isPlainObject(data)) return ['state 不是对象'];
    if (data.version !== SCHEMA_VERSION) issues.push('version 非法: ' + data.version);
    if (data.stage !== '' && data.stage !== '初中' && data.stage !== '高中') issues.push('stage 非法: ' + data.stage);
    if (!Array.isArray(data.selectedIds)) issues.push('selectedIds 不是数组');
    else {
      if (data.selectedIds.some(function (id) { return typeof id !== 'string' || !id; })) issues.push('selectedIds 含非法元素');
      if (Utils.unique(data.selectedIds).length !== data.selectedIds.length) issues.push('selectedIds 有重复');
    }
    if (!isPlainObject(data.learnedIds)) issues.push('learnedIds 不是对象');
    else {
      Object.keys(data.learnedIds).forEach(function (id) {
        if (typeof data.learnedIds[id] !== 'number' || !isFinite(data.learnedIds[id]) || data.learnedIds[id] <= 0) {
          issues.push('learnedIds[' + id + '] 时间戳非法');
        }
      });
    }
    if (!Array.isArray(data.recents)) issues.push('recents 不是数组');
    if (!isPlainObject(data.quizStats)) issues.push('quizStats 不是对象');
    else {
      var stats = data.quizStats;
      ['total', 'correct', 'wrong'].forEach(function (key) {
        if (!Number.isInteger(stats[key]) || stats[key] < 0) issues.push('quizStats.' + key + ' 非法: ' + stats[key]);
      });
      if (stats.correct + stats.wrong !== stats.total) {
        issues.push('quizStats 不满足 correct + wrong === total（' + stats.correct + '+' + stats.wrong + '≠' + stats.total + '）');
      }
      if (!isPlainObject(stats.byPoem)) issues.push('quizStats.byPoem 不是对象');
      else {
        Object.keys(stats.byPoem).forEach(function (id) {
          var item = stats.byPoem[id];
          if (!isPlainObject(item)) { issues.push('quizStats.byPoem[' + id + '] 不是对象'); return; }
          if (item.correct + item.wrong !== item.total) issues.push('byPoem[' + id + '] 不满足 correct + wrong === total');
          if (item.total > 0 && item.correct / item.total > 1) issues.push('byPoem[' + id + '] 正确率超过 100%');
        });
      }
      if (!isPlainObject(stats.byMode)) issues.push('quizStats.byMode 不是对象');
      else {
        Object.keys(stats.byMode).forEach(function (mode) {
          var item = stats.byMode[mode];
          if (MODE_KEYS.indexOf(mode) === -1) issues.push('byMode 含非法题型: ' + mode);
          if (!isPlainObject(item)) { issues.push('byMode[' + mode + '] 不是对象'); return; }
          if (item.correct + item.wrong !== item.total) issues.push('byMode[' + mode + '] 不满足 correct + wrong === total');
        });
      }
      if (stats.total > 0 && stats.correct / stats.total > 1) issues.push('整体正确率超过 100%');
    }
    if (!Array.isArray(data.wrongItems)) issues.push('wrongItems 不是数组');
    else {
      var keys = Object.create(null);
      data.wrongItems.forEach(function (item, i) {
        if (!isPlainObject(item)) { issues.push('wrongItems[' + i + '] 不是对象'); return; }
        if (typeof item.key !== 'string' || !item.key) issues.push('wrongItems[' + i + '].key 非法');
        else if (keys[item.key]) issues.push('wrongItems key 重复: ' + item.key);
        else keys[item.key] = true;
        if (typeof item.poemId !== 'string' || !item.poemId) issues.push('wrongItems[' + i + '].poemId 非法');
        if (item.mode && MODE_KEYS.indexOf(item.mode) === -1) issues.push('wrongItems[' + i + '].mode 非法: ' + item.mode);
        if (item.index !== null && (!Number.isInteger(item.index) || item.index < 0)) issues.push('wrongItems[' + i + '].index 非法');
        if (item.pairIndex !== null && (!Number.isInteger(item.pairIndex) || item.pairIndex < 0)) issues.push('wrongItems[' + i + '].pairIndex 非法');
        if (!Number.isInteger(item.count) || item.count < 1) issues.push('wrongItems[' + i + '].count 非法');
      });
    }
    if (!Array.isArray(data.wrongBook)) issues.push('wrongBook 不是数组');
    else {
      var expected = Object.create(null);
      Utils.toArray(data.wrongItems).forEach(function (item) {
        expected[item.poemId] = (expected[item.poemId] || 0) + item.count;
      });
      data.wrongBook.forEach(function (item) {
        if (!isPlainObject(item) || typeof item.id !== 'string' || !item.id) { issues.push('wrongBook 含非法 id'); return; }
        if (!Number.isInteger(item.count) || item.count < 1) issues.push('wrongBook.count 非法');
        if (expected[item.id] !== item.count) issues.push('wrongBook[' + item.id + '] 与 wrongItems 汇总不一致');
      });
    }
    if (!isPlainObject(data.review)) issues.push('review 不是对象');
    else {
      Object.keys(data.review).forEach(function (id) {
        var item = data.review[id];
        if (!isPlainObject(item)) { issues.push('review[' + id + '] 不是对象'); return; }
        if (!Number.isInteger(item.level) || item.level < 0 || item.level > SRS_MAX_LEVEL) issues.push('review[' + id + '].level 非法');
        if (item.due !== '' && !Utils.isValidDayKey(item.due)) issues.push('review[' + id + '].due 非法: ' + item.due);
      });
    }
    if (!isPlainObject(data.daily)) issues.push('daily 不是对象');
    else {
      Object.keys(data.daily).forEach(function (day) {
        if (!Utils.isValidDayKey(day)) issues.push('daily 日期键非法: ' + day);
        var item = data.daily[day];
        if (!isPlainObject(item)) { issues.push('daily[' + day + '] 不是对象'); return; }
        if (!Number.isInteger(item.quiz) || item.quiz < 0) issues.push('daily[' + day + '].quiz 非法');
        if (!Number.isInteger(item.correct) || item.correct < 0 || item.correct > item.quiz) issues.push('daily[' + day + '].correct 非法');
      });
    }
    if (!isPlainObject(data.prefs)) issues.push('prefs 不是对象');
    else {
      if (QUIZ_COUNT_OPTIONS.indexOf(data.prefs.quizCount) === -1) issues.push('prefs.quizCount 非法: ' + data.prefs.quizCount);
      if (!Array.isArray(data.prefs.modes)) issues.push('prefs.modes 不是数组');
      else if (data.prefs.modes.some(function (key) { return MODE_KEYS.indexOf(key) === -1; })) issues.push('prefs.modes 含非法题型');
      if (FONT_SCALES.indexOf(data.prefs.fontScale) === -1) issues.push('prefs.fontScale 非法: ' + data.prefs.fontScale);
      if (typeof data.prefs.showTranslation !== 'boolean') issues.push('prefs.showTranslation 非法');
      if (typeof data.prefs.focusMode !== 'boolean') issues.push('prefs.focusMode 非法');
    }
    return issues;
  }

  /**
   * 清理数据库中已经不存在的“幽灵 ID”（题库升级 / 换设备合并数据后可能残留）。
   * 返回清理条数；默认写入模块内 state，也可传入自定义对象（测试用）。
   */
  function pruneUnknownIds(target, allowedIds) {
    var data = target || state;
    var ids = allowedIds;
    if (!ids) {
      if (!global.PoetryDatabase || typeof global.PoetryDatabase.all !== 'function') return 0;
      ids = global.PoetryDatabase.all().map(function (poem) {
        return poem.id;
      });
    }
    var allowed = Object.create(null);
    Utils.toArray(ids).forEach(function (id) {
      allowed[id] = true;
    });
    var removed = 0;

    data.selectedIds = Utils.toArray(data.selectedIds).filter(function (id) {
      if (allowed[id]) return true;
      removed += 1;
      return false;
    });
    Object.keys(data.learnedIds || {}).forEach(function (id) {
      if (!allowed[id]) {
        delete data.learnedIds[id];
        removed += 1;
      }
    });
    data.recents = Utils.toArray(data.recents).filter(function (item) {
      if (item && allowed[item.id]) return true;
      removed += 1;
      return false;
    });
    Object.keys(data.quizStats && data.quizStats.byPoem ? data.quizStats.byPoem : {}).forEach(function (id) {
      if (!allowed[id]) {
        delete data.quizStats.byPoem[id];
        removed += 1;
      }
    });
    data.wrongItems = Utils.toArray(data.wrongItems).filter(function (item) {
      if (item && allowed[item.poemId]) return true;
      removed += 1;
      return false;
    });
    Object.keys(data.review || {}).forEach(function (id) {
      if (!allowed[id]) {
        delete data.review[id];
        removed += 1;
      }
    });
    syncWrongBook(data);
    return removed;
  }

  var state = defaults();
  var loadIssue = '';

  function load() {
    var raw = getRaw();
    if (raw == null) {
      state = defaults();
      return state;
    }
    try {
      var parsed = JSON.parse(raw);
      state = sanitize(parsed);
    } catch (err) {
      loadIssue = '本地数据格式异常，已自动重置学习记录。';
      state = defaults();
      setRaw(JSON.stringify(state));
      return state;
    }
    var removed = pruneUnknownIds(state);
    if (removed) loadIssue = '已清理 ' + removed + ' 条题库中不存在的本地记录。';
    var normalized = JSON.stringify(state);
    if (normalized !== raw) setRaw(normalized); // 把修正后的安全状态写回，避免错误数据反复进入系统
    return state;
  }

  function save() {
    state.version = SCHEMA_VERSION;
    syncWrongBook(state);
    return setRaw(JSON.stringify(state));
  }

  function patch(partial) {
    if (partial && typeof partial === 'object') {
      Object.keys(partial).forEach(function (key) {
        state[key] = partial[key];
      });
    }
    // 合并后重新走一遍 schema / 业务校验，避免非法数据直接落盘
    state = sanitize(state);
    syncWrongBook(state);
    save();
    return state;
  }

  /** 只改偏好：合并 prefs，避免调用方每次都手写整份 prefs 丢字段 */
  function updatePrefs(partial) {
    var next = {};
    Object.keys(state.prefs || {}).forEach(function (key) {
      next[key] = state.prefs[key];
    });
    if (partial && typeof partial === 'object') {
      Object.keys(partial).forEach(function (key) {
        next[key] = partial[key];
      });
    }
    state.prefs = next;
    state = sanitize(state);
    syncWrongBook(state);
    save();
    return state.prefs;
  }

  function reset() {
    state = defaults();
    try {
      global.localStorage.removeItem(STORAGE_KEY);
    } catch (err) {
      /* 忽略：内存模式 */
    }
    memoryFallback = null;
    save();
    return state;
  }

  function getState() {
    return state;
  }

  function touchRecent(poemId) {
    if (!poemId) return;
    var list = state.recents.filter(function (item) {
      return item.id !== poemId;
    });
    list.unshift({ id: poemId, time: Date.now() });
    state.recents = list.slice(0, RECENT_LIMIT);
  }

  function scheduleReview(poemId, isCorrect) {
    if (!poemId) return;
    var today = Utils.todayKey();
    var info = state.review[poemId] || { level: 0, due: '', lastTime: 0 };
    if (isCorrect) {
      /* 同一篇目同一天只升一级，避免一组 10 道题把复习间隔一口气推到 30 天 */
      var lastDay = info.lastTime ? Utils.todayKey(new Date(info.lastTime)) : '';
      if (lastDay === today) {
        info.lastTime = Date.now();
        state.review[poemId] = info;
        return;
      }
      info.level = Utils.clamp((info.level || 0) + 1, 0, SRS_MAX_LEVEL);
      var step = SRS_STEPS[Math.max(0, info.level - 1)];
      info.due = Utils.addDaysKey(today, step || SRS_STEPS[0]);
    } else {
      info.level = 0;
      info.due = Utils.addDaysKey(today, SRS_STEPS[0]);
    }
    info.lastTime = Date.now();
    state.review[poemId] = info;
  }

  function markLearned(poemId) {
    if (!poemId) return state;
    state.learnedIds[poemId] = Date.now();
    if (!state.review[poemId]) {
      state.review[poemId] = {
        level: 0,
        due: Utils.addDaysKey(Utils.todayKey(), SRS_STEPS[0]),
        lastTime: Date.now(),
      };
    }
    touchRecent(poemId);
    save();
    return state;
  }

  /** 手动加入错题（没有题目 key 时写一条篇目级 legacy 记录） */
  function addWrong(poemId, mode, silent, meta) {
    if (!poemId) return state;
    if (meta && typeof meta.key === 'string' && meta.key) {
      return addWrongItem({
        key: meta.key,
        poemId: poemId,
        mode: mode,
        index: meta.index,
        pairIndex: meta.pairIndex,
      }, silent);
    }
    var safeMode = normalizeMode(mode);
    var key = 'legacy|' + poemId;
    var found = null;
    state.wrongItems.forEach(function (item) {
      if (item.key === key) found = item;
    });
    if (found) {
      found.count += 1;
      found.time = Date.now();
      if (safeMode) found.mode = safeMode;
    } else {
      state.wrongItems.unshift({
        key: key,
        poemId: poemId,
        mode: safeMode,
        index: null,
        pairIndex: null,
        time: Date.now(),
        count: 1,
      });
    }
    state.wrongItems = state.wrongItems.slice(0, WRONG_ITEM_LIMIT);
    syncWrongBook(state);
    if (!silent) save();
    return state;
  }

  /** 加入一条题目级错题（同一题重复答错累加 count） */
  function addWrongItem(info, silent) {
    if (!info || typeof info.poemId !== 'string' || !info.poemId) return state;
    var key = typeof info.key === 'string' ? info.key.trim() : '';
    if (!key) return state;
    var safeMode = normalizeMode(info.mode);
    var found = null;
    state.wrongItems.forEach(function (item) {
      if (item.key === key) found = item;
    });
    if (found) {
      found.count += 1;
      found.time = Date.now();
      if (safeMode) found.mode = safeMode;
      if (Number.isInteger(info.index)) found.index = info.index;
      if (Number.isInteger(info.pairIndex)) found.pairIndex = info.pairIndex;
    } else {
      state.wrongItems.unshift({
        key: key,
        poemId: info.poemId,
        mode: safeMode,
        index: Number.isInteger(info.index) ? info.index : null,
        pairIndex: Number.isInteger(info.pairIndex) ? info.pairIndex : null,
        time: Date.now(),
        count: 1,
      });
    }
    state.wrongItems = state.wrongItems.slice(0, WRONG_ITEM_LIMIT);
    syncWrongBook(state);
    if (!silent) save();
    return state;
  }

  function removeWrong(poemId, silent) {
    state.wrongItems = state.wrongItems.filter(function (item) {
      return item.poemId !== poemId;
    });
    syncWrongBook(state);
    if (!silent) save();
    return state;
  }

  function removeWrongItem(key, silent) {
    if (!key) return state;
    state.wrongItems = state.wrongItems.filter(function (item) {
      return item.key !== key;
    });
    syncWrongBook(state);
    if (!silent) save();
    return state;
  }

  function recordQuiz(poemId, isCorrect, mode, meta) {
    var day = Utils.todayKey();
    if (!state.daily[day]) state.daily[day] = { quiz: 0, correct: 0 };
    state.daily[day].quiz += 1;
    if (isCorrect) state.daily[day].correct += 1;
    // daily 只保留最近 60 天，避免长时间使用后无限增长
    Utils.sortDayKeys(Object.keys(state.daily)).slice(0, -DAILY_LIMIT).forEach(function (oldDay) {
      delete state.daily[oldDay];
    });

    state.quizStats.total += 1;
    if (isCorrect) state.quizStats.correct += 1;
    else state.quizStats.wrong += 1;

    var safeMode = normalizeMode(mode);
    if (safeMode) {
      var modeItem = state.quizStats.byMode[safeMode] || { total: 0, correct: 0, wrong: 0 };
      modeItem.total += 1;
      if (isCorrect) modeItem.correct += 1;
      else modeItem.wrong += 1;
      state.quizStats.byMode[safeMode] = modeItem;
    }

    if (poemId) {
      var item = state.quizStats.byPoem[poemId] || { total: 0, correct: 0, wrong: 0, lastTime: 0 };
      item.total += 1;
      if (isCorrect) item.correct += 1;
      else item.wrong += 1;
      item.lastTime = Date.now();
      state.quizStats.byPoem[poemId] = item;
      touchRecent(poemId);

      /* 题目级：答对只移除这一题；旧调用 / 旧数据没有 key 时保持整篇移除。 */
      if (isCorrect) {
        if (meta && typeof meta.key === 'string' && meta.key) removeWrongItem(meta.key, true);
        else removeWrong(poemId, true);
      } else if (meta && typeof meta.key === 'string' && meta.key) {
        addWrongItem({
          key: meta.key,
          poemId: poemId,
          mode: safeMode,
          index: meta.index,
          pairIndex: meta.pairIndex,
        }, true);
      } else {
        addWrong(poemId, safeMode, true);
      }
      scheduleReview(poemId, isCorrect);
    }
    save();
    return state;
  }

  function todayStats() {
    var day = Utils.todayKey();
    return state.daily[day] || { quiz: 0, correct: 0 };
  }

  function wrongItemsForPoem(poemId) {
    return state.wrongItems.filter(function (item) {
      return item.poemId === poemId;
    });
  }

  function wrongItemKeysForPoems(ids) {
    var allowed = Object.create(null);
    Utils.toArray(ids).forEach(function (id) {
      allowed[id] = true;
    });
    return state.wrongItems
      .filter(function (item) {
        return allowed[item.poemId] && item.key.indexOf('legacy|') !== 0;
      })
      .map(function (item) {
        return item.key;
      });
  }

  function duePoemIds(day) {
    var today = Utils.todayKey(day);
    return Object.keys(state.review)
      .filter(function (id) {
        var item = state.review[id];
        return item && Utils.isDueDay(item.due, today);
      })
      .sort(function (a, b) {
        var da = state.review[a].due || '';
        var db = state.review[b].due || '';
        if (da !== db) return da < db ? -1 : 1;
        return a < b ? -1 : a > b ? 1 : 0;
      });
  }

  function reviewFor(poemId) {
    return state.review[poemId] || null;
  }

  /** 导出学习数据（纯本地文件，不上传） */
  function exportData() {
    return {
      app: 'hison-poetry-recite',
      version: (global.PoetryMeta && global.PoetryMeta.version) || '',
      schema: SCHEMA_VERSION,
      exportedAt: Date.now(),
      state: JSON.parse(JSON.stringify(state)),
    };
  }

  /** 导入学习数据：先 sanitize / prune，再整体替换本机数据；返回 { ok, error } */
  function importData(payload) {
    var raw = payload && typeof payload === 'object' && payload.state ? payload.state : payload;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { ok: false, error: '文件里没有可识别的学习数据。' };
    }
    var next = sanitize(raw);
    pruneUnknownIds(next);
    state = next;
    save();
    return { ok: true, state: state };
  }

  global.PoetryStorage = {
    KEY: STORAGE_KEY,
    MODE_KEYS: MODE_KEYS,
    QUIZ_COUNT_OPTIONS: QUIZ_COUNT_OPTIONS,
    SRS_STEPS: SRS_STEPS,
    defaults: defaults,
    load: load,
    save: save,
    patch: patch,
    updatePrefs: updatePrefs,
    reset: reset,
    sanitize: sanitize,
    validate: validate,
    pruneUnknownIds: pruneUnknownIds,
    normalizeQuizCount: normalizeQuizCount,
    normalizeFontScale: normalizeFontScale,
    getState: getState,
    getLoadIssue: function () {
      return loadIssue;
    },
    markLearned: markLearned,
    recordQuiz: recordQuiz,
    addWrong: addWrong,
    addWrongItem: addWrongItem,
    removeWrong: removeWrong,
    removeWrongItem: removeWrongItem,
    wrongItemsForPoem: wrongItemsForPoem,
    wrongItemKeysForPoems: wrongItemKeysForPoems,
    duePoemIds: duePoemIds,
    reviewFor: reviewFor,
    exportData: exportData,
    importData: importData,
    touchRecent: function (poemId) {
      touchRecent(poemId);
      save();
    },
    todayStats: todayStats,
  };
})(window);
