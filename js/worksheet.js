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

  function writingLines(answerText) {
    var length = Utils.normalizeText(answerText || '').length;
    var lines = Utils.clamp(Math.ceil(length / 18), 2, 5);
    return '<div class="ws-write" style="--ws-lines:' + lines + '"></div>';
  }

  function renderQuestions() {
    if (!state.questions.length) {
      return '<div class="ws-empty">' + Utils.escapeHtml(state.notice || '没有可打印的题目。') + '</div>';
    }
    return state.questions
      .map(function (question, index) {
        var meta = '《' + Utils.escapeHtml(question.poemTitle) + '》 · ' + Utils.escapeHtml(question.poemAuthor) +
          ' · <span class="ws-mode">' + Utils.escapeHtml(modeLabel(question.mode)) + '</span>';
        return (
          '<article class="ws-question">' +
            '<div class="ws-q-head"><span class="ws-q-num">' + (index + 1) + '.</span><span class="ws-q-meta">' + meta + '</span></div>' +
            '<div class="ws-q-prompt">' + question.promptHtml + '</div>' +
            writingLines(question.answerText) +
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
        '<p class="section-desc">从当前已选的 ' + state.list.length + ' 篇里生成一张 A4 练习纸，答案可以单独成页；用浏览器打印即可，也可以“另存为 PDF”。</p>' +
        '<div class="print-options">' +
          '<label class="print-field"><span class="filter-label">题型</span><select id="printMode">' + modeOptions + '</select></label>' +
          '<label class="print-field"><span class="filter-label">题量</span><select id="printCount">' + countOptions + '</select></label>' +
          '<label class="print-check"><input type="checkbox" id="printAnswers"' + (state.includeAnswers ? ' checked' : '') + '> 附答案页</label>' +
          '<label class="print-check"><input type="checkbox" id="printFocus"' + (state.focusOnly ? ' checked' : '') + '> 只出考试重点句</label>' +
        '</div>' +
        '<div class="select-actions" style="margin-top:0.9rem;">' +
          '<button type="button" class="btn btn-primary" data-print-action="print">打印 / 另存 PDF</button>' +
          '<button type="button" class="btn" data-print-action="regenerate">换一组</button>' +
          '<span class="tiny muted">打印时浏览器会自动隐藏按钮和设置区。</span>' +
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
        if (global.print) global.print();
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
