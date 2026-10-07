/* 古诗文背诵学习系统 —— 应用主控
   职责：统一状态管理、视图路由、选择页 / 主界面 / 进度页渲染。 */
(function (global) {
  'use strict';

  var Utils = global.PoetryUtils;
  var Storage = global.PoetryStorage;
  var DB = global.PoetryDatabase;
  var Meta = global.PoetryMeta;

  var state = {
    view: 'stage',
    stage: '',
    // 年级 / 课程模块、体裁支持多选（数组）
    filters: { keyword: '', grade: [], genre: [] },
  };

  var els = {};
  var lastHash = ''; // 上一次已经渲染过的完整 hash（含 ?poem= 这类参数）

  var VIEWS = ['stage', 'select', 'home', 'study', 'quiz', 'progress'];
  var VIEW_TITLES = {
    stage: '初高中古诗文背诵学习系统 · 纯本地运行',
    select: '选择要背诵的篇目',
    home: '学习工作台',
    study: '全文学习',
    quiz: '默写自测',
    progress: '我的进度',
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
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#0b1020' : '#f4f7ff');
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
      });
    return {
      list: list,
      learned: learned,
      today: today,
      stats: stats,
      byPoem: byPoem,
      wrongBook: saved.wrongBook
        .map(function (entry) {
          return { entry: entry, poem: DB.byId(entry.id) };
        })
        .filter(function (row) {
          return !!row.poem;
        }),
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

  function navigate(view, hashOptions) {
    if (VIEWS.indexOf(view) === -1) view = 'stage';
    if (!canShow(view)) view = state.stage ? 'select' : 'stage';
    state.view = view;
    var hash = '#/' + view + (hashOptions || '');
    lastHash = hash;
    if (global.location.hash !== hash) {
      try {
        global.history.replaceState(null, '', hash);
      } catch (err) {
        global.location.hash = hash;
      }
    }
    render();
    /* 换页后回到顶部，避免沿用上一页的滚动位置 */
    if (global.scrollTo) global.scrollTo(0, 0);
  }

  /** 判断某个视图当前是否具备展示条件（没有选择篇目就不要进学习页） */
  function canShow(view) {
    if (view === 'stage') return true;
    if (!state.stage) return false;
    if (view === 'select') return true;
    return Storage.getState().selectedIds.length > 0;
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
    return (f.grade.length ? 1 : 0) + (f.genre.length ? 1 : 0);
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

  function filteredPoems() {
    return DB.sort(DB.query({
      stage: state.stage,
      grade: state.filters.grade,
      genre: state.filters.genre,
      keyword: state.filters.keyword,
    }));
  }

  function selectResultsHtml() {
    var stage = state.stage;
    var filtered = filteredPoems();
    var selectedIds = Storage.getState().selectedIds;
    var groups = Utils.groupBy(filtered, function (poem) {
      return poem.grade;
    });
    var order = DB.gradeOrder(stage);
    groups.sort(function (a, b) {
      var oa = order.indexOf(a.key);
      var ob = order.indexOf(b.key);
      return (oa === -1 ? 99 : oa) - (ob === -1 ? 99 : ob);
    });

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
                return (
                  '<button type="button" class="poem-card' + (checked ? ' checked' : '') + '" data-poem="' + Utils.escapeHtml(poem.id) + '" aria-pressed="' + checked + '">' +
                    '<span class="check" aria-hidden="true">' + (checked ? '✓' : '') + '</span>' +
                    '<span class="poem-main">' +
                      '<span class="poem-title">' + Utils.escapeHtml(poem.title) + '</span>' +
                      '<span class="poem-sub">' + Utils.escapeHtml(poem.author + ' · ' + poem.dynasty) + '</span>' +
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

  function renderSelect(root) {
    var stage = state.stage;
    var all = DB.byStage(stage);
    var selectedIds = Storage.getState().selectedIds;
    var selectedInStage = all.filter(function (poem) {
      return selectedIds.indexOf(poem.id) !== -1;
    });
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

    root.innerHTML =
      '<section class="card">' +
        '<h2 class="section-title">请选择要背诵的篇目</h2>' +
        '<p class="section-desc">' + Utils.escapeHtml(stage) + '共有 ' + all.length + ' 篇，支持多选、搜索，' +
          Utils.escapeHtml(stage === '高中' ? '按课程模块' : '按年级') + ' / 体裁筛选，两类筛选都可以多选。</p>' +
        '<div class="toolbar" style="margin-top:0.9rem;">' +
          '<div class="search-box">' +
            '<input type="search" id="poemSearch" placeholder="搜索篇名 / 作者 / 朝代 / 关键词（如：李白）" value="' + Utils.escapeHtml(state.filters.keyword) + '" aria-label="搜索篇目">' +
            '<button type="button" class="search-clear" data-action="clear-search" aria-label="清空搜索">✕</button>' +
          '</div>' +
          '<div class="filter-group"><span class="filter-label">' + Utils.escapeHtml((Meta.gradeLabels && Meta.gradeLabels[stage]) || '年级') + '（可多选）</span><div class="chips">' + chips(grades, 'grade', state.filters.grade, stage === '高中' ? '全部模块' : '全部年级') + '</div></div>' +
          '<div class="filter-group"><span class="filter-label">体裁（可多选）</span><div class="chips">' + chips(genres, 'genre', state.filters.genre, '全部体裁') + '</div></div>' +
          '<div class="select-actions">' +
            '<button type="button" class="btn btn-sm" data-action="select-all">全选当前结果</button>' +
            '<button type="button" class="btn btn-sm" data-action="select-none">取消全选</button>' +
            '<button type="button" class="btn btn-sm" data-action="select-required">只选课标必背</button>' +
            '<span class="select-summary">已选择 ' + selectedInStage.length + ' 篇</span>' +
          '</div>' +
          (selectedInStage.length
            ? '<details class="selected-panel"><summary>已选篇目快速查看（' + selectedInStage.length + '）</summary><div class="selected-list">' +
              selectedInStage
                .map(function (poem) {
                  return '<span class="selected-chip">' + Utils.escapeHtml(poem.title) + '<button type="button" data-remove="' + Utils.escapeHtml(poem.id) + '" aria-label="移除' + Utils.escapeHtml(poem.title) + '">✕</button></span>';
                })
                .join('') +
              '</div></details>'
            : '') +
        '</div>' +
        '<div style="margin-top:1rem;display:flex;flex-wrap:wrap;gap:0.5rem;align-items:center;">' +
          '<button type="button" class="btn btn-primary" data-action="start" ' + (selectedInStage.length ? '' : 'disabled') + '>进入学习（已选 ' + selectedInStage.length + ' 篇）</button>' +
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

    root.innerHTML =
      '<section class="card">' +
        '<h2 class="section-title">' + Utils.escapeHtml(state.stage) + '背诵工作台</h2>' +
        '<p class="section-desc">已选择 ' + total + ' 篇 · 最近学习：' + (recent ? Utils.escapeHtml(recent.poem.title) + '（' + Utils.escapeHtml(Utils.formatDateTime(recent.item.time)) + '）' : '还没有开始') + '</p>' +
        '<div class="stat-row">' +
          '<div class="stat-box"><div class="stat-num">' + summary.learned + ' / ' + total + '</div><div class="stat-label">已学习篇目</div></div>' +
          '<div class="stat-box"><div class="stat-num">' + summary.today.quiz + '</div><div class="stat-label">今日默写次数</div></div>' +
          '<div class="stat-box"><div class="stat-num">' + summary.stats.correct + ' / ' + summary.stats.total + '</div><div class="stat-label">累计正确 / 总次数</div></div>' +
          '<div class="stat-box"><div class="stat-num">' + summary.wrongBook.length + '</div><div class="stat-label">错题本篇目</div></div>' +
        '</div>' +
        '<div class="bar" aria-hidden="true"><span style="width:' + learnedPct + '%"></span></div>' +
      '</section>' +
      '<div class="feature-grid">' +
        '<button type="button" class="feature-card" data-action="study"><span class="fc-ico" aria-hidden="true">诵</span><h3>背诵学习</h3><p>逐句显示 / 隐藏、关键词隐藏、上一句下一句，先自己背一遍。</p></button>' +
        '<button type="button" class="feature-card" data-action="quiz"><span class="fc-ico" aria-hidden="true">写</span><h3>默写自测</h3><p>整句挖空、给上句写下句、关键词提示等 6 种题型随机组合。</p></button>' +
        '<button type="button" class="feature-card" data-action="to-select"><span class="fc-ico" aria-hidden="true">篇</span><h3>篇目列表</h3><p>查看、搜索并调整要背诵的篇目（当前 ' + total + ' 篇）。</p></button>' +
        '<button type="button" class="feature-card" data-action="progress"><span class="fc-ico" aria-hidden="true">记</span><h3>我的进度</h3><p>学习进度、默写正确率与错题本，全部保存在本机。</p></button>' +
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

  function renderProgress(root) {
    var summary = progressSummary();
    var saved = Storage.getState();
    var rows = summary.byPoem
      .sort(function (a, b) {
        return (b.item.lastTime || 0) - (a.item.lastTime || 0);
      })
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

    root.innerHTML =
      '<section class="card">' +
        '<h2 class="section-title">我的进度</h2>' +
        '<div class="stat-row">' +
          '<div class="stat-box"><div class="stat-num">' + summary.learned + ' / ' + summary.list.length + '</div><div class="stat-label">已学习 / 已选择</div></div>' +
          '<div class="stat-box"><div class="stat-num">' + summary.stats.total + '</div><div class="stat-label">累计默写次数</div></div>' +
          '<div class="stat-box"><div class="stat-num">' + summary.accuracy + '%</div><div class="stat-label">整体正确率</div></div>' +
          '<div class="stat-box"><div class="stat-num">' + summary.today.quiz + '</div><div class="stat-label">今日默写</div></div>' +
        '</div>' +
        '<p class="tiny muted" style="margin-top:0.6rem;">数据保存在本机浏览器 localStorage 中，清除浏览器数据会同时清除进度。</p>' +
      '</section>' +
      '<section class="card">' +
        '<h3 class="section-title" style="font-size:1rem;">错题本（' + summary.wrongBook.length + '）</h3>' +
        (summary.wrongBook.length
          ? '<div class="progress-list">' + summary.wrongBook
              .map(function (row) {
                return (
                  '<div class="progress-item"><div class="pi-main"><div>' + Utils.escapeHtml(row.poem.title) + '</div>' +
                  '<div class="pi-sub">错 ' + row.entry.count + ' 次 · ' + Utils.escapeHtml(Utils.formatDateTime(row.entry.time)) + '</div></div>' +
                  '<div style="display:flex;gap:0.4rem;"><button type="button" class="btn btn-sm btn-primary" data-practice="' + Utils.escapeHtml(row.poem.id) + '">再练一次</button>' +
                  '<button type="button" class="btn btn-sm" data-remove-wrong="' + Utils.escapeHtml(row.poem.id) + '">移除</button></div></div>'
                );
              })
              .join('') + '</div>'
          : '<div class="empty-state">还没有错题 —— 默写时会自动记录答错的篇目。</div>') +
      '</section>' +
      '<section class="card">' +
        '<h3 class="section-title" style="font-size:1rem;">练习记录</h3>' +
        (rows || '<div class="empty-state">还没有练习记录，去做一组默写自测吧。</div>') +
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
      els.meta.innerHTML = summary.stage
        ? '<span class="badge badge-primary">' + Utils.escapeHtml(summary.stage) + '</span><span class="badge">已选 ' + summary.selected + ' 篇</span>'
        : '';
    }
    if (els.back) {
      els.back.hidden = state.view === 'stage';
      els.back.setAttribute('aria-label', state.view === 'select' ? '返回选择学习阶段' : '返回');
    }
  }

  function render() {
    var container = document.createElement('div');
    /* 入场动画只在真正切换页面时播放；同一页面内的筛选 / 勾选重绘保持静止 */
    var entering = state.view !== render.lastView;
    render.lastView = state.view;
    container.className = entering ? 'view-inner view-inner--enter' : 'view-inner';

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
        global.PoetryQuiz.mount(container, {
          list: selectedPoems(),
          focusPoemId: hashParam('poem'),
          onProgress: updateHeader,
        });
      } else if (state.view === 'progress') renderProgress(container);
    } catch (err) {
      console.error('[渲染失败]', err);
      container.innerHTML =
        '<section class="card"><div class="empty-state">页面渲染出现异常，已保护性停止。<br>可以点击下方按钮重置本地数据后重试。</div>' +
        '<div style="margin-top:0.9rem;display:flex;gap:0.5rem;justify-content:center;"><button type="button" class="btn btn-sm" data-safe="home">返回首页</button><button type="button" class="btn btn-sm" data-safe="reset">重置本地数据</button></div></section>';
    }

    els.root.innerHTML = '';
    els.root.appendChild(container);
    updateHeader();
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
    var el = target.closest ? target.closest('[data-stage],[data-action],[data-poem],[data-remove],[data-filter],[data-study],[data-practice],[data-remove-wrong],[data-safe]') : null;
    if (!el) return;

    if (el.hasAttribute('data-stage')) {
      state.stage = el.getAttribute('data-stage');
      Storage.patch({ stage: state.stage });
      state.filters = { keyword: '', grade: [], genre: [] };
      navigate('select');
      return;
    }
    if (el.hasAttribute('data-filter')) {
      var key = el.getAttribute('data-filter');
      var value = el.getAttribute('data-value') || '';
      // 年级 / 课程模块、体裁都支持多选：点“全部”清空，点某一项将其加入或移出
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
      render();
      return;
    }
    if (el.hasAttribute('data-remove')) {
      var removeId = el.getAttribute('data-remove');
      Storage.patch({
        selectedIds: Storage.getState().selectedIds.filter(function (item) {
          return item !== removeId;
        }),
      });
      render();
      return;
    }
    if (el.hasAttribute('data-study')) {
      navigate('study', '?poem=' + encodeURIComponent(el.getAttribute('data-study')));
      return;
    }
    if (el.hasAttribute('data-practice')) {
      /* 只练这一篇：错误次数由判分逻辑维护，打开练习本身不算答错 */
      navigate('quiz', '?poem=' + encodeURIComponent(el.getAttribute('data-practice')));
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
    } else if (action === 'quiz' || action === 'quiz-wrong') {
      navigate('quiz');
    } else if (action === 'progress') {
      navigate('progress');
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
      }).map(function (poem) {
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
    }
  }

  function handleGlobalInput(event) {
    if (event.target && event.target.id === 'poemSearch') {
      state.filters.keyword = event.target.value;
      debouncedSearch();
    }
  }

  var debouncedSearch = Utils.debounce(function () {
    refreshSelectResults();
  }, 120);

  function goBack() {
    if (state.view === 'study' || state.view === 'quiz' || state.view === 'progress') navigate('home');
    else if (state.view === 'home') navigate('select');
    else if (state.view === 'select') navigate('stage');
  }

  function handleHashChange() {
    var rawHash = global.location.hash || '';
    var hash = rawHash.replace(/^#\/?/, '');
    var parts = hash.split('?');
    var view = parts[0] || '';
    if (VIEWS.indexOf(view) === -1) return;
    if (!state.stage) {
      var savedStage = Storage.getState().stage;
      if (savedStage) state.stage = savedStage;
    }
    if (!canShow(view)) {
      navigate(canShow('select') ? 'select' : 'stage');
      return;
    }
    /* 同一个视图但 ?poem= 变了（例如手改地址栏、外部链接）也要重新渲染，
       否则只练某一篇 / 学习某一篇的链接会停留在旧状态。 */
    if (state.view !== view || rawHash !== lastHash) {
      state.view = view;
      lastHash = rawHash;
      render();
      if (global.scrollTo) global.scrollTo(0, 0);
    }
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

    var hash = (global.location.hash || '').replace(/^#\/?/, '').split('?')[0];
    if (VIEWS.indexOf(hash) !== -1 && canShow(hash)) state.view = hash;
    else if (saved.selectedIds.length && state.stage) state.view = 'home';
    else state.view = 'stage';
    lastHash = global.location.hash || '';

    document.addEventListener('click', handleGlobalClick);
    document.addEventListener('input', handleGlobalInput);
    global.addEventListener('hashchange', handleHashChange);
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
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window);
