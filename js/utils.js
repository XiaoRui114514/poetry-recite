/* 古诗文背诵学习系统 —— 通用工具
   重点：古诗文的标点安全切分（不破坏标点、不切坏书名号/引号内的内容）。 */
(function (global) {
  'use strict';

  var HARD_TERMINATORS = '。！？!?';
  var SOFT_SEPARATORS = '，；：,;:';
  var KEEP_CHARS = '，。！？；：、,.;:!?…—－()（）《》〈〉「」『』【】“”‘’\'"·';
  // 切分时：书名号、括号、引号内部都不切分（《诗》可以群 / “不亦说乎？”）
  var SPLIT_PAIRS = { '（': '）', '(': ')', '《': '》', '〈': '〉', '「': '」', '『': '』', '【': '】', '“': '”', '‘': '’' };
  // 挖空时：只保留书名号 / 括号内的内容（正文里引用篇名要看得见），引号内的内容照常挖空
  var KEEP_PAIRS = { '（': '）', '(': ')', '《': '》', '〈': '〉', '「': '」', '『': '』', '【': '】' };

  /** 标记成对括号内部的位置；未闭合的括号不会生效，避免整段被误判为“括号内” */
  function buildMask(text, pairs) {
    var src = String(text == null ? '' : text);
    var mask = new Array(src.length);
    var stack = [];
    for (var i = 0; i < src.length; i += 1) {
      var ch = src[i];
      if (pairs[ch]) {
        stack.push({ close: pairs[ch], index: i });
        continue;
      }
      if (stack.length && ch === stack[stack.length - 1].close) {
        var open = stack.pop();
        for (var j = open.index; j <= i; j += 1) mask[j] = true;
      }
    }
    return mask;
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function toArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  /**
   * 随机数来源：默认 Math.random，测试可以通过
   * window.__POETRY_RANDOM__ = fn 注入确定性随机源（生产环境不设置它）。
   */
  function random() {
    var custom = global.__POETRY_RANDOM__;
    if (typeof custom === 'function') {
      var value = Number(custom());
      if (isFinite(value) && value >= 0 && value < 1) return value;
    }
    return Math.random();
  }

  function shuffle(list) {
    var arr = toArray(list).slice();
    for (var i = arr.length - 1; i > 0; i -= 1) {
      var j = Math.floor(random() * (i + 1));
      var tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  function unique(list) {
    var seen = Object.create(null);
    var out = [];
    toArray(list).forEach(function (item) {
      if (item == null) return;
      var key = String(item);
      if (seen[key]) return;
      seen[key] = true;
      out.push(item);
    });
    return out;
  }

  function groupBy(list, keyFn) {
    var groups = [];
    var index = Object.create(null);
    toArray(list).forEach(function (item) {
      var key = String(keyFn(item));
      if (index[key] == null) {
        index[key] = groups.length;
        groups.push({ key: key, items: [] });
      }
      groups[index[key]].items.push(item);
    });
    return groups;
  }

  /** 去掉空白，便于比较和长度统计 */
  function normalizeText(text) {
    return String(text == null ? '' : text).replace(/\s+/g, '');
  }

  function stripPunctuation(text) {
    var out = '';
    String(text == null ? '' : text).split('').forEach(function (ch) {
      if (KEEP_CHARS.indexOf(ch) === -1) out += ch;
    });
    return out;
  }

  function isKeptChar(ch) {
    return KEEP_CHARS.indexOf(ch) !== -1;
  }

  /**
   * 按“句”切分：遇到 。！？… 结束一句（保留标点）。
   * 括号 / 书名号 / 引号内部不切分，避免把《诗》拆开。
   */
  function splitSentences(text) {
    var src = String(text == null ? '' : text).replace(/\r\n?/g, '\n');
    var sentences = [];
    var buffer = '';
    var mask = buildMask(src, SPLIT_PAIRS);

    for (var i = 0; i < src.length; i += 1) {
      var ch = src[i];

      if (ch === '\n') {
        if (normalizeText(buffer)) sentences.push(buffer.trim());
        buffer = '';
        continue;
      }

      buffer += ch;

      if (mask[i]) continue; // 括号 / 书名号 / 引号内部不切分

      if (HARD_TERMINATORS.indexOf(ch) !== -1) {
        // 处理 ？！ 连用等情况
        while (i + 1 < src.length && HARD_TERMINATORS.indexOf(src[i + 1]) !== -1 && !mask[i + 1]) {
          i += 1;
          buffer += src[i];
        }
        if (normalizeText(buffer)) sentences.push(buffer.trim());
        buffer = '';
      }
    }
    if (normalizeText(buffer)) sentences.push(buffer.trim());
    return sentences;
  }

  /**
   * 按“小句”切分：以逗号 / 分号 / 冒号分隔（保留标点）。
   * 顿号不切分，保留在句内，避免列出并列词语时被拆碎。
   */
  function splitClauses(text) {
    var src = String(text == null ? '' : text);
    var clauses = [];
    var buffer = '';
    var mask = buildMask(src, SPLIT_PAIRS);

    for (var i = 0; i < src.length; i += 1) {
      var ch = src[i];

      if (ch === '\n') {
        if (normalizeText(buffer)) clauses.push(buffer.trim());
        buffer = '';
        continue;
      }

      buffer += ch;

      if (mask[i]) continue;

      if (SOFT_SEPARATORS.indexOf(ch) !== -1) {
        if (normalizeText(buffer)) clauses.push(buffer.trim());
        buffer = '';
      }
    }
    if (normalizeText(buffer)) clauses.push(buffer.trim());
    return clauses;
  }

  /**
   * 生成挖空文本：把 hide 集合中的字符替换成 □，标点原样保留。
   * 括号 / 书名号 / 引号内部的内容原样保留，避免把《诗》挖成《□》。
   * hide 为 null 表示整段挖空。
   */
  function makeBlank(text, hideChars) {
    var src = String(text == null ? '' : text);
    var hideSet = hideChars ? new Set(hideChars.split('')) : null;
    var out = '';
    var mask = buildMask(src, KEEP_PAIRS);
    for (var i = 0; i < src.length; i += 1) {
      var ch = src[i];
      if (mask[i]) { out += ch; continue; }
      if (isKeptChar(ch)) { out += ch; continue; }
      if (!hideSet || hideSet.has(ch)) out += '□';
      else out += ch;
    }
    return out;
  }

  /** 保留每句首字提示的挖空（用于“关键词隐藏”）：如“东□□□，以□□□。” */
  function blankKeepFirst(clause) {
    var src = String(clause == null ? '' : clause);
    var out = '';
    var kept = 0;
    var mask = buildMask(src, KEEP_PAIRS);
    for (var i = 0; i < src.length; i += 1) {
      var ch = src[i];
      if (mask[i]) { out += ch; continue; }
      if (isKeptChar(ch)) {
        out += ch;
        if (SOFT_SEPARATORS.indexOf(ch) !== -1) kept = 0; // 每个小句都保留首字
        continue;
      }
      if (kept === 0) {
        out += ch;
        kept += 1;
      } else {
        out += '□';
      }
    }
    return out;
  }

  function countChars(text) {
    return stripPunctuation(text).length;
  }

  function randomOf(list) {
    var arr = toArray(list);
    return arr.length ? arr[Math.floor(random() * arr.length)] : null;
  }

  /* ---------------- 日期策略（重要） ----------------
     本项目的“今日”一律按【浏览器本地时间】计算（本应用是纯本地离线工具，
     用户所在设备的日历日期就是用户认知里的“今天”）。
     因此：
       1) 只允许用本文件的 todayKey() 生成 YYYY-MM-DD 日键，业务代码不要自己拼；
       2) 不混用 UTC（toISOString 等），避免 UTC+8 凌晨被算成前一天；
       3) todayKey('2026-09-13') 这类已是日键的字符串按原样返回，
          避免 new Date('YYYY-MM-DD') 被当成 UTC 零点导致跨时区偏移一天。
     若将来产品要求“统一按北京时间”，只需要改这里并同步改测试。 */
  var DAY_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

  /** 校验 YYYY-MM-DD：格式正确、真实存在的日期、年份在合理范围内 */
  function isValidDayKey(value) {
    var src = String(value == null ? '' : value).trim();
    var m = DAY_KEY_RE.exec(src);
    if (!m) return false;
    var year = Number(m[1]);
    var month = Number(m[2]);
    var day = Number(m[3]);
    if (year < 2000 || year > 2100) return false;
    if (month < 1 || month > 12) return false;
    if (day < 1 || day > 31) return false;
    var d = new Date(year, month - 1, day);
    return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day;
  }

  /** 过滤非法日键并按日期升序排序（早 → 晚），用于 daily 只保留最近 N 天 */
  function sortDayKeys(keys) {
    return unique(
      toArray(keys)
      .filter(function (key) {
        return isValidDayKey(key);
      })
      .map(function (key) {
        return String(key).trim();
      })
    ).sort();
  }

  function todayKey(date) {
    if (typeof date === 'string' && DAY_KEY_RE.test(date.trim())) return date.trim();
    var d = date ? new Date(date) : new Date();
    if (isNaN(d.getTime())) d = new Date();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }

  function formatDateTime(timestamp) {
    var d = new Date(timestamp);
    if (isNaN(d.getTime())) return '';
    var hh = String(d.getHours()).padStart(2, '0');
    var mm = String(d.getMinutes()).padStart(2, '0');
    return todayKey(d) + ' ' + hh + ':' + mm;
  }

  function parseDayKey(value) {
    var src = String(value == null ? '' : value).trim();
    if (!isValidDayKey(src)) return null;
    var m = DAY_KEY_RE.exec(src);
    return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
  }

  /** 在日键上加减天数（按本地日历，跨月 / 跨年 / 闰年都正确） */
  function addDaysKey(dayKey, days) {
    var base = parseDayKey(dayKey);
    var offset = Number(days);
    if (!isFinite(offset)) offset = 0;
    var d = base ? new Date(base.year, base.month - 1, base.day) : new Date();
    d.setDate(d.getDate() + Math.round(offset));
    return todayKey(d);
  }

  /** 两个日键相差多少天（b - a）；任一非法返回 NaN */
  function daysBetweenKeys(a, b) {
    var left = parseDayKey(a);
    var right = parseDayKey(b);
    if (!left || !right) return NaN;
    var start = new Date(left.year, left.month - 1, left.day).getTime();
    var end = new Date(right.year, right.month - 1, right.day).getTime();
    return Math.round((end - start) / 86400000);
  }

  /** 到期日是否已到（due <= today）；due 为空 / 非法表示没有安排 */
  function isDueDay(due, today) {
    var d = String(due == null ? '' : due).trim();
    if (!isValidDayKey(d)) return false;
    return d <= (today || todayKey());
  }

  function debounce(fn, wait) {
    var timer = null;
    return function () {
      var args = arguments;
      var self = this;
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () {
        timer = null;
        fn.apply(self, args);
      }, wait || 150);
    };
  }

  global.PoetryUtils = {
    escapeHtml: escapeHtml,
    toArray: toArray,
    clamp: clamp,
    random: random,
    shuffle: shuffle,
    unique: unique,
    groupBy: groupBy,
    normalizeText: normalizeText,
    stripPunctuation: stripPunctuation,
    isKeptChar: isKeptChar,
    splitSentences: splitSentences,
    splitClauses: splitClauses,
    makeBlank: makeBlank,
    blankKeepFirst: blankKeepFirst,
    countChars: countChars,
    randomOf: randomOf,
    isValidDayKey: isValidDayKey,
    sortDayKeys: sortDayKeys,
    todayKey: todayKey,
    addDaysKey: addDaysKey,
    daysBetweenKeys: daysBetweenKeys,
    isDueDay: isDueDay,
    formatDateTime: formatDateTime,
    debounce: debounce,
  };
})(window);
