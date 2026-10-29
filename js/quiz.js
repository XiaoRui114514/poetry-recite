/* 古诗文背诵学习系统 —— 默写自测
   出题思路参考原“上海中考古诗词默写自测”：卡片 + 眼睛按钮展开答案 + 显示全部答案。
   在此基础上增加多种题型、随机组合、判分与错题本。

   v1.5：
   - 新增「看译文写原文」（理解性默写），直接使用题库里的逐句翻译；
   - 新增「重点句 / 名句」题目范围，以及「今日复习」练习范围；
   - 错题记录到题目级，支持原题重练；判分只更新当前题卡，不再重建整组。 */
(function (global) {
  'use strict';

  var Utils = global.PoetryUtils;
  var DB = global.PoetryDatabase;
  var Storage = global.PoetryStorage;

  var MODES = [
    { key: 'blank-full', label: '整句挖空', desc: '给出篇目，整句用 □ 表示，自己默写整句。' },
    { key: 'next', label: '给上句写下句', desc: '给出上句，默写下句。' },
    { key: 'prev', label: '给下句写上句', desc: '给出下句，默写上句。' },
    { key: 'keyword', label: '关键词提示', desc: '只保留首字与关键词，提示下完成默写。' },
    { key: 'mixed', label: '随机挖空', desc: '在句中随机挖空词语或易错字。' },
    { key: 'full', label: '整句默写', desc: '只给篇目和句序，完整默写该句。' },
    { key: 'translation', label: '看译文写原文', desc: '给出这句的现代汉语翻译，默写对应原文。' },
  ];
  var MODE_KEY_LIST = MODES.map(function (item) {
    return item.key;
  });

  var state = {
    questions: [],
    answered: {},
    showAll: false,
    notice: '',       // 题目数量不足 / 错题本为空等提示
    scope: 'all',     // 'all' | 'wrong' | 'focus' | 'review'
    focusPoemId: '',  // 指定“只练某一篇”时的篇目 id
    questionFilter: 'none', // 'none' | 'exam' | 'name'
    focusKey: '',     // 从错题本“只练这句”进入时的题目 key
  };
  var lastBatchKeys = [];
  var unitsCache = Object.create(null);
  var translationCache = Object.create(null);
  var focusCache = Object.create(null);
  var nameCache = Object.create(null);

  /** 作者隐形指纹：随题目 / 答案复制而传播 */
  function brandSig() {
    return global.PoetryBrand && global.PoetryBrand.signature ? global.PoetryBrand.signature() : '';
  }

  function modeLabel(key) {
    for (var i = 0; i < MODES.length; i += 1) {
      if (MODES[i].key === key) return MODES[i].label;
    }
    return '默写';
  }

  function blankHtml(text, hideChars) {
    var blanked = Utils.makeBlank(text, hideChars || null);
    return Utils.escapeHtml(blanked).replace(/□+/g, function (run) {
      return '<span class="blank-unit">' + run + '</span>';
    });
  }

  function translationsOf(poem) {
    if (!poem || !poem.id) return [];
    if (!translationCache[poem.id]) translationCache[poem.id] = DB.translationLines(poem);
    return translationCache[poem.id];
  }

  function focusMapOf(poem) {
    if (!poem || !poem.id) return Object.create(null);
    if (!focusCache[poem.id]) focusCache[poem.id] = DB.examFocusMap(poem);
    return focusCache[poem.id];
  }

  function nameMapOf(poem) {
    if (!poem || !poem.id) return Object.create(null);
    if (!nameCache[poem.id]) nameCache[poem.id] = DB.nameSentenceMap(poem);
    return nameCache[poem.id];
  }

  function keywordOf(poem, sentence) {
    var highlights = poem.highlights || [];
    for (var i = 0; i < highlights.length; i += 1) {
      var item = highlights[i];
      var key = Utils.stripPunctuation(item.text).slice(0, 2);
      if (key && (item.type === '名句' || item.type === '关键词') && sentence.indexOf(key) !== -1) {
        return item.text;
      }
    }
    var clauses = Utils.splitClauses(sentence);
    if (!clauses.length) return '';
    return Utils.stripPunctuation(clauses[0]).slice(0, 2);
  }

  function errataOf(poem, sentence) {
    var found = [];
    (poem.highlights || []).forEach(function (item) {
      if (item.type !== '易错字' && item.type !== '错别字') return;
      Utils.stripPunctuation(item.text)
        .split('')
        .forEach(function (ch) {
          if (sentence.indexOf(ch) !== -1 && found.indexOf(ch) === -1) found.push(ch);
        });
    });
    return found.join('');
  }

  /** 为一个篇目收集所有可出题素材（题目级 key 需要稳定的句序 / 小句对序） */
  function unitsOf(poem) {
    if (!poem || !poem.id) return [];
    if (unitsCache[poem.id]) return unitsCache[poem.id];
    var sentences = Utils.splitSentences(poem.text);
    var units = [];
    sentences.forEach(function (sentence, sIndex) {
      var clauses = Utils.splitClauses(sentence);
      if (!Utils.stripPunctuation(sentence).length) return;
      units.push({ kind: 'sentence', sentence: sentence, index: sIndex, clauses: clauses });
      for (var i = 0; i + 1 < clauses.length; i += 1) {
        if (Utils.stripPunctuation(clauses[i]).length < 2) continue;
        if (Utils.stripPunctuation(clauses[i + 1]).length < 2) continue;
        units.push({ kind: 'pair', sentence: sentence, index: sIndex, left: clauses[i], right: clauses[i + 1], pairIndex: i });
      }
    });
    unitsCache[poem.id] = units;
    return units;
  }

  function buildQuestion(poem, unit, mode) {
    var question = {
      poemId: poem.id,
      poemTitle: poem.title,
      poemAuthor: poem.author,
      mode: mode,
      modeLabel: modeLabel(mode),
      key: poem.id + '|' + mode + '|' + unit.index + '|' + (unit.pairIndex == null ? 's' : unit.pairIndex),
      hint: '',
      promptHtml: '',
      answerText: unit.sentence,
      position: unit.index + 1,
      sentenceIndex: unit.index,
      pairIndex: unit.pairIndex == null ? null : unit.pairIndex,
    };

    if (mode === 'next') {
      var pair = unit.kind === 'pair' ? unit : null;
      if (!pair) return null;
      question.promptHtml = Utils.escapeHtml(pair.left) + blankHtml(pair.right);
      question.answerText = pair.left + pair.right;
      question.hint = '写出下句（可与标点一起默写）';
      return question;
    }
    if (mode === 'prev') {
      var pairPrev = unit.kind === 'pair' ? unit : null;
      if (!pairPrev) return null;
      question.promptHtml = blankHtml(pairPrev.left) + Utils.escapeHtml(pairPrev.right);
      question.answerText = pairPrev.left + pairPrev.right;
      question.hint = '补出上句';
      return question;
    }
    if (mode === 'translation') {
      /* 只对整句出题：译文与原文严格一一对应，pair 小句不单独拿译文 */
      if (unit.kind !== 'sentence') return null;
      var line = translationsOf(poem)[unit.index];
      if (!line) return null;
      question.promptHtml = '<span class="context-hint">看译文写原文</span>' +
        '<span class="translation-prompt">' + Utils.escapeHtml(line) + '</span>';
      question.hint = '根据译文写出对应原文（标点可以省略）';
      return question;
    }
    if (unit.kind !== 'sentence') return null;

    if (mode === 'blank-full') {
      question.promptHtml = blankHtml(unit.sentence);
      question.hint = '整句默写';
      return question;
    }
    if (mode === 'full') {
      /* 本题型只给篇目与句序，连 □ 长度提示都不给，和“整句挖空”区分开 */
      question.promptHtml = '<span class="context-hint">请默写本篇第 ' + (unit.index + 1) + ' 句（共 ' + Utils.splitSentences(poem.text).length + ' 句）</span>';
      question.hint = '整句默写';
      return question;
    }
    if (mode === 'keyword') {
      question.promptHtml = unit.clauses
        .map(function (clause) {
          return Utils.escapeHtml(Utils.blankKeepFirst(clause));
        })
        .join('');
      question.hint = '关键词提示：' + keywordOf(poem, unit.sentence);
      return question;
    }
    if (mode === 'mixed') {
      var errata = errataOf(poem, unit.sentence);
      if (errata) {
        question.promptHtml = blankHtml(unit.sentence, errata);
        question.hint = '重点挖空易错字';
      } else if (unit.clauses.length > 1) {
        var blankIndex = Math.floor(Utils.random() * unit.clauses.length);
        question.promptHtml = unit.clauses
          .map(function (clause, idx) {
            return idx === blankIndex ? blankHtml(clause) : Utils.escapeHtml(clause);
          })
          .join('');
        question.hint = '随机挖空其中一句';
      } else {
        question.promptHtml = blankHtml(unit.sentence);
        question.hint = '整句默写';
      }
      return question;
    }
    return null;
  }

  /**
   * 枚举这批篇目 + 这批题型下所有可能的题目。
   * filter(poem, unit) 可选，用于“只练重点句 / 名句”。
   * 这样“最多能出多少题”是算出来的，而不是靠概率去碰，
   * 素材不足时可以如实告诉用户本次只能生成多少题。
   */
  function allCandidates(poems, modes, filter) {
    var seen = Object.create(null);
    var out = [];
    var filterFn = typeof filter === 'function' ? filter : null;
    Utils.shuffle(poems).forEach(function (poem) {
      unitsOf(poem).forEach(function (unit) {
        if (filterFn && !filterFn(poem, unit)) return;
        modes.forEach(function (mode) {
          var question = buildQuestion(poem, unit, mode);
          if (!question || seen[question.key]) return;
          seen[question.key] = true;
          out.push(question);
        });
      });
    });
    return out;
  }

  function pickQuestions(poems, options) {
    var opts = options || {};
    var count = Utils.clamp(Math.floor(Number(opts.count)) || 10, 1, 60);
    // 非法题型直接丢弃；全部非法时按“随机组合”处理
    var modes = Utils.unique(
      Utils.toArray(opts.modes).filter(function (key) {
        return MODE_KEY_LIST.indexOf(key) !== -1;
      })
    );
    if (!modes.length) modes = MODE_KEY_LIST.slice();

    var candidates = allCandidates(poems, modes, opts.filter);
    var onlyKeys = Utils.unique(Utils.toArray(opts.onlyKeys));
    if (onlyKeys.length) {
      var onlySet = Object.create(null);
      onlyKeys.forEach(function (key) { onlySet[key] = true; });
      candidates = candidates.filter(function (question) {
        return !!onlySet[question.key];
      });
    }

    var preferKeys = Utils.unique(Utils.toArray(opts.preferKeys));
    var preferSet = Object.create(null);
    preferKeys.forEach(function (key) { preferSet[key] = true; });
    var preferred = candidates.filter(function (question) {
      return !!preferSet[question.key];
    });
    var rest = candidates.filter(function (question) {
      return !preferSet[question.key];
    });
    var fresh = rest.filter(function (question) {
      return lastBatchKeys.indexOf(question.key) === -1;
    });
    var stale = rest.filter(function (question) {
      return lastBatchKeys.indexOf(question.key) !== -1;
    });

    var ordered = onlyKeys.length
      ? Utils.shuffle(candidates)
      : Utils.shuffle(preferred).concat(
          fresh.length >= count
            ? Utils.shuffle(fresh)
            : Utils.shuffle(fresh).concat(Utils.shuffle(stale))
        );
    var questions = ordered.slice(0, count);
    lastBatchKeys = questions.map(function (item) {
      return item.key;
    });
    return questions;
  }

  function compareAnswer(input, expected) {
    var clean=function(t){return Utils.stripPunctuation(Utils.normalizeText(t)).slice(0,400);};
    var a=Array.from(clean(input)), b=Array.from(clean(expected)), rows=[];
    for(var i=0;i<=a.length;i++){ rows[i]=[]; for(var j=0;j<=b.length;j++) rows[i][j]=i===0?j:j===0?i:0; }
    for(i=1;i<=a.length;i++)for(j=1;j<=b.length;j++) rows[i][j]=a[i-1]===b[j-1]?rows[i-1][j-1]:1+Math.min(rows[i-1][j],rows[i][j-1],rows[i-1][j-1]);
    var parts=[]; i=a.length; j=b.length;
    while(i||j){
      if(i&&j&&a[i-1]===b[j-1]){parts.unshift(Utils.escapeHtml(b[--j]));i--;}
      else if(i&&j&&rows[i][j]===rows[i-1][j-1]+1){parts.unshift('<del>'+Utils.escapeHtml(a[--i])+'</del><ins>'+Utils.escapeHtml(b[--j])+'</ins>');}
      else if(j&&rows[i][j]===rows[i][j-1]+1){parts.unshift('<ins>'+Utils.escapeHtml(b[--j])+'</ins>');}
      else {parts.unshift('<del>'+Utils.escapeHtml(a[--i])+'</del>');}
    }
    return {correct:rows[a.length][b.length]===0,html:parts.join('')};
  }
  function renderQuestion(question, index) {
    var answered = state.answered[question.key];
    var show = state.showAll || (answered && answered.showAnswer);
    return (
      '<article class="quiz-card" data-key="' + Utils.escapeHtml(question.key) + '">' +
        '<div class="card-header">' +
          '<div style="flex:1;min-width:0;">' +
            '<div class="card-meta">' +
              '<span>第 ' + (index + 1) + ' 题</span>' +
              '<span class="badge mode-badge">' + Utils.escapeHtml(question.modeLabel) + '</span>' +
              '<span class="badge badge-primary">《' + Utils.escapeHtml(question.poemTitle) + '》· ' + Utils.escapeHtml(question.poemAuthor) + '</span>' +
              (answered ? '<span class="badge ' + (answered.correct ? 'badge-success' : 'badge-danger') + '">' + (answered.correct ? '答对' : '答错') + '</span>' : '') +
            '</div>' +
            '<div class="question-text">' + question.promptHtml + brandSig() + '</div>' +
            (question.hint ? '<div class="tiny muted">' + Utils.escapeHtml(question.hint) + '</div>' : '') +
          '</div>' +
          '<button type="button" class="btn-eye" data-action="toggle-answer" aria-label="显示或隐藏答案" aria-expanded="' + (show ? 'true' : 'false') + '">' +
            '<svg viewBox="0 0 24 24" class="show-eye' + (show ? ' hidden' : '') + '" aria-hidden="true"><path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path><path d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path></svg>' +
            '<svg viewBox="0 0 24 24" class="hide-eye' + (show ? '' : ' hidden') + '" aria-hidden="true"><path d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"></path></svg>' +
          '</button>' +
        '</div>' +
        '<div class="answer-wrapper' + (show ? ' show' : '') + '">' +
          '<div class="answer-content"><div class="answer-inner">' +
            '<div class="answer-badge-text"><span class="badge badge-success">答案</span><span class="answer-text">' + Utils.escapeHtml(question.answerText) + brandSig() + '</span></div>' +
          '</div></div>' +
        '</div>' +
        '<div class="typed-answer"><label>输入默写（可选）<input type="text" maxlength="400" data-typed="'+Utils.escapeHtml(question.key)+'" value="'+Utils.escapeHtml((state.typed||{})[question.key]||'')+'" autocomplete="off"></label>' +
        '<button type="button" class="btn btn-sm" data-action="compare-input" data-key="'+Utils.escapeHtml(question.key)+'">对照错字</button><div data-diff role="status"></div><p class="tiny muted">忽略空白与标点；删除线是多写/错字，下划线是漏字/参考字。异文请核对教材后自行判定。</p></div>' +
        '<div class="grade-row">' +
          '<button type="button" class="btn btn-sm btn-success" data-action="mark-right" data-key="' + Utils.escapeHtml(question.key) + '"' + (answered ? ' disabled' : '') + '>✔ 默写正确</button>' +
          '<button type="button" class="btn btn-sm" data-action="mark-wrong" data-key="' + Utils.escapeHtml(question.key) + '"' + (answered ? ' disabled' : '') + '>✘ 加入错题</button>' +
          (answered ? '<span class="tiny muted">已判定 ' + (answered.correct ? '答对' : '答错') + '，换一批或清空本轮可重做</span>' : '') +
        '</div>' +
      '</article>'
    );
  }

  function statsLine() {
    var answered = Object.keys(state.answered).length;
    var correct = Object.keys(state.answered).filter(function (key) {
      return state.answered[key].correct;
    }).length;
    return '本轮 ' + state.questions.length + ' 题 · 已作答 ' + answered + ' 题 · 正确 ' + correct + ' 题';
  }

  /** 当前是否处于“只练某一篇”模式 */
  function focusOf(list) {
    if (!state.focusPoemId) return null;
    var found = null;
    Utils.toArray(list).forEach(function (poem) {
      if (poem.id === state.focusPoemId) found = poem;
    });
    return found;
  }

  /** 按当前练习范围取出篇目；错题本 / 今日复习为空时回退到全部已选篇目 */
  function scopePoems(list, focusPoem) {
    if (state.scope === 'focus') {
      if (focusPoem) return { list: [focusPoem], notice: '' };
      state.scope = 'all'; // 兜底：focus 篇目不存在时不允许停留在 focus 状态
    }
    if (state.scope === 'wrong') {
      var wrongIds = Storage.getState().wrongBook.map(function (item) {
        return item.id;
      });
      var filtered = list.filter(function (poem) {
        return wrongIds.indexOf(poem.id) !== -1;
      });
      if (filtered.length) return { list: filtered, notice: '' };
      return { list: list, notice: '错题本是空的，已按全部已选篇目出题。' };
    }
    if (state.scope === 'review') {
      var dueIds = Storage.duePoemIds();
      var dueList = list.filter(function (poem) {
        return dueIds.indexOf(poem.id) !== -1;
      });
      if (dueList.length) return { list: dueList, notice: '' };
      return { list: list, notice: '今天没有到期复习的篇目，已按全部已选篇目出题。' };
    }
    return { list: list, notice: '' };
  }

  function questionFilterFn(filter) {
    if (filter === 'exam') {
      return function (poem, unit) {
        return !!focusMapOf(poem)[unit.index];
      };
    }
    if (filter === 'name') {
      return function (poem, unit) {
        return !!nameMapOf(poem)[unit.index];
      };
    }
    return null;
  }

  function renderQuestions(root, options) {
    var box = root.querySelector('#quizList');
    if (!box) return;
    if (!state.questions.length) {
      box.innerHTML = '<div class="card"><div class="empty-state">还没有题目，点击「生成题目 / 换一批」开始默写自测；如果刚切了题目范围，也可以换回「全部句子」。</div></div>';
      updateChrome(root);
      if (options && options.onProgress) options.onProgress();
      return;
    }
    box.innerHTML = state.questions.map(renderQuestion).join('');
    updateChrome(root);
    if (options && options.onProgress) options.onProgress();
  }

  function updateChrome(root) {
    var counter = root.querySelector('#quizCounter');
    if (counter) counter.textContent = statsLine();
    var notice = root.querySelector('#quizNotice');
    if (notice) {
      notice.textContent = state.notice || '';
      notice.hidden = !state.notice;
    }
    var btn = root.querySelector('[data-action="toggle-all"]');
    if (btn) btn.textContent = state.showAll ? '隐藏全部答案' : '显示全部答案';
  }

  function render(root, options) {
    var opts = options || {};
    var prefs = Storage.getState().prefs;
    var modes = prefs.modes && prefs.modes.length ? prefs.modes : [];
    var focusPoem = focusOf(opts.list);
    var wrongCount = Storage.getState().wrongBook.filter(function (item) {
      return opts.list.some(function (poem) {
        return poem.id === item.id;
      });
    }).length;
    var dueIds = Storage.duePoemIds();
    var dueCount = opts.list.filter(function (poem) {
      return dueIds.indexOf(poem.id) !== -1;
    }).length;

    root.innerHTML =
      '<section class="card">' +
        '<h2 class="section-title">默写自测</h2>' +
        '<p class="section-desc">共选择 ' + opts.list.length + ' 篇 · 题库 ' + DB.all().length + ' 篇 · 当前错题 ' + wrongCount + ' 篇 · <span class="nowrap">今日待复习 ' + dueCount + ' 篇</span></p>' +
        '<div class="quiz-settings" style="margin-top:0.9rem;">' +
          '<div class="filter-group">' +
            '<span class="filter-label">题型（不选表示随机组合）</span>' +
            '<div class="quiz-mode-list">' +
              MODES.map(function (mode) {
                var checked = modes.indexOf(mode.key) !== -1;
                return (
                  '<label class="mode-option">' +
                    '<input type="checkbox" data-mode="' + mode.key + '"' + (checked ? ' checked' : '') + '>' +
                    '<span><strong>' + Utils.escapeHtml(mode.label) + '</strong><span class="mode-desc">' + Utils.escapeHtml(mode.desc) + '</span></span>' +
                  '</label>'
                );
              }).join('') +
            '</div>' +
          '</div>' +
          '<div class="filter-group">' +
            '<span class="filter-label">题目数量</span>' +
            '<div class="chips">' +
              [5, 10, 20, 30].map(function (n) {
                return '<button type="button" class="chip' + (prefs.quizCount === n ? ' active' : '') + '" data-count="' + n + '">' + n + ' 题</button>';
              }).join('') +
            '</div>' +
          '</div>' +
          '<div class="filter-group">' +
            '<span class="filter-label">练习范围</span>' +
            '<div class="chips">' +
              '<button type="button" class="chip' + (state.scope === 'all' ? ' active' : '') + '" data-scope="all">全部已选篇目</button>' +
              (focusPoem
                ? '<button type="button" class="chip' + (state.scope === 'focus' ? ' active' : '') + '" data-scope="focus">只练《' + Utils.escapeHtml(focusPoem.title) + '》</button>'
                : '') +
              '<button type="button" class="chip' + (state.scope === 'wrong' ? ' active' : '') + '" data-scope="wrong">优先错题（' + wrongCount + '）</button>' +
              '<button type="button" class="chip' + (state.scope === 'review' ? ' active' : '') + '" data-scope="review">今日复习（' + dueCount + '）</button>' +
            '</div>' +
          '</div>' +
          '<div class="filter-group">' +
            '<span class="filter-label">题目范围</span>' +
            '<div class="chips">' +
              '<button type="button" class="chip' + (state.questionFilter === 'none' ? ' active' : '') + '" data-question-filter="none">全部句子</button>' +
              '<button type="button" class="chip' + (state.questionFilter === 'exam' ? ' active' : '') + '" data-question-filter="exam">考试重点句</button>' +
              '<button type="button" class="chip' + (state.questionFilter === 'name' ? ' active' : '') + '" data-question-filter="name">名句</button>' +
            '</div>' +
          '</div>' +
          '<div class="select-actions">' +
            '<button type="button" class="btn btn-primary" data-action="generate">生成题目 / 换一批</button>' +
            '<button type="button" class="btn btn-success" data-action="toggle-all">显示全部答案</button>' +
            '<button type="button" class="btn" data-action="clear">清空本轮</button>' +
          '</div>' +
          '<p class="tiny muted" id="quizCounter">' + statsLine() + '</p>' +
          '<p class="tiny muted" id="quizNotice"' + (state.notice ? '' : ' hidden') + '>' + Utils.escapeHtml(state.notice || '') + '</p>' +
        '</div>' +
      '</section>' +
      '<div id="quizList" style="margin-top:1rem;"></div>';

    renderQuestions(root, opts);
  }

  function generate(root, options) {
    var prefs = Storage.getState().prefs;
    var picked = scopePoems(options.list, focusOf(options.list));
    var requested = Storage.normalizeQuizCount(prefs.quizCount);
    var ids = picked.list.map(function (poem) {
      return poem.id;
    });
    var preferKeys = state.scope === 'wrong' ? Storage.wrongItemKeysForPoems(ids) : [];
    var onlyKeys = state.focusKey ? [state.focusKey] : (state.scope === "review" ? Storage.dueSentenceKeys() : []);
    state.questions = pickQuestions(picked.list, {
      count: requested,
      // 指定原题时由 key 唯一定位，不能被后来修改的题型偏好排除。
      modes: onlyKeys.length ? MODE_KEY_LIST : prefs.modes,
      filter: questionFilterFn(state.questionFilter),
      preferKeys: preferKeys,
      onlyKeys: onlyKeys,
    });
    state.answered = {};
    state.showAll = false;
    var notices = [];
    if (picked.notice) notices.push(picked.notice);
    if (state.scope === 'wrong' && !preferKeys.length) {
      notices.push('错题本里还没有可定位到句子的记录，已按篇目出题。');
    }
    if (state.focusKey && !state.questions.length) {
      notices.push('这条错题已经不在当前题库 / 筛选范围内。');
    }
    if (state.questions.length < requested) {
      notices.push('当前条件最多可生成 ' + state.questions.length + ' 题，本次生成 ' + state.questions.length + ' / ' + requested + ' 题。');
    }
    state.notice = notices.filter(Boolean).join(' ');
    renderQuestions(root, options);
    if (global.PoetryApp) {
      global.PoetryApp.toast((state.notice ? state.notice + ' ' : '') + '已生成 ' + state.questions.length + ' 道题');
    }
  }

  function escapeAttr(value) {
    return String(value == null ? '' : value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  /** 判分后只替换当前题卡，避免整组重绘造成闪烁 / 读屏重复朗读 */
  function refreshCard(root, key, options) {
    var index = -1;
    state.questions.forEach(function (question, i) {
      if (question.key === key) index = i;
    });
    if (index === -1) return;
    var card = root.querySelector('.quiz-card[data-key="' + escapeAttr(key) + '"]');
    if (!card || !card.parentNode) return;
    var holder = document.createElement('div');
    holder.innerHTML = renderQuestion(state.questions[index], index);
    var next = holder.firstElementChild;
    if (!next) return;
    card.parentNode.replaceChild(next, card);
    updateChrome(root);
    if (options && options.onProgress) options.onProgress();
  }

  function handleClick(root, event, options) {
    var target = event.target;
    var actionEl = target.closest ? target.closest('[data-action]') : null;
    var countEl = target.closest ? target.closest('[data-count]') : null;
    var scopeEl = target.closest ? target.closest('[data-scope]') : null;
    var filterEl = target.closest ? target.closest('[data-question-filter]') : null;

    if (countEl) {
      Storage.getState().prefs.quizCount = Number(countEl.getAttribute('data-count')) || 10;
      Storage.save();
      root.querySelectorAll('[data-count]').forEach(function (el) {
        el.classList.toggle('active', el === countEl);
      });
      return;
    }
    if (scopeEl) {
      var scope = scopeEl.getAttribute('data-scope');
      state.scope = scope === 'wrong' || scope === 'focus' || scope === 'review' ? scope : 'all';
      state.focusKey = '';
      root.querySelectorAll('[data-scope]').forEach(function (el) {
        el.classList.toggle('active', el === scopeEl);
      });
      return;
    }
    if (filterEl) {
      var filter = filterEl.getAttribute('data-question-filter');
      state.questionFilter = filter === 'exam' || filter === 'name' ? filter : 'none';
      state.focusKey = '';
      root.querySelectorAll('[data-question-filter]').forEach(function (el) {
        el.classList.toggle('active', el === filterEl);
      });
      return;
    }
    if (!actionEl) return;

    var action = actionEl.getAttribute('data-action');
    if (action === 'generate') {
      generate(root, options);
      return;
    }
    if (action === 'toggle-all') {
      state.showAll = !state.showAll;
      renderQuestions(root, options);
      return;
    }
    if (action === 'clear') {
      state.questions = [];
      state.answered = {};
      state.showAll = false;
      state.notice = '';
      state.focusKey = '';
      renderQuestions(root, options);
      return;
    }
    if (action === 'toggle-answer') {
      var card = actionEl.closest('.quiz-card');
      var key = card ? card.getAttribute('data-key') : '';
      var wrapper = card ? card.querySelector('.answer-wrapper') : null;
      if (!wrapper) return;
      var willShow = !wrapper.classList.contains('show');
      wrapper.classList.toggle('show', willShow);
      var showEye = actionEl.querySelector('.show-eye');
      var hideEye = actionEl.querySelector('.hide-eye');
      if (showEye) showEye.classList.toggle('hidden', willShow);
      if (hideEye) hideEye.classList.toggle('hidden', !willShow);
      actionEl.setAttribute('aria-expanded', willShow ? 'true' : 'false');
      if (state.answered[key]) state.answered[key].showAnswer = willShow;
      return;
    }
    if (action === 'compare-input') {
      var key=actionEl.getAttribute('data-key'), q=state.questions.filter(function(item){return item.key===key;})[0];
      var card=actionEl.closest('.quiz-card'), input=card && card.querySelector('[data-typed]');
      if (!q || !input) return;
      state.typed=state.typed||{}; state.typed[key]=input.value;
      var result=compareAnswer(input.value,q.answerText);
      card.querySelector('[data-diff]').innerHTML=(result.correct?'与当前正文一致：':'请核对差异：')+result.html;
      return;
    }
    if (action === 'mark-right' || action === 'mark-wrong') {
      var qKey = actionEl.getAttribute('data-key');
      var question = null;
      state.questions.forEach(function (item) {
        if (item.key === qKey) question = item;
      });
      if (!question) return;
      /* 一题只计一次分：重复点击不会把统计和错题次数刷高 */
      if (state.answered[qKey]) {
        if (global.PoetryApp) {
          global.PoetryApp.toast(state.answered[qKey].correct ? '本题已判定：默写正确' : '本题已判定：已加入错题本');
        }
        return;
      }
      var correct = action === 'mark-right';
      Storage.recordQuiz(question.poemId, correct, question.mode, {
        key: question.key,
        index: question.sentenceIndex,
        pairIndex: question.pairIndex,
      });
      state.answered[qKey] = { correct: correct, showAnswer: true };
      refreshCard(root, qKey, options);
      if (global.PoetryApp) {
        global.PoetryApp.toast(correct ? '已记录：默写正确' : '已加入错题本，下次优先练习');
      }
    }
  }

  function mount(root, options) {
    var opts = options || {};
    if (!opts.list || !opts.list.length) {
      root.innerHTML = '<div class="card"><div class="empty-state">还没有选择篇目，请先返回选择要背诵的篇目。</div></div>';
      return;
    }
    /* 链接里的 focus 篇目必须是当前已选篇目，否则一律回退到“全部已选篇目”，
       不允许出现 scope === 'focus' 但画面上没有 focus 篇目的状态。 */
    var focus = null;
    Utils.toArray(opts.list).forEach(function (poem) {
      if (opts.focusPoemId && poem.id === opts.focusPoemId) focus = poem;
    });
    state.focusPoemId = focus ? focus.id : '';
    if (opts.initialScope === 'review' || opts.initialScope === 'wrong') state.scope = opts.initialScope;
    else state.scope = state.focusPoemId ? 'focus' : 'all';
    state.questionFilter = 'none';
    state.focusKey = typeof opts.focusKey === 'string' ? opts.focusKey : '';
    render(root, opts);
    root.addEventListener('click', function (event) {
      handleClick(root, event, opts);
    });
    root.addEventListener('change', function (event) {
      var input = event.target;
      if (input && input.getAttribute && input.getAttribute('data-mode') != null) {
        state.focusKey = ''; // 主动改题型即结束原题重练，恢复普通筛选。
        var modes = [];
        root.querySelectorAll('[data-mode]').forEach(function (el) {
          if (el.checked) modes.push(el.getAttribute('data-mode'));
        });
        Storage.getState().prefs.modes = modes;
        Storage.save();
      }
    });
    generate(root, opts);
  }

  global.PoetryQuiz = {
    compareAnswer: compareAnswer,
    MODES: MODES,
    mount: mount,
    modeLabel: modeLabel,
    /** 当前练习范围（测试 / 调试用）：focus 篇目被清理后必须回到 all */
    currentState: function () {
      return {
        scope: state.scope,
        focusPoemId: state.focusPoemId,
        questionFilter: state.questionFilter,
        focusKey: state.focusKey,
        questionCount: state.questions.length,
        notice: state.notice,
      };
    },
    /* 供 unit test 直接验证出题逻辑（页面逻辑不依赖这些内部函数） */
    __internals: {
      unitsOf: unitsOf,
      buildQuestion: buildQuestion,
      allCandidates: allCandidates,
      pickQuestions: pickQuestions,
      questionFilterFn: questionFilterFn,
      resetLastBatch: function () {
        lastBatchKeys = [];
      },
    },
  };
})(window);
