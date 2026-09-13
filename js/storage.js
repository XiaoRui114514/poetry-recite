/* 古诗文背诵学习系统 —— 本地数据存储
   纯静态站点没有后端账户，学习和错题数据全部保存在 localStorage。
   这里对损坏 / 禁用 / 配额异常做了容错，保证任何情况下页面都能打开。 */
(function (global) {
  'use strict';

  var Utils = global.PoetryUtils;
  var STORAGE_KEY = 'ruishao-poetry-study-v1';
  var SCHEMA_VERSION = 1;
  var DAILY_LIMIT = 60;
  var RECENT_LIMIT = 20;
  var WRONG_LIMIT = 200;

  /* 合法题型白名单（与 js/quiz.js 的 MODES 保持一致，unit test 会校验两者相等）。
     非法值必须被丢弃：空数组按现有设计表示“随机组合”。 */
  var MODE_KEYS = ['blank-full', 'next', 'prev', 'keyword', 'mixed', 'full'];

  /* 页面 UI 只提供这四档题量；localStorage 里的其它数值一律吸附到最近的档位，
     避免出现“没有任何 chip 处于选中态”的不可见状态。 */
  var QUIZ_COUNT_OPTIONS = [5, 10, 20, 30];
  var QUIZ_COUNT_MIN = 1;
  var QUIZ_COUNT_MAX = 60;

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
      },
      wrongBook: [],          // 错题本 [{ id, time, count, mode }]
      daily: {},              // { '2026-09-12': { quiz, correct } }
      prefs: {
        quizCount: 10,
        modes: [],            // 空数组表示“随机组合”
        autoNext: false,
        hideKeywords: false,
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

  function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
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
    }

    if (Array.isArray(raw.wrongBook)) {
      var wrongList = raw.wrongBook
        .filter(function (item) {
          return item && typeof item === 'object' && typeof item.id === 'string';
        })
        .map(function (item) {
          return {
            id: item.id,
            time: toNumber(item.time),
            count: toCount(item.count) || 1,
            mode: typeof item.mode === 'string' && MODE_KEYS.indexOf(item.mode) !== -1 ? item.mode : '',
          };
        });
      var wrongSeen = Object.create(null);
      base.wrongBook = wrongList
        .sort(function (a, b) {
          return b.time - a.time;
        })
        .filter(function (item) {
          if (!item.id || wrongSeen[item.id]) return false; // 同一篇目只保留一条记录
          wrongSeen[item.id] = true;
          return true;
        })
        .slice(0, WRONG_LIMIT);
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
      if (stats.total > 0 && stats.correct / stats.total > 1) issues.push('整体正确率超过 100%');
    }
    if (!Array.isArray(data.wrongBook)) issues.push('wrongBook 不是数组');
    else {
      data.wrongBook.forEach(function (item) {
        if (!item || typeof item.id !== 'string' || !item.id) issues.push('wrongBook 含非法 id');
        if (!Number.isInteger(item && item.count) || item.count < 1) issues.push('wrongBook.count 非法');
        if (item && item.mode && MODE_KEYS.indexOf(item.mode) === -1) issues.push('wrongBook.mode 非法: ' + item.mode);
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
    data.wrongBook = Utils.toArray(data.wrongBook).filter(function (item) {
      if (item && allowed[item.id]) return true;
      removed += 1;
      return false;
    });
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
    save();
    return state;
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

  function markLearned(poemId) {
    if (!poemId) return state;
    state.learnedIds[poemId] = Date.now();
    touchRecent(poemId);
    save();
    return state;
  }

  function recordQuiz(poemId, isCorrect, mode) {
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

    if (poemId) {
      var item = state.quizStats.byPoem[poemId] || { total: 0, correct: 0, wrong: 0, lastTime: 0 };
      item.total += 1;
      if (isCorrect) item.correct += 1;
      else item.wrong += 1;
      item.lastTime = Date.now();
      state.quizStats.byPoem[poemId] = item;
      touchRecent(poemId);
      /* 产品设计：答对一次即认为该篇目已经掌握，整条错题记录移除（不是 count-1）。
         这样错题本只保留“当前还没背熟的篇目”，unit test 覆盖了这一行为。 */
      if (isCorrect) removeWrong(poemId, true);
      else addWrong(poemId, mode, true);
    }
    save();
    return state;
  }

  function addWrong(poemId, mode, silent) {
    if (!poemId) return state;
    var safeMode = MODE_KEYS.indexOf(mode) !== -1 ? mode : '';
    var found = null;
    state.wrongBook.forEach(function (item) {
      if (item.id === poemId) found = item;
    });
    if (found) {
      found.count += 1;
      found.time = Date.now();
      found.mode = safeMode || found.mode;
    } else {
      state.wrongBook.unshift({ id: poemId, time: Date.now(), count: 1, mode: safeMode });
    }
    state.wrongBook = state.wrongBook.slice(0, WRONG_LIMIT);
    if (!silent) save();
    return state;
  }

  function removeWrong(poemId, silent) {
    state.wrongBook = state.wrongBook.filter(function (item) {
      return item.id !== poemId;
    });
    if (!silent) save();
    return state;
  }

  function todayStats() {
    var day = Utils.todayKey();
    return state.daily[day] || { quiz: 0, correct: 0 };
  }

  global.PoetryStorage = {
    KEY: STORAGE_KEY,
    MODE_KEYS: MODE_KEYS,
    QUIZ_COUNT_OPTIONS: QUIZ_COUNT_OPTIONS,
    defaults: defaults,
    load: load,
    save: save,
    patch: patch,
    reset: reset,
    sanitize: sanitize,
    validate: validate,
    pruneUnknownIds: pruneUnknownIds,
    normalizeQuizCount: normalizeQuizCount,
    getState: getState,
    getLoadIssue: function () {
      return loadIssue;
    },
    markLearned: markLearned,
    recordQuiz: recordQuiz,
    addWrong: addWrong,
    removeWrong: removeWrong,
    touchRecent: function (poemId) {
      touchRecent(poemId);
      save();
    },
    todayStats: todayStats,
  };
})(window);
