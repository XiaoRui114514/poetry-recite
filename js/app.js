/* 古诗文背诵学习系统 —— 应用主控
   职责：统一状态管理、视图路由、选择页 / 主界面 / 进度页 / 打印页渲染。 */
(function (global) {
  'use strict';

  var Utils = global.PoetryUtils;
  var Storage = global.PoetryStorage;
  var DB = global.PoetryDatabase;
  var Meta = global.PoetryMeta;

  var state = {
    view: 'stage',
    stage: '',
    // 年级 / 课程模块、体裁、掌握度支持多选（数组）
    filters: { keyword: '', grade: [], genre: [], progress: [] },
    sort: 'default',
  };

  var els = {};
  var lastHash = ''; // 上一次已经渲染过的完整 hash（含 ?poem= 这类参数）

  var VIEWS = ['stage', 'select', 'home', 'study', 'quiz', 'progress', 'print'];
  var VIEW_TITLES = {
    stage: '初高中古诗文背诵学习系统 · 纯本地运行',
    select: '选择要背诵的篇目',
    home: '学习工作台',
    study: '全文学习',
    quiz: '默写自测',
    progress: '我的进度',
    print: '打印默写纸',
  };
  var THEME_KEY = 'hison-poetry-theme';

  /* ---------------- 基础工具 ---------------- */

  function toast(message) {
    if (!els.toast) return;
    els.toast.textContent = message;
    els.toast.classList.add('show');
    if (toast.timer) clearTimeout(toast.timer);
    toast.timer = setTimeout(function () {
      els.toast.classList.remove('show');
    }, 2200);
  }

  function escapeAttr(value) {
    return String(value == null ? '' : value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  function currentDepth() {
    try {
      var st = global.history && global.history.state;
      return st && typeof st.depth === 'number' ? st.depth : 0;
    } catch (err) {
      return 0;
    }
  }

  /* ---------------- 深色 / 浅色主题 ---------------- */

  function readTheme() {
    var saved = null;
    try {
      saved = global.localStorage ? global.localStorage.getItem(THEME_KEY) : null;
    } catch (err) {
      saved = null;
    }
    if (saved === 'light' || saved === 'dark') return saved;
    return global.matchMedia && global.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    if (els.themeToggle) {
      els.themeToggle.textContent = theme === 'dark' ? '☀️' : '🌙';
      els.themeToggle.setAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false');
      els.themeToggle.setAttribute('title', theme === 'dark' ? '当前：深色模式（点击切换浅色）' : '当前：浅色模式（点击切换深色）');
    }
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#130f0b' : '#f7f3eb');
  }

  function toggleTheme() {
    var next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    try {
      if (global.localStorage) global.localStorage.setItem(THEME_KEY, next);
    } catch (err) {
      /* 隐私模式下仅本次生效 */
    }
    toast(next === 'dark' ? '已切换到深色模式' : '已切换到浅色模式');
  }

  function selectedPoems() {
    var saved = Storage.getState().selectedIds;
    var list = DB.query({ stage: state.stage, ids: saved });
    return DB.sort(list);
  }

  /* ---------------- 日期 / 复习 / 周报 ---------------- */

  function lastNDays(n) {
    var out = [];
    var today = Utils.todayKey();
    for (var i = n - 1; i >= 0; i -= 1) {
      out.push(Utils.addDaysKey(today, -i));
    }
    return out;
  }

  function heatmapDays(daily) {
    return lastNDays(60).map(function (day) {
      var item = daily[day] || { quiz: 0, correct: 0 };
      return { day: day, count: item.quiz, correct: item.correct };
    });
  }

  function streakDays(daily) {
    var cursor = Utils.todayKey();
    if (!daily[cursor] || !daily[cursor].quiz) cursor = Utils.addDaysKey(cursor, -1);
    var count = 0;
    while (daily[cursor] && daily[cursor].quiz > 0) {
      count += 1;
      cursor = Utils.addDaysKey(cursor, -1);
    }
    return count;
  }

  function weeklySummary(daily, byPoem) {
    var days = lastNDays(7);
    var quiz = 0;
    var correct = 0;
    var active = 0;
    days.forEach(function (day) {
      var item = daily[day];
      if (!item || !item.quiz) return;
      quiz += item.quiz;
      correct += item.correct;
      active += 1;
    });
    var weak = byPoem
      .filter(function (row) {
        return row.item.total >= 3;
      })
      .sort(function (a, b) {
        return a.item.correct / a.item.total - b.item.correct / b.item.total;
      })[0];
    return {
      quiz: quiz,
      correct: correct,
      active: active,
      weakest: weak ? weak.poem : null,
    };
  }

  function progressSummary() {
    var saved = Storage.getState();
    var list = selectedPoems();
    var learned = list.filter(function (poem) {
      return saved.learnedIds[poem.id];
    }).length;
    var stats = saved.quizStats;
    var today = Storage.todayStats();
    var byPoem = list
      .map(function (poem) {
        var item = stats.byPoem[poem.id];
        return { poem: poem, item: item };
      })
      .filter(function (row) {
        return row.item && row.item.total > 0;
      })
      .sort(function (a, b) {
        return (b.item.lastTime || 0) - (a.item.lastTime || 0);
      });

    /* 题目级错题按篇目分组，保留具体句子 / 题型 / 次数 */
    var wrongMap = Object.create(null);
    var allowed = Object.create(null);
    list.forEach(function (poem) {
      allowed[poem.id] = true;
    });
    Utils.toArray(saved.wrongItems).forEach(function (item) {
      if (!allowed[item.poemId]) return;
      var poem = DB.byId(item.poemId);
      if (!poem) return;
      var row = wrongMap[item.poemId];
      if (!row) {
        row = {
          poem: poem,
          entry: { id: item.poemId, time: 0, count: 0, mode: '', items: 0 },
          items: [],
        };
        wrongMap[item.poemId] = row;
      }
      row.entry.count += item.count;
      row.entry.items += 1;
      if (item.time >= row.entry.time) {
        row.entry.time = item.time;
        if (item.mode) row.entry.mode = item.mode;
      }
      row.items.push(item);
    });
    var wrongBook = Object.keys(wrongMap)
      .map(function (id) {
        var row = wrongMap[id];
        row.items.sort(function (a, b) {
          return b.time - a.time;
        });
        return row;
      })
      .sort(function (a, b) {
        return b.entry.time - a.entry.time;
      });

    var dueIds = Storage.duePoemIds();
    var due = list.filter(function (poem) {
      return dueIds.indexOf(poem.id) !== -1;
    });

    var focusTotal = 0;
    var focusLearned = 0;
    list.forEach(function (poem) {
      var count = Utils.toArray(poem.examFocus).length;
      focusTotal += count;
      if (saved.learnedIds[poem.id]) focusLearned += count;
    });

    var weekly = weeklySummary(saved.daily, byPoem);

    return {
      list: list,
      learned: learned,
      today: today,
      stats: stats,
      byPoem: byPoem,
      wrongBook: wrongBook,
      wrongItems: saved.wrongItems,
      due: due,
      dueCount: due.length,
      focusTotal: focusTotal,
      focusLearned: focusLearned,
      streak: streakDays(saved.daily),
      heatmap: heatmapDays(saved.daily),
      weekly: weekly,
      accuracy: stats.total ? Math.round((stats.correct / stats.total) * 100) : 0,
      recent: saved.recents
        .map(function (item) {
          return { item: item, poem: DB.byId(item.id) };
        })
        .filter(function (row) {
          return !!row.poem;
        }),
    };
  }

  /* ---------------- 路由 ---------------- */

  function canShow(view) {
    if (view === 'stage') return true;
    if (!state.stage) return false;
    if (view === 'select') return true;
    return Storage.getState().selectedIds.length > 0;
  }

  function navigate(view, hashOptions, opts) {
    if (VIEWS.indexOf(view) === -1) view = 'stage';
    if (!canShow(view)) view = state.stage ? 'select' : 'stage';
    state.view = view;
    var hash = '#/' + view + (hashOptions || '');
    lastHash = hash;
    if (global.location.hash !== hash) {
      try {
        if (opts && opts.replace) {
          global.history.replaceState({ depth: currentDepth(), view: view }, '', hash);
        } else {
          global.history.pushState({ depth: currentDepth() + 1, view: view }, '', hash);
        }
      } catch (err) {
        global.location.hash = hash;
      }
    }
    render();
    /* 换页后回到顶部，避免沿用上一页的滚动位置 */
    if (global.scrollTo) global.scrollTo(0, 0);
  }

  function hashParam(name) {
    var hash = global.location.hash || '';
    var queryIndex = hash.indexOf('?');
    if (queryIndex === -1) return '';
    var query = hash.slice(queryIndex + 1);
    var pairs = query.split('&');
    for (var i = 0; i < pairs.length; i += 1) {
      var eq = pairs[i].indexOf('=');
      var key = eq === -1 ? pairs[i] : pairs[i].slice(0, eq);
      if (safeDecode(key) === name) return safeDecode(eq === -1 ? '' : pairs[i].slice(eq + 1));
    }
    return '';
  }

  /** 链接可能被截断或含非法转义（如 #/study?poem=%），解码失败时按空值处理 */
  function safeDecode(value) {
    try {
      return decodeURIComponent(value);
    } catch (err) {
      return '';
    }
  }

  /* ---------------- 篇目清单分享 ---------------- */

  function encodeSelection(ids) {
    var all = DB.all();
    var index = Object.create(null);
    all.forEach(function (poem, i) {
      index[poem.id] = i;
    });
    return Utils.unique(Utils.toArray(ids))
      .map(function (id) {
        return index[id];
      })
      .filter(function (i) {
        return typeof i === 'number' && i >= 0;
      })
      .map(function (i) {
        return i.toString(36);
      })
      .join('.');
  }

  function decodeSelection(code) {
    var all = DB.all();
    return String(code || '')
      .split('.')
      .map(function (token) {
        return parseInt(token, 36);
      })
      .filter(function (i) {
        return Number.isInteger(i) && i >= 0 && i < all.length;
      })
      .map(function (i) {
        return all[i].id;
      });
  }

  function buildShareUrl() {
    var ids = Storage.getState().selectedIds;
    var stage = state.stage || Storage.getState().stage;
    var code = encodeSelection(ids);
    var base = String(global.location.href || '').split('#')[0];
    return base + '#/select?list=' + code + '&s=' + (stage === '高中' ? 'senior' : 'junior');
  }

  /** 打开带 list 参数的链接时，恢复分享者的篇目选择；返回是否命中 */
  function applySharedList() {
    var code = hashParam('list');
    if (!code) return false;
    var ids = decodeSelection(code);
    if (!ids.length) {
      toast('分享清单无法识别，已忽略。');
      return false;
    }
    var stage = hashParam('s') === 'senior' ? '高中' : hashParam('s') === 'junior' ? '初中' : '';
    if (!stage) {
      var first = DB.byId(ids[0]);
      stage = first ? first.stage : '';
    }
    Storage.patch({ stage: stage, selectedIds: Utils.unique(ids) });
    state.stage = stage;
    return true;
  }

  /* ---------------- 视图：阶段选择 ---------------- */

  function renderStage(root) {
    var cards = Meta.stages
      .map(function (stage) {
        var stats = DB.stats(stage.key);
        var icon = stage.key === '初中' ? '初' : '高';
        return (
          '<button type="button" class="stage-card" data-stage="' + Utils.escapeHtml(stage.key) + '">' +
            '<span class="sc-ico" aria-hidden="true">' + icon + '</span>' +
            '<h3>' + Utils.escapeHtml(stage.label) + '</h3>' +
            '<p>' + Utils.escapeHtml(stage.desc) + '</p>' +
            '<p class="stage-stat tiny muted">共 ' + stats.total + ' 篇（含课标必背 ' + stats.required + ' 篇）</p>' +
            '<span class="sc-go">进入 ' + Utils.escapeHtml(stage.label) + ' 篇目选择 →</span>' +
          '</button>'
        );
      })
      .join('');

    root.innerHTML =
      '<section class="card hero">' +
        '<p class="hero-kicker">' + Utils.escapeHtml(Meta.appName) + ' · ' + Utils.escapeHtml(Meta.slogan) + '</p>' +
        '<h2 class="hero-title">选好篇目，<span class="accent">一句一句背下来</span></h2>' +
        '<p class="hero-sub">' + Utils.escapeHtml((Meta.brand && Meta.brand.intro) || '') + '</p>' +
        '<div data-brand-chip></div>' +
      '</section>' +
      '<section class="card">' +
        '<h2 class="section-title">请选择学习阶段</h2>' +
        '<p class="section-desc">初中包含义务教育课程标准推荐篇目与统编教材课内古诗文；高中包含普通高中课程标准古诗文背诵推荐篇目 72 篇（首）。</p>' +
        '<div class="stage-grid">' + cards + '</div>' +
        (Storage.getState().selectedIds.length
          ? '<div style="margin-top:1rem;"><button type="button" class="btn btn-primary" data-action="continue">继续上次的学习（已选 ' + Storage.getState().selectedIds.length + ' 篇）</button></div>'
          : '') +
      '</section>' +
      '<section class="card">' +
        '<h3 class="section-title">数据依据</h3>' +
        '<p class="section-desc">' + Utils.escapeHtml(Meta.sources.junior.name) + '</p>' +
        '<p class="section-desc" style="margin-top:0.25rem;">' + Utils.escapeHtml(Meta.sources.senior.name) + '</p>' +
        '<p class="tiny muted" style="margin-top:0.5rem;">题库正文以统编教材现行版本为准，版本差异记录在 variants 字段；进度与错题只保存在本机浏览器。</p>' +
      '</section>';
  }

  /* ---------------- 视图：篇目选择 ---------------- */

  function activeFilterCount() {
    var f = state.filters;
    return (f.grade.length ? 1 : 0) + (f.genre.length ? 1 : 0) + (f.progress.length ? 1 : 0);
  }

  function matchesProgress(poem) {
    var picked = state.filters.progress;
    if (!picked.length) return true;
    var saved = Storage.getState();
    return picked.some(function (key) {
      if (key === 'unlearned') return !saved.learnedIds[poem.id];
      if (key === 'wrong') {
        return Utils.toArray(saved.wrongItems).some(function (item) {
          return item.poemId === poem.id;
        });
      }
      if (key === 'weak') {
        var item = saved.quizStats.byPoem[poem.id];
        return !!(item && item.total >= 3 && item.correct / item.total < 0.6);
      }
      return false;
    });
  }

  function masteryScore(poem) {
    var item = Storage.getState().quizStats.byPoem[poem.id];
    if (!item || !item.total) return 0.5;
    return item.correct / item.total;
  }

  function filteredPoems() {
    var list = DB.query({
      stage: state.stage,
      grade: state.filters.grade,
      genre: state.filters.genre,
      keyword: state.filters.keyword,
    }).filter(matchesProgress);
    var sorted = DB.sort(list);
    if (state.sort === 'mastery') {
      sorted.sort(function (a, b) {
        return masteryScore(a) - masteryScore(b) || a.title.localeCompare(b.title, 'zh');
      });
    } else if (state.sort === 'recent') {
      sorted.sort(function (a, b) {
        var ta = (Storage.getState().quizStats.byPoem[a.id] || {}).lastTime || 0;
        var tb = (Storage.getState().quizStats.byPoem[b.id] || {}).lastTime || 0;
        return tb - ta;
      });
    }
    return sorted;
  }

  function highlightSnippet(text, keyword) {
    var src = String(text == null ? '' : text);
    var lower = src.toLowerCase();
    var key = String(keyword || '').toLowerCase();
    var idx = lower.indexOf(key);
    if (idx === -1) return Utils.escapeHtml(src);
    var start = Math.max(0, idx - 10);
    var end = Math.min(src.length, idx + key.length + 18);
    var raw = src.slice(start, end);
    var rawLower = raw.toLowerCase();
    var at = rawLower.indexOf(key);
    var prefix = start > 0 ? '…' : '';
    var suffix = end < src.length ? '…' : '';
    if (at === -1) return Utils.escapeHtml(prefix + raw + suffix);
    return prefix +
      Utils.escapeHtml(raw.slice(0, at)) +
      '<mark>' + Utils.escapeHtml(raw.slice(at, at + key.length)) + '</mark>' +
      Utils.escapeHtml(raw.slice(at + key.length)) +
      suffix;
  }

  function matchSnippet(poem, keyword) {
    var key = String(keyword || '').trim();
    if (!key) return '';
    var lower = key.toLowerCase();
    var fields = [
      ['篇名', poem.title],
      ['作者', poem.author],
      ['朝代', poem.dynasty],
      ['年级', poem.grade],
      ['体裁', poem.genre],
      ['来源', poem.sourceType],
      ['说明', poem.notes],
    ];
    for (var i = 0; i < fields.length; i += 1) {
      if (String(fields[i][1] || '').toLowerCase().indexOf(lower) !== -1) {
        return '<span class="poem-match">' + Utils.escapeHtml(fields[i][0]) + '：' + highlightSnippet(fields[i][1], key) + '</span>';
      }
    }
    var sentences = Utils.splitSentences(poem.text);
    for (var j = 0; j < sentences.length; j += 1) {
      if (sentences[j].toLowerCase().indexOf(lower) !== -1) {
        return '<span class="poem-match">正文：' + highlightSnippet(sentences[j], key) + '</span>';
      }
    }
    return '';
  }

  function selectedChipsHtml(selectedInStage) {
    return selectedInStage
      .map(function (poem) {
        return '<span class="selected-chip">' + Utils.escapeHtml(poem.title) +
          '<button type="button" data-remove="' + Utils.escapeHtml(poem.id) + '" aria-label="移除' + Utils.escapeHtml(poem.title) + '">✕</button></span>';
      })
      .join('');
  }

  function selectedPanelHtml(selectedInStage) {
    if (!selectedInStage.length) return '';
    return (
      '<details class="selected-panel" id="selectedPanel">' +
        '<summary>已选篇目快速查看（' + selectedInStage.length + '）</summary>' +
        '<div class="selected-list">' + selectedChipsHtml(selectedInStage) + '</div>' +
      '</details>'
    );
  }

  function selectResultsHtml() {
    var stage = state.stage;
    var filtered = filteredPoems();
    var selectedIds = Storage.getState().selectedIds;
    var keyword = state.filters.keyword;
    var groups;
    if (state.sort === 'default') {
      groups = Utils.groupBy(filtered, function (poem) {
        return poem.grade;
      });
      var order = DB.gradeOrder(stage);
      groups.sort(function (a, b) {
        var oa = order.indexOf(a.key);
        var ob = order.indexOf(b.key);
        return (oa === -1 ? 99 : oa) - (ob === -1 ? 99 : ob);
      });
    } else {
      /* 按掌握度 / 最近练习排序时不再按年级分组，否则年级分组会把全局排序切碎 */
      groups = [{
        key: state.sort === 'mastery' ? '按掌握度排序' : '按最近练习排序',
        items: filtered,
      }];
    }

    if (!groups.length) {
      return '<div class="empty-state">没有找到符合条件的篇目，试着换个关键词或点击「全部」。</div>';
    }
    return groups
      .map(function (group) {
        return (
          '<div class="group-block">' +
            '<div class="group-heading"><span>' + Utils.escapeHtml(group.key) + '</span><span class="muted tiny">' + group.items.length + ' 篇</span><span class="group-line" aria-hidden="true"></span></div>' +
            '<div class="poem-grid">' +
            group.items
              .map(function (poem) {
                var checked = selectedIds.indexOf(poem.id) !== -1;
                var snippet = matchSnippet(poem, keyword);
                return (
                  '<button type="button" class="poem-card' + (checked ? ' checked' : '') + '" data-poem="' + Utils.escapeHtml(poem.id) + '" aria-pressed="' + checked + '">' +
                    '<span class="check" aria-hidden="true">' + (checked ? '✓' : '') + '</span>' +
                    '<span class="poem-main">' +
                      '<span class="poem-title">' + Utils.escapeHtml(poem.title) + '</span>' +
                      '<span class="poem-sub">' + Utils.escapeHtml(poem.author + ' · ' + poem.dynasty) + '</span>' +
                      snippet +
                      '<span class="poem-tags">' +
                        '<span class="badge">' + Utils.escapeHtml(poem.genre) + '</span>' +
                        '<span class="badge' + (poem.required ? ' badge-success' : '') + '">' + Utils.escapeHtml(poem.sourceType) + '</span>' +
                      '</span>' +
                    '</span>' +
                  '</button>'
                );
              })
              .join('') +
            '</div>' +
          '</div>'
        );
      })
      .join('');
  }

  function refreshSelectResults() {
    var box = document.getElementById('selectResults');
    if (box) box.innerHTML = selectResultsHtml();
    var count = document.getElementById('selectCountLabel');
    if (count) {
      var filtered = filteredPoems().length;
      count.textContent = activeFilterCount() ? '已应用 ' + activeFilterCount() + ' 个筛选条件 · 当前 ' + filtered + ' 篇' : '当前显示 ' + filtered + ' 篇';
    }
  }

  function selectedInStage() {
    var selectedIds = Storage.getState().selectedIds;
    return DB.byStage(state.stage).filter(function (poem) {
      return selectedIds.indexOf(poem.id) !== -1;
    });
  }

  /** 局部更新勾选状态：不整页重绘，保留“已选篇目”展开状态、滚动位置和焦点 */
  function updateSelectSelection(changedId) {
    var list = selectedInStage();
    var summary = document.querySelector('.select-summary');
    if (summary) summary.textContent = '已选择 ' + list.length + ' 篇';
    var start = document.getElementById('startBtn');
    if (start) {
      start.disabled = !list.length;
      start.textContent = '进入学习（已选 ' + list.length + ' 篇）';
    }
    var wrap = document.getElementById('selectedPanelWrap');
    if (wrap) {
      if (!list.length) {
        wrap.innerHTML = '';
      } else {
        var details = wrap.querySelector('details');
        if (!details) {
          wrap.innerHTML = selectedPanelHtml(list);
        } else {
          var summaryEl = details.querySelector('summary');
          if (summaryEl) summaryEl.textContent = '已选篇目快速查看（' + list.length + '）';
          var selectedList = details.querySelector('.selected-list');
          if (selectedList) selectedList.innerHTML = selectedChipsHtml(list);
        }
      }
    }
    if (changedId) {
      var card = document.querySelector('.poem-card[data-poem="' + escapeAttr(changedId) + '"]');
      if (card) {
        var checked = Storage.getState().selectedIds.indexOf(changedId) !== -1;
        card.classList.toggle('checked', checked);
        card.setAttribute('aria-pressed', checked ? 'true' : 'false');
        var check = card.querySelector('.check');
        if (check) check.textContent = checked ? '✓' : '';
      }
    }
  }

  function renderSelect(root) {
    var stage = state.stage;
    var all = DB.byStage(stage);
    var list = selectedInStage();
    var grades = Meta.grades[stage] || [];
    var genres = Meta.genres;

    /** items：字符串或 {key,label}；current：已选中的值数组（空数组 = 全部） */
    var chips = function (items, key, current, emptyLabel) {
      var isActive = function (value) {
        return current.indexOf(value) !== -1;
      };
      return (
        '<button type="button" class="chip' + (current.length ? '' : ' active') + '" data-filter="' + key + '" data-value="">' + Utils.escapeHtml(emptyLabel || '全部') + '</button>' +
        items
          .map(function (item) {
            var value = typeof item === 'string' ? item : item.key;
            var label = typeof item === 'string' ? item : item.label;
            return '<button type="button" class="chip' + (isActive(value) ? ' active' : '') + '" data-filter="' + key + '" data-value="' + Utils.escapeHtml(value) + '">' + Utils.escapeHtml(label) + '</button>';
          })
          .join('')
      );
    };

    var filteredCount = filteredPoems().length;
    var sortOptions = [
      ['default', '年级 / 来源顺序'],
      ['mastery', '掌握度（低的在前）'],
      ['recent', '最近练习'],
    ]
      .map(function (item) {
        return '<option value="' + item[0] + '"' + (state.sort === item[0] ? ' selected' : '') + '>' + item[1] + '</option>';
      })
      .join('');

    root.innerHTML =
      '<section class="card">' +
        '<h2 class="section-title">请选择要背诵的篇目</h2>' +
        '<p class="section-desc">' + Utils.escapeHtml(stage) + '共有 ' + all.length + ' 篇，支持多选、搜索，' +
          Utils.escapeHtml(stage === '高中' ? '按课程模块' : '按年级') + ' / 体裁 / 掌握度筛选，筛选都可以多选。</p>' +
        '<div class="toolbar" style="margin-top:0.9rem;">' +
          '<div class="search-box">' +
            '<input type="search" id="poemSearch" placeholder="搜索篇名 / 作者 / 朝代 / 关键词（如：李白）" value="' + Utils.escapeHtml(state.filters.keyword) + '" aria-label="搜索篇目">' +
            '<button type="button" class="search-clear" data-action="clear-search" aria-label="清空搜索">✕</button>' +
          '</div>' +
          '<div class="filter-group"><span class="filter-label">' + Utils.escapeHtml((Meta.gradeLabels && Meta.gradeLabels[stage]) || '年级') + '（可多选）</span><div class="chips">' + chips(grades, 'grade', state.filters.grade, stage === '高中' ? '全部模块' : '全部年级') + '</div></div>' +
          '<div class="filter-group"><span class="filter-label">体裁（可多选）</span><div class="chips">' + chips(genres, 'genre', state.filters.genre, '全部体裁') + '</div></div>' +
          '<div class="filter-group"><span class="filter-label">掌握度（可多选）</span><div class="chips">' + chips([
            { key: 'unlearned', label: '未学习' },
            { key: 'wrong', label: '有错题' },
            { key: 'weak', label: '正确率低' },
          ], 'progress', state.filters.progress, '全部') + '</div></div>' +
          '<div class="filter-group select-sort"><label class="filter-label" for="poemSort">排序</label><select id="poemSort">' + sortOptions + '</select></div>' +
          '<div class="select-actions">' +
            '<button type="button" class="btn btn-sm" data-action="select-all">全选当前结果</button>' +
            '<button type="button" class="btn btn-sm" data-action="select-none">取消全选</button>' +
            '<button type="button" class="btn btn-sm" data-action="select-required">只选课标必背</button>' +
            '<span class="select-summary">已选择 ' + list.length + ' 篇</span>' +
          '</div>' +
          '<div id="selectedPanelWrap">' + selectedPanelHtml(list) + '</div>' +
        '</div>' +
        '<div style="margin-top:1rem;display:flex;flex-wrap:wrap;gap:0.5rem;align-items:center;">' +
          '<button type="button" class="btn btn-primary" id="startBtn" data-action="start" ' + (list.length ? '' : 'disabled') + '>进入学习（已选 ' + list.length + ' 篇）</button>' +
          '<button type="button" class="btn" data-action="print">打印默写纸</button>' +
          '<span class="tiny muted" id="selectCountLabel">' + (activeFilterCount() ? '已应用 ' + activeFilterCount() + ' 个筛选条件 · 当前 ' + filteredCount + ' 篇' : '当前显示 ' + filteredCount + ' 篇') + '</span>' +
        '</div>' +
      '</section>' +
      '<section class="card" id="selectResultsCard"><div id="selectResults">' + selectResultsHtml() + '</div></section>';
  }

  /* ---------------- 视图：工作台 ---------------- */

  function renderHome(root) {
    var summary = progressSummary();
    var list = summary.list;
    if (!list.length) {
      root.innerHTML = '<section class="card"><div class="empty-state">还没有选择篇目，请先选择要背诵的篇目。<div style="margin-top:0.9rem;"><button type="button" class="btn btn-primary" data-action="to-select">去选择篇目</button></div></div></section>';
      return;
    }
    var total = list.length;
    var learnedPct = total ? Math.round((summary.learned / total) * 100) : 0;
    var recent = summary.recent[0];
    var due = summary.due;

    root.innerHTML =
      '<section class="card today-card">' +
        '<h2 class="section-title">今日功课</h2>' +
        '<p class="section-desc">待复习 ' + summary.dueCount + ' 篇 · 今日已默写 ' + summary.today.quiz + ' 题 · 连续学习 ' + summary.streak + ' 天</p>' +
        '<div class="select-actions" style="margin-top:0.8rem;">' +
          (due.length
            ? '<button type="button" class="btn btn-primary" data-action="quiz-review">开始今日复习（' + due.length + ' 篇）</button>'
            : '<span class="badge badge-success">今天没有到期复习</span>') +
          '<button type="button" class="btn" data-action="quiz">自由默写</button>' +
        '</div>' +
        (due.length
          ? '<div class="selected-list" style="margin-top:0.7rem;">' + due.slice(0, 10).map(function (poem) {
              return '<span class="selected-chip">' + Utils.escapeHtml(poem.title) + '</span>';
            }).join('') + '</div>'
          : '') +
      '</section>' +
      '<section class="card">' +
        '<h2 class="section-title">' + Utils.escapeHtml(state.stage) + '背诵工作台</h2>' +
        '<p class="section-desc">已选择 ' + total + ' 篇 · 最近学习：' + (recent ? Utils.escapeHtml(recent.poem.title) + '（' + Utils.escapeHtml(Utils.formatDateTime(recent.item.time)) + '）' : '还没有开始') + '</p>' +
        '<div class="stat-row">' +
          '<div class="stat-box"><div class="stat-num">' + summary.learned + ' / ' + total + '</div><div class="stat-label">已学习篇目</div></div>' +
          '<div class="stat-box"><div class="stat-num">' + summary.today.quiz + '</div><div class="stat-label">今日默写题数</div></div>' +
          '<div class="stat-box"><div class="stat-num">' + summary.stats.correct + ' / ' + summary.stats.total + '</div><div class="stat-label">累计正确 / 总次数</div></div>' +
          '<div class="stat-box"><div class="stat-num">' + summary.wrongBook.length + '</div><div class="stat-label">错题本篇目</div></div>' +
        '</div>' +
        '<div class="bar" aria-hidden="true"><span style="width:' + learnedPct + '%"></span></div>' +
      '</section>' +
      '<div class="feature-grid">' +
        '<button type="button" class="feature-card" data-action="study"><span class="fc-ico" aria-hidden="true">诵</span><h3>背诵学习</h3><p>逐句显示 / 隐藏、关键词隐藏、上一句下一句，先自己背一遍。</p></button>' +
        '<button type="button" class="feature-card" data-action="quiz"><span class="fc-ico" aria-hidden="true">写</span><h3>默写自测</h3><p>整句挖空、给上句写下句、看译文写原文等 7 种题型随机组合。</p></button>' +
        '<button type="button" class="feature-card" data-action="to-select"><span class="fc-ico" aria-hidden="true">篇</span><h3>篇目列表</h3><p>查看、搜索并调整要背诵的篇目（当前 ' + total + ' 篇）。</p></button>' +
        '<button type="button" class="feature-card" data-action="progress"><span class="fc-ico" aria-hidden="true">记</span><h3>我的进度</h3><p>学习进度、默写正确率、错题本与复习计划，全部保存在本机。</p></button>' +
        '<button type="button" class="feature-card" data-action="print"><span class="fc-ico" aria-hidden="true">印</span><h3>打印练习纸</h3><p>把当前篇目排成 A4 默写纸，可附答案页，也可以另存 PDF。</p></button>' +
      '</div>' +
      (summary.wrongBook.length
        ? '<section class="card"><h3 class="section-title" style="font-size:1rem;">错题优先练</h3><div class="selected-list">' +
          summary.wrongBook.slice(0, 8).map(function (row) {
            return '<span class="selected-chip">' + Utils.escapeHtml(row.poem.title) + '<span class="tiny muted">×' + row.entry.count + '</span></span>';
          }).join('') +
          '</div><div style="margin-top:0.8rem;"><button type="button" class="btn btn-sm btn-primary" data-action="quiz-wrong">练习错题</button></div></section>'
        : '');
  }

  /* ---------------- 视图：进度 ---------------- */

  function wrongItemPreview(item) {
    var poem = DB.byId(item.poemId);
    if (!poem) return '';
    if (item.index == null) return '整篇（旧记录）';
    var sentences = Utils.splitSentences(poem.text);
    var sentence = sentences[item.index] || '';
    return '第 ' + (item.index + 1) + ' 句：' + sentence;
  }

  function renderProgress(root) {
    var summary = progressSummary();
    var rows = summary.byPoem
      .map(function (row) {
        var rate = row.item.total ? Math.round((row.item.correct / row.item.total) * 100) : 0;
        return (
          '<div class="progress-item">' +
            '<div class="pi-main"><div>' + Utils.escapeHtml(row.poem.title) + '</div>' +
            '<div class="pi-sub">' + Utils.escapeHtml(row.poem.author) + ' · 练习 ' + row.item.total + ' 次 · 正确率 ' + rate + '%</div></div>' +
            '<button type="button" class="btn btn-sm" data-study="' + Utils.escapeHtml(row.poem.id) + '">复习</button>' +
          '</div>'
        );
      })
      .join('');

    var heatMax = 1;
    summary.heatmap.forEach(function (day) {
      if (day.count > heatMax) heatMax = day.count;
    });
    var heatCells = summary.heatmap.map(function (day) {
      var level = day.count ? Math.min(4, Math.ceil((day.count / heatMax) * 4)) : 0;
      return '<span class="heat-cell" data-level="' + level + '" title="' + Utils.escapeHtml(day.day + ' · ' + day.count + ' 题') + '"></span>';
    }).join('');

    var wrongHtml = summary.wrongBook.length
      ? summary.wrongBook
          .map(function (row) {
            var items = row.items
              .map(function (item) {
                var mode = item.mode ? (global.PoetryQuiz ? global.PoetryQuiz.modeLabel(item.mode) : item.mode) : '旧记录';
                return (
                  '<div class="wrong-item">' +
                    '<span class="wrong-preview">' + Utils.escapeHtml(wrongItemPreview(item)) + '</span>' +
                    '<span class="tiny muted">' + Utils.escapeHtml(mode) + ' · 错 ' + item.count + ' 次</span>' +
                    (item.index == null
                      ? ''
                      : '<button type="button" class="btn btn-sm" data-practice-item="' + Utils.escapeHtml(item.key) + '" data-practice-poem="' + Utils.escapeHtml(item.poemId) + '">只练这句</button>') +
                    '<button type="button" class="btn btn-sm" data-remove-wrong-item="' + Utils.escapeHtml(item.key) + '">移除</button>' +
                  '</div>'
                );
              })
              .join('');
            return (
              '<div class="wrong-group">' +
                '<div class="progress-item">' +
                  '<div class="pi-main"><div>' + Utils.escapeHtml(row.poem.title) + '</div>' +
                  '<div class="pi-sub">错 ' + row.entry.count + ' 次 · ' + row.items.length + ' 句 · ' + Utils.escapeHtml(Utils.formatDateTime(row.entry.time)) + '</div></div>' +
                  '<div class="pi-actions">' +
                    '<button type="button" class="btn btn-sm btn-primary" data-practice="' + Utils.escapeHtml(row.poem.id) + '">再练一次</button>' +
                    '<button type="button" class="btn btn-sm" data-remove-wrong="' + Utils.escapeHtml(row.poem.id) + '">移除</button>' +
                  '</div>' +
                '</div>' +
                '<details class="wrong-details"><summary>查看错题句（' + row.items.length + '）</summary><div class="wrong-list">' + items + '</div></details>' +
              '</div>'
            );
          })
          .join('')
      : '<div class="empty-state">还没有错题 —— 默写时会自动记录答错的篇目和句子。</div>';

    root.innerHTML =
      '<section class="card">' +
        '<h2 class="section-title">我的进度</h2>' +
        '<div class="stat-row">' +
          '<div class="stat-box"><div class="stat-num">' + summary.learned + ' / ' + summary.list.length + '</div><div class="stat-label">已学习 / 已选择</div></div>' +
          '<div class="stat-box"><div class="stat-num">' + summary.stats.total + '</div><div class="stat-label">累计默写次数</div></div>' +
          '<div class="stat-box"><div class="stat-num">' + summary.accuracy + '%</div><div class="stat-label">整体正确率</div></div>' +
          '<div class="stat-box"><div class="stat-num">' + summary.today.quiz + '</div><div class="stat-label">今日默写</div></div>' +
          '<div class="stat-box"><div class="stat-num">' + summary.streak + '</div><div class="stat-label">连续学习天数</div></div>' +
          '<div class="stat-box"><div class="stat-num">' + summary.focusLearned + ' / ' + summary.focusTotal + '</div><div class="stat-label">已学篇目重点句</div></div>' +
        '</div>' +
        '<p class="tiny muted" style="margin-top:0.6rem;">数据保存在本机浏览器 localStorage 中，清除浏览器数据会同时清除进度。可以在下方导出备份。</p>' +
      '</section>' +
      '<section class="card">' +
        '<h3 class="section-title" style="font-size:1rem;">近 60 天</h3>' +
        '<div class="heatmap" aria-label="近 60 天默写热力图">' + heatCells + '</div>' +
        '<div class="heat-legend"><span class="tiny muted">少</span><span class="heat-cell" data-level="0"></span><span class="heat-cell" data-level="1"></span><span class="heat-cell" data-level="2"></span><span class="heat-cell" data-level="3"></span><span class="heat-cell" data-level="4"></span><span class="tiny muted">多</span></div>' +
        '<p class="tiny muted" style="margin-top:0.6rem;">连续学习 ' + summary.streak + ' 天 · 今日默写 ' + summary.today.quiz + ' 题</p>' +
      '</section>' +
      '<section class="card">' +
        '<h3 class="section-title" style="font-size:1rem;">本周小结</h3>' +
        '<p class="section-desc">本周默写 ' + summary.weekly.quiz + ' 题 · 正确 ' + summary.weekly.correct + ' 题 · 学习 ' + summary.weekly.active + ' 天</p>' +
        (summary.weekly.weakest ? '<p class="tiny muted">最薄弱篇目：《' + Utils.escapeHtml(summary.weekly.weakest.title) + '》——可以优先复习这一篇。</p>' : '') +
        '<div class="select-actions" style="margin-top:0.7rem;"><button type="button" class="btn btn-sm btn-primary" data-action="quiz-review">开始今日复习</button><button type="button" class="btn btn-sm" data-action="quiz-wrong">练习错题</button></div>' +
      '</section>' +
      '<section class="card">' +
        '<h3 class="section-title" style="font-size:1rem;">错题本（' + summary.wrongBook.length + ' 篇）</h3>' +
        wrongHtml +
      '</section>' +
      '<section class="card">' +
        '<h3 class="section-title" style="font-size:1rem;">练习记录</h3>' +
        (rows || '<div class="empty-state">还没有练习记录，去做一组默写自测吧。</div>') +
      '</section>' +
      '<section class="card">' +
        '<h3 class="section-title" style="font-size:1rem;">数据管理</h3>' +
        '<p class="tiny muted">导出文件包含篇目选择、学习进度、错题和复习计划；导入会覆盖本机现有学习数据。</p>' +
        '<div class="select-actions" style="margin-top:0.7rem;">' +
          '<button type="button" class="btn btn-sm" data-action="export-data">导出学习数据</button>' +
          '<label class="btn btn-sm file-btn">导入学习数据<input type="file" id="importFile" accept="application/json,.json"></label>' +
          '<button type="button" class="btn btn-sm" data-action="copy-share">复制篇目清单链接</button>' +
        '</div>' +
      '</section>' +
      '<section class="card">' +
        '<h3 class="section-title" style="font-size:1rem;">数据来源与说明</h3>' +
        '<p class="tiny muted">初中：' + Utils.escapeHtml(Meta.sources.junior.name) + '（' + Utils.escapeHtml(Meta.sources.junior.detail) + '）</p>' +
        '<p class="tiny muted">高中：' + Utils.escapeHtml(Meta.sources.senior.name) + '（' + Utils.escapeHtml(Meta.sources.senior.detail) + '）</p>' +
        '<p class="tiny muted">题库共 ' + DB.all().length + ' 篇，其中课标推荐 ' + DB.query({ onlyRequired: true }).length + ' 篇；所有正文均可人工核对后修改 data/ 目录下的数据文件。</p>' +
        '<div class="danger-zone">' +
          '<button type="button" class="btn btn-sm" data-action="reset">重置全部本地数据</button>' +
          '<span class="tiny muted" style="margin-left:0.5rem;">选中的篇目、进度、错题都会清空（不可恢复）。</span>' +
        '</div>' +
      '</section>';
  }

  /* ---------------- 数据导出 / 导入 / 分享 ---------------- */

  function downloadText(filename, text) {
    try {
      var blob = new Blob([text], { type: 'application/json;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () {
        URL.revokeObjectURL(url);
      }, 1000);
      return true;
    } catch (err) {
      return false;
    }
  }

  function handleExport() {
    var payload = Storage.exportData();
    var text = JSON.stringify(payload, null, 2);
    var ok = downloadText('hison-poetry-backup-' + Utils.todayKey().replace(/-/g, '') + '.json', text);
    if (!ok && global.prompt) global.prompt('复制下面的学习数据并保存：', text);
    toast(ok ? '学习数据已导出' : '浏览器不支持直接下载，已打开复制窗口');
  }

  function handleImportFile(input) {
    var file = input && input.files && input.files[0];
    if (!file) return;
    if (!global.FileReader) {
      toast('当前浏览器不支持导入文件');
      return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var payload = JSON.parse(String(reader.result));
        if (global.confirm && !global.confirm('导入会覆盖本机现有学习数据，确定继续吗？')) return;
        var result = Storage.importData(payload);
        if (!result.ok) {
          toast(result.error || '导入失败');
          return;
        }
        state.stage = Storage.getState().stage;
        // 恢复另一学段或空白备份后，不能沿用导入前的学段 / 年级筛选。
        state.filters = { keyword: '', grade: [], genre: [], progress: [] };
        state.sort = 'default';
        toast('学习数据已导入');
        navigate('home');
      } catch (err) {
        toast('导入失败：文件不是合法 JSON');
      }
    };
    reader.onerror = function () {
      toast('读取文件失败');
    };
    reader.readAsText(file);
    input.value = '';
  }

  function copyText(text) {
    if (global.navigator && global.navigator.clipboard && global.navigator.clipboard.writeText) {
      return global.navigator.clipboard.writeText(text).then(function () {
        return true;
      }).catch(function () {
        return false;
      });
    }
    return Promise.resolve(false);
  }

  function handleCopyShare() {
    if (!Storage.getState().selectedIds.length) {
      toast('还没有选择篇目');
      return;
    }
    var url = buildShareUrl();
    copyText(url).then(function (ok) {
      if (!ok && global.prompt) global.prompt('复制这篇目清单链接：', url);
      toast(ok ? '已复制篇目清单链接' : '链接已生成，请手动复制');
    });
  }

  /* ---------------- 渲染与事件 ---------------- */

  function updateHeader() {
    if (!els.subtitle) return;
    var summary = {
      stage: state.stage,
      selected: Storage.getState().selectedIds.length,
    };
    var title = VIEW_TITLES[state.view] || Meta.slogan;
    els.subtitle.textContent = title;
    if (els.meta) {
      var due = Storage.duePoemIds().length;
      els.meta.innerHTML = summary.stage
        ? '<span class="badge badge-primary">' + Utils.escapeHtml(summary.stage) + '</span><span class="badge">已选 ' + summary.selected + ' 篇</span>' +
          (due ? '<span class="badge badge-warn">待复习 ' + due + '</span>' : '')
        : '';
    }
    if (els.back) {
      els.back.hidden = state.view === 'stage';
      els.back.setAttribute('aria-label', state.view === 'select' ? '返回选择学习阶段' : '返回');
    }
  }

  function focusView(container) {
    if (!container) return;
    var heading = container.querySelector('h1, h2');
    if (!heading) return;
    heading.setAttribute('tabindex', '-1');
    try {
      heading.focus({ preventScroll: true });
    } catch (err) {
      heading.focus();
    }
  }

  function syncHeaderHeight() {
    var header = document.querySelector('.app-header');
    if (!header) return;
    document.documentElement.style.setProperty('--app-header-height', header.offsetHeight + 'px');
  }

  function render() {
    var container = document.createElement('div');
    /* 入场动画只在真正切换页面时播放；同一页面内的筛选 / 勾选重绘保持静止 */
    var entering = state.view !== render.lastView;
    render.lastView = state.view;
    container.className = entering ? 'view-inner view-inner--enter' : 'view-inner';

    /* 阅读偏好类名只属于学习页：离开学习页时清理，避免专注模式把导航藏到别的页面 */
    if (document.body) document.body.classList.remove('focus-reading', 'font-sm', 'font-md', 'font-lg');

    try {
      if (!DB.all().length) {
        container.innerHTML = '<section class="card"><div class="empty-state">题库为空：请在 data/junior.js、data/senior.js 中补充篇目数据。</div></section>';
      } else if (state.view === 'stage') renderStage(container);
      else if (state.view === 'select') renderSelect(container);
      else if (state.view === 'home') renderHome(container);
      else if (state.view === 'study') {
        var studyList = selectedPoems();
        var lastPoem = hashParam('poem') || global.PoetryStudy.currentPoemId();
        var inList = studyList.some(function (poem) {
          return poem.id === lastPoem;
        });
        global.PoetryStudy.mount(container, {
          list: studyList,
          poemId: inList ? lastPoem : '',
        });
      } else if (state.view === 'quiz') {
        var scopeParam = hashParam('scope');
        global.PoetryQuiz.mount(container, {
          list: selectedPoems(),
          focusPoemId: hashParam('poem'),
          focusKey: hashParam('item'),
          initialScope: scopeParam,
          onProgress: updateHeader,
        });
      } else if (state.view === 'progress') renderProgress(container);
      else if (state.view === 'print') {
        global.PoetryWorksheet.mount(container, {
          list: selectedPoems(),
        });
      }
    } catch (err) {
      console.error('[渲染失败]', err);
      container.innerHTML =
        '<section class="card"><div class="empty-state">页面渲染出现异常，已保护性停止。<br>可以点击下方按钮重置本地数据后重试。</div>' +
        '<div style="margin-top:0.9rem;display:flex;gap:0.5rem;justify-content:center;"><button type="button" class="btn btn-sm" data-safe="home">返回首页</button><button type="button" class="btn btn-sm" data-safe="reset">重置本地数据</button></div></section>';
    }

    els.root.innerHTML = '';
    els.root.appendChild(container);
    if (entering) {
      /* 换页时收起上一页的 toast，避免“已生成 10 道题”压在新页面按钮上 */
      if (els.toast) els.toast.classList.remove('show');
      focusView(container);
    }
    updateHeader();
    syncHeaderHeight();
    if (global.PoetryBrand && global.PoetryBrand.refresh) {
      try {
        global.PoetryBrand.refresh();
      } catch (err) {
        /* 品牌层异常不影响主流程 */
      }
    }
  }

  function handleGlobalClick(event) {
    var target = event.target;
    var el = target.closest ? target.closest('[data-stage],[data-action],[data-poem],[data-remove],[data-filter],[data-study],[data-practice],[data-practice-item],[data-remove-wrong],[data-remove-wrong-item],[data-safe]') : null;
    if (!el) return;

    if (el.hasAttribute('data-stage')) {
      state.stage = el.getAttribute('data-stage');
      Storage.patch({ stage: state.stage });
      state.filters = { keyword: '', grade: [], genre: [], progress: [] };
      state.sort = 'default';
      navigate('select');
      return;
    }
    if (el.hasAttribute('data-filter')) {
      var key = el.getAttribute('data-filter');
      var value = el.getAttribute('data-value') || '';
      // 年级 / 课程模块、体裁、掌握度都支持多选：点“全部”清空，点某一项将其加入或移出
      if (!value) {
        state.filters[key] = [];
      } else {
        var picked = state.filters[key].slice();
        var pickedIndex = picked.indexOf(value);
        if (pickedIndex === -1) picked.push(value);
        else picked.splice(pickedIndex, 1);
        state.filters[key] = picked;
      }
      render();
      return;
    }
    if (el.hasAttribute('data-poem')) {
      var id = el.getAttribute('data-poem');
      var ids = Storage.getState().selectedIds.slice();
      var index = ids.indexOf(id);
      if (index === -1) ids.push(id);
      else ids.splice(index, 1);
      Storage.patch({ selectedIds: ids });
      updateSelectSelection(id);
      return;
    }
    if (el.hasAttribute('data-remove')) {
      var removeId = el.getAttribute('data-remove');
      Storage.patch({
        selectedIds: Storage.getState().selectedIds.filter(function (item) {
          return item !== removeId;
        }),
      });
      updateSelectSelection(removeId);
      return;
    }
    if (el.hasAttribute('data-study')) {
      navigate('study', '?poem=' + encodeURIComponent(el.getAttribute('data-study')));
      return;
    }
    if (el.hasAttribute('data-practice-item')) {
      var itemKey = el.getAttribute('data-practice-item');
      var poemId = el.getAttribute('data-practice-poem') || '';
      navigate('quiz', '?poem=' + encodeURIComponent(poemId) + '&item=' + encodeURIComponent(itemKey));
      return;
    }
    if (el.hasAttribute('data-practice')) {
      /* 只练这一篇：错误次数由判分逻辑维护，打开练习本身不算答错 */
      navigate('quiz', '?poem=' + encodeURIComponent(el.getAttribute('data-practice')));
      return;
    }
    if (el.hasAttribute('data-remove-wrong-item')) {
      Storage.removeWrongItem(el.getAttribute('data-remove-wrong-item'));
      toast('已从错题本移除该句');
      render();
      return;
    }
    if (el.hasAttribute('data-remove-wrong')) {
      Storage.removeWrong(el.getAttribute('data-remove-wrong'));
      toast('已从错题本移除');
      render();
      return;
    }
    if (el.hasAttribute('data-safe')) {
      if (el.getAttribute('data-safe') === 'reset') {
        Storage.reset();
        toast('本地数据已重置');
      }
      navigate('stage');
      return;
    }

    // data-action
    var action = el.getAttribute('data-action');
    if (action === 'continue') {
      var savedStage = Storage.getState().stage;
      if (!savedStage) {
        var first = Storage.getState().selectedIds[0];
        var poem = first ? DB.byId(first) : null;
        savedStage = poem ? poem.stage : '';
      }
      if (!savedStage) return;
      state.stage = savedStage;
      navigate('home');
    } else if (action === 'to-select') {
      navigate('select');
    } else if (action === 'study') {
      navigate('study');
    } else if (action === 'quiz') {
      navigate('quiz');
    } else if (action === 'quiz-wrong') {
      navigate('quiz', '?scope=wrong');
    } else if (action === 'quiz-review') {
      navigate('quiz', '?scope=review');
    } else if (action === 'progress') {
      navigate('progress');
    } else if (action === 'print') {
      navigate('print');
    } else if (action === 'start') {
      if (!Storage.getState().selectedIds.length) {
        toast('请先勾选至少一篇要背诵的篇目');
        return;
      }
      navigate('home');
    } else if (action === 'select-all') {
      var filteredIds = DB.query({
        stage: state.stage,
        grade: state.filters.grade,
        genre: state.filters.genre,
        keyword: state.filters.keyword,
      }).filter(matchesProgress).map(function (poem) {
        return poem.id;
      });
      Storage.patch({ selectedIds: Utils.unique(Storage.getState().selectedIds.concat(filteredIds)) });
      render();
    } else if (action === 'select-none') {
      var stageIds = DB.byStage(state.stage).map(function (poem) {
        return poem.id;
      });
      Storage.patch({
        selectedIds: Storage.getState().selectedIds.filter(function (id) {
          return stageIds.indexOf(id) === -1;
        }),
      });
      render();
    } else if (action === 'select-required') {
      var requiredIds = DB.byStage(state.stage)
        .filter(function (poem) {
          return poem.required;
        })
        .map(function (poem) {
          return poem.id;
        });
      Storage.patch({ selectedIds: Utils.unique(Storage.getState().selectedIds.concat(requiredIds)) });
      toast('已选中课标必背篇目 ' + requiredIds.length + ' 篇');
      render();
    } else if (action === 'clear-search') {
      state.filters.keyword = '';
      var input = document.getElementById('poemSearch');
      if (input) input.value = '';
      refreshSelectResults();
    } else if (action === 'reset') {
      if (global.confirm('确定要清空全部本地学习数据吗？此操作不可恢复。')) {
        Storage.reset();
        toast('本地数据已重置');
        navigate('stage');
      }
    } else if (action === 'export-data') {
      handleExport();
    } else if (action === 'copy-share') {
      handleCopyShare();
    }
  }

  function handleGlobalInput(event) {
    if (event.target && event.target.id === 'poemSearch') {
      state.filters.keyword = event.target.value;
      debouncedSearch();
    }
  }

  function handleGlobalChange(event) {
    var target = event.target;
    if (!target) return;
    if (target.id === 'poemSort') {
      state.sort = target.value;
      render();
      return;
    }
    if (target.id === 'importFile') {
      handleImportFile(target);
    }
  }

  function handleGlobalKeydown(event) {
    if (state.view === 'study' && global.PoetryStudy && global.PoetryStudy.handleKey) {
      global.PoetryStudy.handleKey(event);
    }
  }

  var debouncedSearch = Utils.debounce(function () {
    refreshSelectResults();
  }, 120);

  function goBack() {
    var parent = '';
    if (state.view === 'study' || state.view === 'quiz' || state.view === 'progress' || state.view === 'print') parent = 'home';
    else if (state.view === 'home') parent = 'select';
    else if (state.view === 'select') parent = 'stage';
    if (!parent) return;
    /* 顶栏“返回”是页面上行跳转，不跟着浏览器历史走：
       从进度页点“再练一次”进入默写后，返回应该回到工作台，而不是回到进度页。 */
    navigate(parent, '', { replace: true });
  }

  function applyLocation() {
    var raw = global.location.hash || '';
    if (hashParam('list') && applySharedList()) {
      raw = '#/select';
      try {
        global.history.replaceState({ depth: currentDepth(), view: 'select' }, '', raw);
      } catch (err) {
        /* 忽略 */
      }
    }
    var hash = raw.replace(/^#\/?/, '');
    var parts = hash.split('?');
    var view = parts[0] || '';
    if (VIEWS.indexOf(view) === -1) return;
    if (!state.stage) {
      var savedStage = Storage.getState().stage;
      if (savedStage) state.stage = savedStage;
    }
    if (!canShow(view)) {
      navigate(canShow('select') ? 'select' : 'stage', '', { replace: true });
      return;
    }
    if (state.view !== view || raw !== lastHash) {
      state.view = view;
      lastHash = raw;
      render();
      if (global.scrollTo) global.scrollTo(0, 0);
    }
  }

  function handleHashChange() {
    applyLocation();
  }

  function handlePopState() {
    applyLocation();
  }

  function boot() {
    els.root = document.getElementById('viewRoot');
    els.toast = document.getElementById('toast');
    els.subtitle = document.getElementById('headerSubtitle');
    els.meta = document.getElementById('headerMeta');
    els.back = document.getElementById('headerBack');
    els.themeToggle = document.getElementById('themeToggle');

    var saved = Storage.load();
    state.stage = saved.stage || '';

    applyTheme(readTheme());
    if (els.themeToggle) els.themeToggle.addEventListener('click', toggleTheme);

    if (global.PoetryBrand && global.PoetryBrand.install) {
      try {
        global.PoetryBrand.install();
      } catch (err) {
        console.warn('[品牌层] 初始化失败', err);
      }
    }

    var issue = Storage.getLoadIssue();
    if (issue) toast(issue);

    var sharedApplied = false;
    if (hashParam('list')) {
      sharedApplied = applySharedList();
      if (sharedApplied) {
        try {
          global.history.replaceState({ depth: 0, view: 'select' }, '', '#/select');
        } catch (err) {
          /* 忽略 */
        }
      }
    }

    var hash = (global.location.hash || '').replace(/^#\/?/, '').split('?')[0];
    if (VIEWS.indexOf(hash) !== -1 && canShow(hash)) state.view = hash;
    else if (saved.selectedIds.length && state.stage) state.view = sharedApplied ? 'select' : 'home';
    else state.view = 'stage';
    lastHash = sharedApplied ? '#/select' : (global.location.hash || '');
    try {
      /* 首次打开没有 hash 时不要把 #/stage 写进地址栏：
         否则刷新会从“已选篇目的工作台”掉回学段页。 */
      var initialTarget = lastHash || (global.location.pathname + global.location.search);
      global.history.replaceState({ depth: 0, view: state.view }, '', initialTarget);
    } catch (err) {
      /* 忽略 */
    }

    document.addEventListener('click', handleGlobalClick);
    document.addEventListener('input', handleGlobalInput);
    document.addEventListener('change', handleGlobalChange);
    document.addEventListener('keydown', handleGlobalKeydown);
    global.addEventListener('hashchange', handleHashChange);
    global.addEventListener('popstate', handlePopState);
    if (global.addEventListener) global.addEventListener('resize', syncHeaderHeight);
    if (els.back) els.back.addEventListener('click', goBack);

    render();

    if (DB.problems && DB.problems.length) {
      console.warn('[题库校验]', DB.problems.join('\n'));
    }
  }

  global.PoetryApp = {
    toast: toast,
    navigate: navigate,
    render: render,
    getState: function () {
      return state;
    },
    buildShareUrl: buildShareUrl,
    encodeSelection: encodeSelection,
    decodeSelection: decodeSelection,
    syncHeaderHeight: syncHeaderHeight,
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window);
