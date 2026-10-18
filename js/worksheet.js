/* 古诗文背诵学习系统 —— 打印默写纸
   纯前端生成一张 A4 练习纸：题目区 + 可选的答案页，用浏览器自带的打印 / 另存 PDF。
   不引入任何第三方库，也不请求网络。 */
(function (global) {
  'use strict';

  var Utils = global.PoetryUtils;
  var DB = global.PoetryDatabase;
  var Storage = global.PoetryStorage;
  var Quiz = global.PoetryQuiz;

  var COUNT_OPTIONS = [10, 20, 30, 50];
  var state = {
    list: [],
    mode: 'blank-full',
    count: 20,
    includeAnswers: true,
    focusOnly: false,
    questions: [],
    notice: '',
    root: null,
  };

  function modeLabel(key) {
    if (Quiz && Quiz.modeLabel) return Quiz.modeLabel(key);
    return '默写';
  }

  function modes() {
    return Quiz && Quiz.MODES ? Quiz.MODES : [{ key: 'blank-full', label: '整句挖空' }];
  }

  function focusFilter() {
    if (!state.focusOnly) return null;
    return function (poem, unit) {
      return !!DB.examFocusMap(poem)[unit.index];
    };
  }

  function generate() {
    state.notice = '';
    if (!Quiz || !Quiz.__internals || !state.list.length) {
      state.questions = [];
      return;
    }
    var candidates = Quiz.__internals.allCandidates(state.list, [state.mode], focusFilter());
    state.questions = Utils.shuffle(candidates).slice(0, state.count);
    if (!state.questions.length) {
      state.notice = state.focusOnly
        ? '当前篇目没有可用的考试重点句，取消「只出重点句」再试。'
        : '当前条件下没有可生成的题目，换一种题型或增加篇目再试。';
    } else if (state.questions.length < state.count) {
      state.notice = '当前条件最多可生成 ' + state.questions.length + ' 题，已按实际数量打印。';
    }
  }

  function writingLines(answerText, mode) {
    var length = Utils.normalizeText(answerText || '').length;
    /* 有挖空的题型，答案直接写在句中的下划线上，下面只留一行备写；
       整句默写 / 看译文写原文没有可见下划线，才需要多行书写空间。 */
    var lines = mode === 'full' || mode === 'translation'
      ? Utils.clamp(Math.ceil(length / 18), 2, 5)
      : 1;
    return '<div class="ws-write" style="--ws-lines:' + lines + '"></div>';
  }

  /** 打印纸上的挖空改成下划线，比方框更像“填空纸”，截图 / 打印都更干净 */
  function blankMark(run) {
    return '<span class="ws-blank" style="--ws-chars:' + String(run || '').length + '"></span>';
  }

  function printPrompt(html) {
    var src = String(html == null ? '' : html);
    // 先把 quiz.js 生成的空白方框整块替换，再兜底处理 keyword 题型里的裸 □
    src = src.replace(/<span class="blank-unit">(□+)<\/span>/g, function (_, run) {
      return blankMark(run);
    });
    src = src.replace(/□+/g, function (run) {
      return blankMark(run);
    });
    return src;
  }

  /**
   * 整句挖空 / 整句默写没有可见原句，补上一句 / 下一句作为语境，
   * 否则《梦游天姥吟留别》这种长诗里的“□□□□□□□？”根本无法定位。
   */
  function contextHtml(question) {
    if (!question || (question.mode !== 'blank-full' && question.mode !== 'full')) return '';
    var poem = DB.byId(question.poemId);
    if (!poem) return '';
    var sentences = Utils.splitSentences(poem.text);
    var index = question.sentenceIndex;
    if (typeof index !== 'number' || index < 0 || index >= sentences.length) return '';
    var parts = [];
    if (index > 0) parts.push('<span><b>上一句</b>' + Utils.escapeHtml(sentences[index - 1]) + '</span>');
    if (index + 1 < sentences.length) parts.push('<span><b>下一句</b>' + Utils.escapeHtml(sentences[index + 1]) + '</span>');
    if (!parts.length) return '';
    return '<div class="ws-context">' + parts.join('') + '</div>';
  }

  function renderQuestions() {
    if (!state.questions.length) {
      return '<div class="ws-empty">' + Utils.escapeHtml(state.notice || '没有可打印的题目。') + '</div>';
    }
    return state.questions
      .map(function (question, index) {
        var sentenceNo = typeof question.sentenceIndex === 'number' ? ' · 第 ' + (question.sentenceIndex + 1) + ' 句' : '';
        var meta = '《' + Utils.escapeHtml(question.poemTitle) + '》 · ' + Utils.escapeHtml(question.poemAuthor) +
          ' · <span class="ws-mode">' + Utils.escapeHtml(modeLabel(question.mode)) + '</span>' +
          '<span class="ws-sentence-no">' + Utils.escapeHtml(sentenceNo) + '</span>';
        return (
          '<article class="ws-question">' +
            '<div class="ws-q-head"><span class="ws-q-num">' + (index + 1) + '.</span><span class="ws-q-meta">' + meta + '</span></div>' +
            contextHtml(question) +
            '<div class="ws-q-prompt">' + printPrompt(question.promptHtml) + '</div>' +
            writingLines(question.answerText, question.mode) +
          '</article>'
        );
      })
      .join('');
  }

  function renderAnswers() {
    if (!state.includeAnswers || !state.questions.length) return '';
    return (
      '<section class="ws-answers">' +
        '<h2>参考答案</h2>' +
        '<ol>' +
        state.questions
          .map(function (question) {
            return '<li><span class="ws-answer-title">《' + Utils.escapeHtml(question.poemTitle) + '》</span>' +
              Utils.escapeHtml(question.answerText) + '</li>';
          })
          .join('') +
        '</ol>' +
      '</section>'
    );
  }

  function sheetHtml() {
    var total = state.questions.length;
    return (
      '<section class="print-sheet" id="printSheet">' +
        '<header class="ws-head">' +
          '<p class="ws-kicker">上海初高古诗文背诵 · 默写练习</p>' +
          '<h1>古诗文默写练习</h1>' +
          '<p class="ws-info">姓名：____________　日期：____________　用时：______ 分钟　得分：______</p>' +
          '<p class="ws-info ws-info-sub">共 ' + total + ' 题 · ' + Utils.escapeHtml(modeLabel(state.mode)) + (state.focusOnly ? ' · 只练考试重点句' : '') + ' · 每句请写完整，注意易错字。</p>' +
        '</header>' +
        '<div class="ws-list">' + renderQuestions() + '</div>' +
        renderAnswers() +
        '<footer class="ws-foot">Hison 制作 · 仅供个人免费学习 · 抖音 XRuiiiiii · 小红书 xiaoruiaaa520</footer>' +
      '</section>'
    );
  }

  /** 收集当前页面的样式，供“干净打印窗口”复用，避免纸张样式丢失 */
  function collectCss() {
    var out = [];
    var sheets = document.styleSheets || [];
    for (var i = 0; i < sheets.length; i += 1) {
      var rules = null;
      try {
        rules = sheets[i].cssRules;
      } catch (err) {
        rules = null;
      }
      if (!rules) continue;
      for (var j = 0; j < rules.length; j += 1) {
        try {
          out.push(rules[j].cssText);
        } catch (err) {
          /* 忽略无法读取的规则 */
        }
      }
    }
    return out.join('\n');
  }

  function standaloneCss() {
    return [
      'html, body { margin: 0; padding: 0; background: #fff; }',
      'body { color: #1c1a17; }',
      '.print-sheet { max-width: none; margin: 0; padding: 0; border: 0; border-radius: 0; background: #fff; }',
      '.print-window-note { display: none; }',
      '@page { size: A4; margin: 16mm; }',
    ].join('\n');
  }

  /**
   * 打开一个只包含练习纸的新窗口再打印：
   * 页面上的浏览器插件 / 浮层 / 扩展工具栏不会进入新窗口，避免被一起截进打印预览。
   * 若浏览器拦截弹窗，则退回直接打印当前页（此时仍有 @media print 的可见性隔离兜底）。
   */
  function openPrintWindow() {
    var win = null;
    try {
      win = global.open('', '_blank', 'width=920,height=1200');
    } catch (err) {
      win = null;
    }
    if (!win) {
      if (global.print) global.print();
      return;
    }
    var html = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">' +
      '<title>古诗文默写练习</title>' +
      '<style>' + collectCss() + '\n' + standaloneCss() + '</style>' +
      '</head><body class="print-window">' + sheetHtml() + '</body></html>';
    try {
      win.document.open();
      win.document.write(html);
      win.document.close();
    } catch (err) {
      try { win.close(); } catch (closeErr) { /* 忽略 */ }
      if (global.print) global.print();
      return;
    }
    win.focus();
    var trigger = function () {
      try {
        win.print();
      } catch (err) {
        /* 某些浏览器不允许脚本打印，保留窗口让用户手动 Ctrl+P */
      }
    };
    if (win.document.readyState === 'complete') setTimeout(trigger, 250);
    else win.addEventListener('load', function () { setTimeout(trigger, 250); });
    win.onafterprint = function () {
      try { win.close(); } catch (err) { /* 忽略 */ }
    };
  }

  function settingsHtml() {
    var modeOptions = modes()
      .map(function (mode) {
        return '<option value="' + Utils.escapeHtml(mode.key) + '"' + (mode.key === state.mode ? ' selected' : '') + '>' + Utils.escapeHtml(mode.label) + '</option>';
      })
      .join('');
    var countOptions = COUNT_OPTIONS
      .map(function (n) {
        return '<option value="' + n + '"' + (n === state.count ? ' selected' : '') + '>' + n + ' 题</option>';
      })
      .join('');
    return (
      '<section class="card print-toolbar">' +
        '<h2 class="section-title">打印默写纸</h2>' +
        '<p class="section-desc">从当前已选的 ' + state.list.length + ' 篇里生成一张 A4 练习纸，答案可以单独成页；点打印会打开只含练习纸的干净窗口，避免浏览器插件被一起截进打印预览。</p>' +
        '<div class="print-options">' +
          '<label class="print-field"><span class="filter-label">题型</span><select id="printMode">' + modeOptions + '</select></label>' +
          '<label class="print-field"><span class="filter-label">题量</span><select id="printCount">' + countOptions + '</select></label>' +
          '<label class="print-check"><input type="checkbox" id="printAnswers"' + (state.includeAnswers ? ' checked' : '') + '> 附答案页</label>' +
          '<label class="print-check"><input type="checkbox" id="printFocus"' + (state.focusOnly ? ' checked' : '') + '> 只出考试重点句</label>' +
        '</div>' +
        '<div class="select-actions" style="margin-top:0.9rem;">' +
          '<button type="button" class="btn btn-primary" data-print-action="print">打印 / 另存 PDF</button>' +
          '<button type="button" class="btn" data-print-action="regenerate">换一组</button>' +
          '<span class="tiny muted">会打开干净打印窗口；浏览器的“页眉和页脚”可在打印设置里关闭。</span>' +
        '</div>' +
        (state.notice ? '<p class="tiny muted" role="status">' + Utils.escapeHtml(state.notice) + '</p>' : '') +
      '</section>'
    );
  }

  function render(root) {
    root.innerHTML = settingsHtml() + sheetHtml();
  }

  function mount(root, options) {
    var opts = options || {};
    state.list = opts.list || [];
    state.root = root;
    generate();
    render(root);
    root.addEventListener('click', function (event) {
      var button = event.target.closest ? event.target.closest('[data-print-action]') : null;
      if (!button) return;
      var action = button.getAttribute('data-print-action');
      if (action === 'print') {
        openPrintWindow();
      } else if (action === 'regenerate') {
        generate();
        render(root);
      }
    });
    root.addEventListener('change', function (event) {
      var target = event.target;
      if (!target) return;
      if (target.id === 'printMode') {
        state.mode = target.value;
        generate();
        render(root);
      } else if (target.id === 'printCount') {
        state.count = Number(target.value) || 20;
        generate();
        render(root);
      } else if (target.id === 'printAnswers') {
        state.includeAnswers = !!target.checked;
        render(root);
      } else if (target.id === 'printFocus') {
        state.focusOnly = !!target.checked;
        generate();
        render(root);
      }
    });
  }

  global.PoetryWorksheet = {
    mount: mount,
    currentState: function () {
      return {
        mode: state.mode,
        count: state.count,
        includeAnswers: state.includeAnswers,
        focusOnly: state.focusOnly,
        questionCount: state.questions.length,
      };
    },
  };
})(window);
