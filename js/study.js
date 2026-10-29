/* 古诗文背诵学习系统 —— 全文学习模式
   交互：点击句子隐藏/显示、显示全部、逐句隐藏、关键词隐藏、上一句/下一句。
   逐句翻译：每句原文下面挂一条对应的现代汉语翻译（数据来自 poem.translation），
   翻译只在该句原文“完整显示”时可见；隐藏时用 visibility 而不是 display，
   保证翻译的布局占位始终存在，隐藏 / 显示不会让整首诗重新排版、页面跳动。
   考试重点星标：正文左侧是独立的 marker 列（数据来自 poem.examFocus，只存句子下标），
   ★ 只出现在 marker 里，绝不进入正文文本；marker 列宽固定，有没有 ★ 都由 CSS 留位，
   所以任何显隐状态都不会让原文左右移动。

   v1.5 新增（都做成独立开关，不改变默认的全文模式）：
   - 逐句背：一次只显示当前一句，前后句淡化；
   - 只看重点：非 examFocus 句折叠；
   - 固定工具条 + 键盘快捷键 + 手机左右滑；
   - 字号三档、译文开关、专注模式（偏好保存在本机）。 */
(function (global) {
  'use strict';

  var Utils = global.PoetryUtils;
  var DB = global.PoetryDatabase;
  var Storage = global.PoetryStorage;

  var state = {
    poemId: '',
    hidden: {},      // { sentenceIndex: true }
    keywordMode: false,
    activeIndex: -1,
    list: [],
    sentences: [],
    translations: [],
    focusMap: {},
    reciteMode: false,
    focusOnly: false,
    root: null,
  };

  /** 作者隐形指纹：随正文复制而传播（零宽字符，不参与阅读与判分） */
  function brandSig() {
    var brand = global.PoetryBrand;
    return brand && brand.signature ? brand.signature() : '';
  }

  function prefs() {
    var data = Storage.getState ? Storage.getState() : null;
    return (data && data.prefs) || {};
  }

  function resetState(poemId, list) {
    var poem = DB.byId(poemId);
    state.poemId = poemId;
    state.hidden = {};
    state.keywordMode = false;
    state.activeIndex = -1;
    state.list = list;
    state.reciteMode = false;
    state.focusOnly = false;
    state.sentences = poem ? Utils.splitSentences(poem.text) : [];
    state.translations = poem ? DB.translationLines(poem) : [];
    state.focusMap = poem ? DB.examFocusMap(poem) : Object.create(null);
  }

  function currentPoem() {
    return DB.byId(state.poemId);
  }

  /* ---------------- 逐句翻译 ---------------- */

  function poemTranslations(poem) {
    if (!poem) return [];
    if (poem.id === state.poemId && state.translations.length) return state.translations;
    return typeof DB.translationLines === 'function' ? DB.translationLines(poem) : [];
  }

  /** 翻译区域是否显示（= 该句原文是否完整显示，与 state 单一来源保持一致） */
  function transVisible(index) {
    return !state.hidden[index];
  }

  /* ---------------- 考试重点星标 ---------------- */

  function examFocusMap(poem) {
    if (!poem) return Object.create(null);
    if (poem.id === state.poemId && state.focusMap) return state.focusMap;
    return typeof DB.examFocusMap === 'function' ? DB.examFocusMap(poem) : Object.create(null);
  }

  /**
   * 星标是否可见：同样以“该句原文完整显示”为唯一条件。
   * 逐句隐藏 / 逐句隐藏全部 / 关键词隐藏时原文被挖空，此时不显示 ★。
   */
  function examVisible(index) {
    return !state.hidden[index];
  }

  /* ---------------- 中心思想 / 主旨 ---------------- */

  /** 中心思想属于“文章级信息”，诗词用「主旨」，文言文用「中心思想」 */
  function summaryLabel(poem) {
    return poem && poem.genre === '文言文' ? '中心思想' : '主旨';
  }

  function summaryText(poem) {
    return poem && typeof poem.summary === 'string' ? poem.summary.trim() : '';
  }

  /* ---------------- 渲染 ---------------- */

  function sentenceText(sentence, hidden) {
    if (!hidden) return String(sentence);
    if (state.keywordMode) {
      return Utils.splitClauses(sentence)
        .map(function (clause) {
          return Utils.blankKeepFirst(clause);
        })
        .join('');
    }
    return Utils.makeBlank(sentence, null);
  }

  /**
   * 重点标记列。**始终**输出同一个元素：有重点时里面是 ★，没有重点时是空的，
   * 由 CSS 固定列宽保证「有没有 ★」都不影响原文的横向起始位置。
   * 隐藏只切 is-off（CSS visibility），绝不用 display: none。
   */
  function renderMarker(isFocus, visible) {
    return (
      '<span class="line-marker' + (visible ? '' : ' is-off') + '" aria-hidden="true">' +
      (isFocus ? '★' : '') +
      '</span>'
    );
  }

  /**
   * 逐句翻译的容器。始终留在 DOM 里，隐藏时只去掉类名、由 CSS 用 visibility 收起，
   * 这样高度不变，不会出现“翻译消失后原文整段上移”的抽搐。
   */
  function renderTranslation(text, visible) {
    return (
      '<span class="line-zh' + (visible ? '' : ' is-off') + '" aria-hidden="true">' +
      Utils.escapeHtml(text || '') +
      '</span>'
    );
  }

  function lineClass(index) {
    var hidden = !!state.hidden[index];
    var focused = !!state.focusMap[index];
    return 'line-item' +
      (hidden ? ' is-hidden' : '') +
      (state.activeIndex === index ? ' is-active' : '') +
      (focused ? ' is-focus' : ' is-nonfocus');
  }

  // Keep the original glyph's inline metrics. Different fonts give □ a different
  // width, so replacing glyphs directly can reflow a narrow screen on hide.
  function sentenceHtml(sentence, hidden) {
    if (!hidden) return Utils.escapeHtml(sentence);
    var original = Array.from(String(sentence));
    var masked = Array.from(sentenceText(sentence, true));
    if (original.length !== masked.length) return Utils.escapeHtml(masked.join(''));
    return original.map(function(ch, index) {
      if (masked[index] === ch) return Utils.escapeHtml(ch);
      return '<span class="masked-char" data-original="'+Utils.escapeHtml(ch)+'"><span class="masked-output">'+Utils.escapeHtml(masked[index])+'</span></span>';
    }).join('');
  }

  function renderSentences(poem) {
    var sentences = state.sentences.length ? state.sentences : Utils.splitSentences(poem.text);
    var translations = poemTranslations(poem);
    var focus = examFocusMap(poem);
    return sentences
      .map(function (sentence, index) {
        var hidden = !!state.hidden[index];
        return (
          '<button type="button" class="' + lineClass(index) + '" data-line="' + index + '" aria-pressed="' + (hidden ? 'true' : 'false') + '">' +
          renderMarker(!!focus[index], examVisible(index)) +
          '<span class="line-content">' +
          '<span class="line-text">' + sentenceHtml(sentence, hidden) + brandSig() + '</span>' +
          renderTranslation(translations[index], transVisible(index)) +
          '</span>' +
          '</button>'
        );
      })
      .join('');
  }

  /**
   * 只在原位上改文字与状态，不重建 DOM、不动滚动位置。
   * marker / 翻译的显隐只切 class（CSS 用 visibility），列宽与高度都不变，所以不会整段上移。
   */
  function updateLines(root) {
    var poem = currentPoem();
    var body = root.querySelector('#poemBody');
    if (!poem || !body) return;
    var nodes = body.querySelectorAll('.line-item');
    var sentences = state.sentences.length ? state.sentences : Utils.splitSentences(poem.text);
    if (nodes.length !== sentences.length) {
      refreshBody(root);
      return;
    }
    var translations = poemTranslations(poem);
    var focus = examFocusMap(poem);
    for (var index = 0; index < nodes.length; index += 1) {
      var node = nodes[index];
      var hidden = !!state.hidden[index];
      var textEl = node.querySelector('.line-text');
      var zhEl = node.querySelector('.line-zh');
      var markerEl = node.querySelector('.line-marker');
      if (textEl) textEl.innerHTML = sentenceHtml(sentences[index], hidden) + brandSig();
      if (zhEl) {
        zhEl.textContent = translations[index] || '';
        zhEl.classList.toggle('is-off', !transVisible(index));
      }
      if (markerEl) {
        markerEl.textContent = focus[index] ? '★' : '';
        markerEl.classList.toggle('is-off', !examVisible(index));
      }
      node.classList.toggle('is-hidden', hidden);
      node.classList.toggle('is-active', state.activeIndex === index);
      node.classList.toggle('is-focus', !!focus[index]);
      node.classList.toggle('is-nonfocus', !focus[index]);
      node.setAttribute('aria-pressed', hidden ? 'true' : 'false');
    }
  }

  function renderHints(poem) {
    var map = DB.highlightMap(poem);
    var groups = Object.keys(map);
    if (!groups.length) return '';
    return groups
      .map(function (type) {
        return (
          '<dt>背诵提示 · ' + Utils.escapeHtml(type) + '</dt>' +
          '<dd><div class="hint-list">' +
          map[type]
            .map(function (item) {
              return (
                '<button type="button" class="hint-item" data-hint="' + Utils.escapeHtml(item.text) + '">' +
                Utils.escapeHtml(item.text) +
                (item.note ? '<span class="tiny muted"> · ' + Utils.escapeHtml(item.note) + '</span>' : '') +
                '</button>'
              );
            })
            .join('') +
          '</div></dd>'
        );
      })
      .join('');
  }

  function renderSummary(poem) {
    var text = summaryText(poem);
    if (!text) return '';
    return (
      '<div class="poem-summary">' +
        '<span class="poem-summary-label">' + Utils.escapeHtml(summaryLabel(poem)) + '</span>' +
        '<p class="poem-summary-text">' + Utils.escapeHtml(text) + '</p>' +
      '</div>'
    );
  }

  function renderMeta(poem) {
    var sourceInfo = (global.PoetryMeta.sources || {})[poem.sourceType === '上海地区' ? 'shanghai' : poem.sourceType === '统编教材' ? 'textbook' : poem.stage === '高中' ? 'senior' : 'junior'];
    var rows = [
      ['学段年级', poem.stage + ' · ' + poem.grade],
      ['作者朝代', poem.author + ' · ' + poem.dynasty],
      ['体裁', poem.genre],
      ['来源类型', poem.sourceType + (poem.required ? '（核心必背）' : '')],
      ['数据来源', poem.source || (sourceInfo ? sourceInfo.name : '')],
    ];
    var html = rows
      .filter(function (row) {
        return row[1];
      })
      .map(function (row) {
        return '<dt>' + Utils.escapeHtml(row[0]) + '</dt><dd>' + Utils.escapeHtml(row[1]) + '</dd>';
      })
      .join('');

    if (poem.notes) html += '<dt>说明</dt><dd>' + Utils.escapeHtml(poem.notes) + '</dd>';

    if (poem.variants.length) {
      html += '<dt>版本差异</dt><dd>' + poem.variants
        .map(function (variant) {
          return '<div>' + Utils.escapeHtml(variant.label || '异文') + '：' + Utils.escapeHtml(variant.text) + '</div>';
        })
        .join('') + '</dd>';
    }
    return html;
  }

  function toolbarHtml() {
    var p = prefs();
    var scale = Storage.normalizeFontScale(p.fontScale);
    return (
      '<div class="study-toolbar">' +
        '<button type="button" class="btn btn-sm" data-action="reveal-all">显示全部</button>' +
        '<button type="button" class="btn btn-sm" data-action="hide-all">逐句隐藏</button>' +
        '<button type="button" class="btn btn-sm" data-action="toggle-keyword">关键词隐藏</button>' +
        '<button type="button" class="btn btn-sm" data-action="prev-line">上一句</button>' +
        '<button type="button" class="btn btn-sm" data-action="next-line">下一句</button>' +
        '<span class="toolbar-sep" aria-hidden="true"></span>' +
        '<button type="button" class="btn btn-sm" data-action="toggle-recite">逐句背</button>' +
        '<button type="button" class="btn btn-sm" data-action="toggle-focus">只看重点</button>' +
        '<button type="button" class="btn btn-sm" data-action="toggle-translation">译文：' + (p.showTranslation === false ? '关' : '开') + '</button>' +
        '<button type="button" class="btn btn-sm" data-action="font-down" aria-label="正文字号调小"' + (scale <= 0 ? ' disabled' : '') + '>A−</button>' +
        '<button type="button" class="btn btn-sm" data-action="font-up" aria-label="正文字号调大"' + (scale >= 2 ? ' disabled' : '') + '>A＋</button>' +
        '<button type="button" class="btn btn-sm" data-action="toggle-focusmode">' + (p.focusMode ? '退出专注' : '专注') + '</button>' +
      '</div>' +
      '<div class="study-status">' +
        '<span id="studyProgress">' + Object.keys(state.hidden).length + ' / ' + state.sentences.length + ' 句已隐藏</span>' +
        '<span id="studyPosition">' + positionText() + '</span>' +
      '</div>'
    );
  }

  function positionText() {
    if (!state.sentences.length) return '';
    if (state.activeIndex < 0) return '共 ' + state.sentences.length + ' 句';
    return '第 ' + (state.activeIndex + 1) + ' / ' + state.sentences.length + ' 句';
  }

  function render(root) {
    var poem = currentPoem();
    if (!poem) {
      root.innerHTML =
        '<div class="card"><div class="empty-state">当前没有可学习的篇目，请先返回选择篇目。</div></div>';
      return;
    }

    var learned = !!Storage.getState().learnedIds[poem.id];
    var options = state.list
      .map(function (item) {
        return (
          '<option value="' + Utils.escapeHtml(item.id) + '"' + (item.id === poem.id ? ' selected' : '') + '>' +
          Utils.escapeHtml(item.title + ' · ' + item.author) +
          '</option>'
        );
      })
      .join('');
    var p = prefs();

    root.innerHTML =
      '<section class="card">' +
        '<div class="poem-switch">' +
          '<label class="filter-label" for="studyPoemSelect">切换篇目（共 ' + state.list.length + ' 篇）</label>' +
          '<select id="studyPoemSelect">' + options + '</select>' +
        '</div>' +
      '</section>' +
      '<div class="study-toolbar-wrap">' + toolbarHtml() + '</div>' +
      '<section class="card">' +
        '<div class="poem-head">' +
          '<h2>' + Utils.escapeHtml(poem.title) + '</h2>' +
          '<p class="poem-byline">' + Utils.escapeHtml(poem.author + ' · ' + poem.dynasty) + '</p>' +
          '<div class="poem-tags">' +
            '<span class="badge badge-primary">' + Utils.escapeHtml(poem.stage + ' ' + poem.grade) + '</span>' +
            '<span class="badge">' + Utils.escapeHtml(poem.genre) + '</span>' +
            '<span class="badge' + (poem.required ? ' badge-success' : '') + '">' + Utils.escapeHtml(poem.sourceType) + '</span>' +
            (learned ? '<span class="badge badge-warn">已学习</span>' : '') +
          '</div>' +
        '</div>' +
        '<div class="poem-body' + (state.reciteMode ? ' is-recite' : '') + (state.focusOnly ? ' is-focus-only' : '') + (p.showTranslation === false ? ' hide-translation' : '') + '" id="poemBody">' + renderSentences(poem) + '</div>' +
        renderSummary(poem) +
        '<div class="hint-bar">' +
          '<span class="tiny muted">点击任意句子可以隐藏 / 显示；空格键切换当前句，← → 换句。</span>' +
          '<span class="tiny muted" id="studyProgress2">' + Object.keys(state.hidden).length + ' / ' + state.sentences.length + ' 句已隐藏</span>' +
        '</div>' +
        '<dl class="poem-meta-block">' + renderMeta(poem) + renderHints(poem) + '</dl>' +
      '</section>';
    applyReadingPrefs(root);
    syncToolbar(root);
  }

  function updateCounters(root) {
    var hidden = Object.keys(state.hidden).length;
    var text = hidden + ' / ' + state.sentences.length + ' 句已隐藏';
    var counter = root.querySelector('#studyProgress');
    if (counter) counter.textContent = text;
    var counter2 = root.querySelector('#studyProgress2');
    if (counter2) counter2.textContent = text;
    var position = root.querySelector('#studyPosition');
    if (position) position.textContent = positionText();
  }

  /** 全文重建（只在切换篇目 / 首次渲染时用）；日常交互走 updateLines，不重建 DOM */
  function refreshBody(root) {
    var poem = currentPoem();
    var body = root.querySelector('#poemBody');
    if (!poem || !body) return;
    body.innerHTML = renderSentences(poem);
    applyReadingPrefs(root);
    syncToolbar(root);
    updateCounters(root);
  }

  function syncToolbar(root) {
    var keywordBtn = root.querySelector('[data-action="toggle-keyword"]');
    if (keywordBtn) {
      keywordBtn.classList.toggle('btn-primary', state.keywordMode);
      keywordBtn.setAttribute('aria-pressed', state.keywordMode ? 'true' : 'false');
    }
    var reciteBtn = root.querySelector('[data-action="toggle-recite"]');
    if (reciteBtn) {
      reciteBtn.classList.toggle('btn-primary', state.reciteMode);
      reciteBtn.setAttribute('aria-pressed', state.reciteMode ? 'true' : 'false');
      reciteBtn.textContent = state.reciteMode ? '退出逐句' : '逐句背';
    }
    var focusBtn = root.querySelector('[data-action="toggle-focus"]');
    if (focusBtn) {
      focusBtn.classList.toggle('btn-primary', state.focusOnly);
      focusBtn.setAttribute('aria-pressed', state.focusOnly ? 'true' : 'false');
    }
    var p = prefs();
    var scale = Storage.normalizeFontScale(p.fontScale);
    var down = root.querySelector('[data-action="font-down"]');
    var up = root.querySelector('[data-action="font-up"]');
    if (down) down.disabled = scale <= 0;
    if (up) up.disabled = scale >= 2;
    var transBtn = root.querySelector('[data-action="toggle-translation"]');
    if (transBtn) transBtn.textContent = '译文：' + (p.showTranslation === false ? '关' : '开');
    var focusModeBtn = root.querySelector('[data-action="toggle-focusmode"]');
    if (focusModeBtn) focusModeBtn.textContent = p.focusMode ? '退出专注' : '专注';
    updateCounters(root);
  }

  /** 把阅读偏好落到 body / poemBody 上（切页时由 app.js 清理非学习页的类名） */
  function applyReadingPrefs(root) {
    var p = prefs();
    var body = root ? root.querySelector('#poemBody') : null;
    if (body) {
      body.classList.toggle('is-recite', state.reciteMode);
      body.classList.toggle('is-focus-only', state.focusOnly);
      body.classList.toggle('hide-translation', p.showTranslation === false);
    }
    if (document.body) {
      document.body.classList.toggle('focus-reading', !!p.focusMode);
      document.body.classList.remove('font-sm', 'font-md', 'font-lg');
      var scale = Storage.normalizeFontScale(p.fontScale);
      document.body.classList.add(scale === 0 ? 'font-sm' : scale === 2 ? 'font-lg' : 'font-md');
    }
  }

  function syncView(root) {
    updateLines(root);
    syncToolbar(root);
    updateCounters(root);
  }

  function setPoem(root, poemId, options) {
    var poem = DB.byId(poemId);
    if (!poem) return;
    var list = options && options.list ? options.list : state.list;
    // 只允许在“当前已选篇目”范围内切换，异常 URL / 旧状态不会把别的篇目标记为已学习
    if (
      !list.some(function (item) {
        return item.id === poem.id;
      })
    ) {
      return;
    }
    resetState(poem.id, list);
    Storage.markLearned(poem.id);
    render(root);
    if (global.scrollTo) global.scrollTo(0, 0);
  }

  function move(root, delta) {
    var total = state.sentences.length;
    if (!total) return;
    var next;
    if (state.activeIndex < 0) next = delta < 0 ? total - 1 : 0;
    else next = state.activeIndex + delta;
    if (next < 0) next = 0;
    if (next >= total) next = total - 1;
    state.activeIndex = next;
    syncView(root);
    var active = root.querySelector('.line-item.is-active');
    if (active && active.scrollIntoView) active.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  function firstFocusIndex() {
    var keys = Object.keys(state.focusMap)
      .map(Number)
      .filter(function (n) { return n >= 0; })
      .sort(function (a, b) { return a - b; });
    return keys.length ? keys[0] : 0;
  }

  function revealAll(root) {
    state.hidden = {};
    state.keywordMode = false;
    state.activeIndex = -1;
    syncView(root);
  }

  function hideAll(root) {
    state.sentences.forEach(function (_, index) {
      state.hidden[index] = true;
    });
    syncView(root);
  }

  function toggleKeyword(root) {
    state.keywordMode = !state.keywordMode;
    if (state.keywordMode) {
      state.sentences.forEach(function (_, index) {
        state.hidden[index] = true;
      });
    }
    syncView(root);
  }

  function toggleRecite(root) {
    state.reciteMode = !state.reciteMode;
    if (state.reciteMode && state.activeIndex < 0) state.activeIndex = 0;
    if (!state.reciteMode) state.activeIndex = -1;
    applyReadingPrefs(root);
    syncView(root);
    if (state.reciteMode) {
      var active = root.querySelector('.line-item.is-active');
      if (active && active.scrollIntoView) active.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }

  function toggleFocusOnly(root) {
    state.focusOnly = !state.focusOnly;
    if (state.focusOnly) {
      var currentFocus = !!state.focusMap[state.activeIndex];
      if (!currentFocus) state.activeIndex = firstFocusIndex();
    }
    applyReadingPrefs(root);
    syncView(root);
  }

  function stepFont(root, delta) {
    var current = Storage.normalizeFontScale(prefs().fontScale);
    var next = Utils.clamp(current + delta, 0, 2);
    if (next === current) return;
    Storage.updatePrefs({ fontScale: next });
    applyReadingPrefs(root);
    syncView(root);
    if (global.PoetryApp) global.PoetryApp.toast('正文字号：' + ['小', '中', '大'][next]);
  }

  function toggleTranslation(root) {
    var next = prefs().showTranslation === false;
    Storage.updatePrefs({ showTranslation: next });
    applyReadingPrefs(root);
    syncView(root);
    if (global.PoetryApp) global.PoetryApp.toast(next ? '已显示译文' : '已隐藏译文');
  }

  function toggleFocusMode(root) {
    var next = !prefs().focusMode;
    Storage.updatePrefs({ focusMode: next });
    applyReadingPrefs(root);
    syncView(root);
    if (global.PoetryApp) global.PoetryApp.toast(next ? '已进入专注模式' : '已退出专注模式');
  }

  function handleClick(root, event) {
    var line = event.target.closest ? event.target.closest('[data-line]') : null;
    if (line) {
      var index = Number(line.getAttribute('data-line'));
      if (state.hidden[index]) delete state.hidden[index];
      else state.hidden[index] = true;
      state.activeIndex = index;
      syncView(root);
      return;
    }

    var hint = event.target.closest ? event.target.closest('[data-hint]') : null;
    if (hint && global.PoetryApp) {
      global.PoetryApp.toast('提示：' + hint.getAttribute('data-hint'));
      return;
    }

    var button = event.target.closest ? event.target.closest('[data-action]') : null;
    if (!button) return;
    var action = button.getAttribute('data-action');
    var poem = currentPoem();
    if (!poem) return;

    if (action === 'reveal-all') revealAll(root);
    else if (action === 'hide-all') hideAll(root);
    else if (action === 'toggle-keyword') toggleKeyword(root);
    else if (action === 'prev-line') move(root, -1);
    else if (action === 'next-line') move(root, 1);
    else if (action === 'toggle-recite') toggleRecite(root);
    else if (action === 'toggle-focus') toggleFocusOnly(root);
    else if (action === 'font-down') stepFont(root, -1);
    else if (action === 'font-up') stepFont(root, 1);
    else if (action === 'toggle-translation') toggleTranslation(root);
    else if (action === 'toggle-focusmode') toggleFocusMode(root);
  }

  /** 键盘快捷键：只在学习页由 app.js 统一转发，避免 document 监听器泄漏 */
  function handleKey(event) {
    if (!state.poemId || !state.root) return false;
    var target = event.target;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return false;
    var key = event.key;
    if (key === ' ' || key === 'Spacebar' || key === 'ArrowRight' || key === 'ArrowDown') {
      event.preventDefault();
      if (key === ' ') {
        if (state.activeIndex < 0) state.activeIndex = 0;
        else if (state.hidden[state.activeIndex]) delete state.hidden[state.activeIndex];
        else state.hidden[state.activeIndex] = true;
        syncView(state.root);
      } else {
        move(state.root, 1);
      }
      return true;
    }
    if (key === 'ArrowLeft' || key === 'ArrowUp') {
      event.preventDefault();
      move(state.root, -1);
      return true;
    }
    if (key === 'r' || key === 'R') {
      event.preventDefault();
      revealAll(state.root);
      return true;
    }
    if (key === 'k' || key === 'K') {
      event.preventDefault();
      toggleKeyword(state.root);
      return true;
    }
    if (key === 'f' || key === 'F') {
      event.preventDefault();
      toggleFocusOnly(state.root);
      return true;
    }
    return false;
  }

  function mount(root, options) {
    var opts = options || {};
    var list = opts.list && opts.list.length ? opts.list : [];
    if (!list.length) {
      root.innerHTML = '<div class="card"><div class="empty-state">还没有选择篇目，请先返回选择要背诵的篇目。</div></div>';
      return;
    }
    var wanted = opts.poemId && DB.byId(opts.poemId) ? opts.poemId : '';
    var inList = list.some(function (item) {
      return item.id === wanted;
    });
    var poemId = inList ? wanted : list[0].id;
    state.root = root;
    resetState(poemId, list);
    Storage.markLearned(poemId);
    render(root);

    root.addEventListener('click', function (event) {
      handleClick(root, event);
    });
    root.addEventListener('change', function (event) {
      if (event.target && event.target.id === 'studyPoemSelect') {
        setPoem(root, event.target.value, opts);
      }
    });

    /* 手机左右滑：只在正文区域内生效，避免把下拉选择 / 按钮误判成翻页 */
    var touchStart = null;
    root.addEventListener('touchstart', function (event) {
      if (!event.touches || event.touches.length !== 1) {
        touchStart = null;
        return;
      }
      var inBody = event.target.closest && event.target.closest('#poemBody');
      touchStart = inBody ? { x: event.touches[0].clientX, y: event.touches[0].clientY } : null;
    }, { passive: true });
    root.addEventListener('touchend', function (event) {
      if (!touchStart || !event.changedTouches || !event.changedTouches.length) return;
      var dx = event.changedTouches[0].clientX - touchStart.x;
      var dy = event.changedTouches[0].clientY - touchStart.y;
      touchStart = null;
      if (Math.abs(dx) > 50 && Math.abs(dy) < 40) move(root, dx < 0 ? 1 : -1);
    }, { passive: true });
  }

  global.PoetryStudy = {
    mount: mount,
    handleKey: handleKey,
    currentPoemId: function () {
      return state.poemId;
    },
    applyReadingPrefs: function () {
      if (state.root) applyReadingPrefs(state.root);
    },
  };
})(window);
