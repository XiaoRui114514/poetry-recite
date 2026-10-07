/* 古诗文背诵学习系统 —— 全文学习模式
   交互：点击句子隐藏/显示、显示全部、逐句隐藏、关键词隐藏、上一句/下一句。
   逐句翻译：每句原文下面挂一条对应的现代汉语翻译（数据来自 poem.translation），
   翻译只在该句原文“完整显示”时可见；隐藏时用 visibility 而不是 display，
   保证翻译的布局占位始终存在，隐藏 / 显示不会让整首诗重新排版、页面跳动。 */
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
  };

  /** 作者隐形指纹：随正文复制而传播（零宽字符，不参与阅读与判分） */
  function brandSig() {
    var brand = global.PoetryBrand;
    return brand && brand.signature ? brand.signature() : '';
  }

  function resetState(poemId, list) {
    state.poemId = poemId;
    state.hidden = {};
    state.keywordMode = false;
    state.activeIndex = -1;
    state.list = list;
  }

  function currentPoem() {
    return DB.byId(state.poemId);
  }

  /* ---------------- 逐句翻译 ---------------- */

  /**
   * 与 splitSentences(poem.text) 下标一一对应的翻译数组（缺翻译处为 ''）。
   * 对齐由数据库层负责，页面只按 index 取用，不做任何字符串搜索匹配。
   */
  function poemTranslations(poem) {
    if (!poem || typeof DB.translationLines !== 'function') return [];
    return DB.translationLines(poem);
  }

  /** 翻译区域是否显示（= 该句原文是否完整显示，与 state 单一来源保持一致） */
  function transVisible(index) {
    return !state.hidden[index];
  }

  /* ---------------- 渲染 ---------------- */

  /**
   * 原文纯文本：完整显示 / 整句挖空 / 关键词挖空。
   * 只产出纯文本（可安全地走 textContent），避免每次点击都重新解析 HTML。
   */
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

  function renderSentences(poem) {
    var sentences = Utils.splitSentences(poem.text);
    var translations = poemTranslations(poem);
    return sentences
      .map(function (sentence, index) {
        var hidden = !!state.hidden[index];
        var cls = 'line-item' + (hidden ? ' is-hidden' : '') + (state.activeIndex === index ? ' is-active' : '');
        return (
          '<button type="button" class="' + cls + '" data-line="' + index + '" aria-pressed="' + (hidden ? 'true' : 'false') + '">' +
          '<span class="line-text">' + Utils.escapeHtml(sentenceText(sentence, hidden)) + brandSig() + '</span>' +
          renderTranslation(translations[index], transVisible(index)) +
          '</button>'
        );
      })
      .join('');
  }

  /**
   * 只在原位上改文字与状态，不重建 DOM、不动滚动位置。
   * 翻译的显隐只切 class（CSS 用 visibility），高度不变，所以不会整段上移。
   */
  function updateLines(root) {
    var poem = currentPoem();
    var body = root.querySelector('#poemBody');
    if (!poem || !body) return;
    var nodes = body.querySelectorAll('.line-item');
    var sentences = Utils.splitSentences(poem.text);
    if (nodes.length !== sentences.length) {
      refreshBody(root);
      return;
    }
    var translations = poemTranslations(poem);
    for (var index = 0; index < nodes.length; index += 1) {
      var node = nodes[index];
      var hidden = !!state.hidden[index];
      var textEl = node.querySelector('.line-text');
      var zhEl = node.querySelector('.line-zh');
      if (textEl) textEl.textContent = sentenceText(sentences[index], hidden) + brandSig();
      if (zhEl) {
        // 先更新文字：翻译区域由 CSS 固定占位，改文字不会影响整首诗的高度
        zhEl.textContent = translations[index] || '';
        // 翻译的显示条件 = 当前这一句原文完整显示
        zhEl.classList.toggle('is-off', !transVisible(index));
      }
      node.classList.toggle('is-hidden', hidden);
      node.classList.toggle('is-active', state.activeIndex === index);
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

    root.innerHTML =
      '<section class="card">' +
        '<div class="poem-switch">' +
          '<label class="filter-label" for="studyPoemSelect">切换篇目（共 ' + state.list.length + ' 篇）</label>' +
          '<select id="studyPoemSelect">' + options + '</select>' +
        '</div>' +
        '<div class="study-toolbar">' +
          '<button type="button" class="btn btn-sm" data-action="reveal-all">显示全部</button>' +
          '<button type="button" class="btn btn-sm" data-action="hide-all">逐句隐藏</button>' +
          '<button type="button" class="btn btn-sm' + (state.keywordMode ? ' btn-primary' : '') + '" data-action="toggle-keyword">关键词隐藏</button>' +
          '<button type="button" class="btn btn-sm" data-action="prev-line">上一句</button>' +
          '<button type="button" class="btn btn-sm" data-action="next-line">下一句</button>' +
        '</div>' +
      '</section>' +
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
        '<div class="poem-body" id="poemBody">' + renderSentences(poem) + '</div>' +
        '<div class="hint-bar">' +
          '<span class="tiny muted">点击任意句子可以隐藏 / 显示，方便自己先背一遍。</span>' +
          '<span class="tiny muted" id="studyProgress">' +
            Object.keys(state.hidden).length + ' / ' + Utils.splitSentences(poem.text).length + ' 句已隐藏' +
          '</span>' +
        '</div>' +
        '<dl class="poem-meta-block">' + renderMeta(poem) + renderHints(poem) + '</dl>' +
      '</section>';
  }

  function updateCounters(root) {
    var counter = root.querySelector('#studyProgress');
    var poem = currentPoem();
    if (counter && poem) {
      counter.textContent = Object.keys(state.hidden).length + ' / ' + Utils.splitSentences(poem.text).length + ' 句已隐藏';
    }
  }

  /** 全文重建（只在切换篇目 / 首次渲染时用）；日常交互走 updateLines，不重建 DOM */
  function refreshBody(root) {
    var poem = currentPoem();
    var body = root.querySelector('#poemBody');
    if (!poem || !body) return;
    body.innerHTML = renderSentences(poem);
    syncToolbar(root);
    updateCounters(root);
  }

  function syncToolbar(root) {
    var keywordBtn = root.querySelector('[data-action="toggle-keyword"]');
    if (keywordBtn) {
      keywordBtn.classList.toggle('btn-primary', state.keywordMode);
      keywordBtn.setAttribute('aria-pressed', state.keywordMode ? 'true' : 'false');
    }
  }

  /** 一次交互统一收尾：同步诗句、工具栏高亮与计数 */
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
    var poem = currentPoem();
    if (!poem) return;
    var total = Utils.splitSentences(poem.text).length;
    if (!total) return;
    var next = state.activeIndex + delta;
    if (next < 0) next = 0;
    if (next >= total) next = total - 1;
    state.activeIndex = next;
    syncView(root);
    var active = root.querySelector('.line-item.is-active');
    if (active && active.scrollIntoView) active.scrollIntoView({ block: 'center', behavior: 'smooth' });
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

    if (action === 'reveal-all') {
      state.hidden = {};
      state.keywordMode = false;
      state.activeIndex = -1;
      syncView(root);
    } else if (action === 'hide-all') {
      Utils.splitSentences(poem.text).forEach(function (_, index) {
        state.hidden[index] = true;
      });
      syncView(root);
    } else if (action === 'toggle-keyword') {
      state.keywordMode = !state.keywordMode;
      if (state.keywordMode) {
        Utils.splitSentences(poem.text).forEach(function (_, index) {
          state.hidden[index] = true;
        });
      }
      syncView(root);
    } else if (action === 'prev-line') {
      move(root, -1);
    } else if (action === 'next-line') {
      move(root, 1);
    }
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
  }

  global.PoetryStudy = {
    mount: mount,
    currentPoemId: function () {
      return state.poemId;
    },
  };
})(window);
