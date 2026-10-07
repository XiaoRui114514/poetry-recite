/* brand.js — 作者品牌层（署名 / 印章 / 页脚 / 授权说明 / 隐形指纹 / 自愈守护）
   ------------------------------------------------------------
   设计参考「英语语法填空练习（English Grammar Lab）」的 brand.js：
   1) 可见署名：顶栏品牌、首页品牌标签、右下角印章（鼠标悬停自动展开，触屏点击展开）、页脚署名
   2) 隐形指纹：零宽字符编码，随文本复制而传播，可在控制台反查来源
   3) 版权与使用授权：首次访问自动提示，之后可通过页脚按钮随时打开
   4) 自愈守护：水印节点被删除 / 改名 / 隐藏都会被自动重建
   5) 作者身份编码存放、运行时解码，源码中不出现明文署名
   本模块只依赖 window / document，无 DOM 环境（Node 校验脚本）下可安全加载。 */
(function (global) {
  'use strict';

  var W = global;
  var NOTICE_KEY = 'hison-poetry-notice-v1';

  /* ================= 1) 作者身份（编码存放，运行时解码） ================= */
  var _K = 0x2f;
  var _P = [
    84, 13, 65, 13, 21, 13, 103, 70, 92, 64, 65, 13, 3, 13, 75, 86,
    13, 21, 13, 119, 125, 90, 70, 70, 70, 70, 70, 70, 13, 3, 13, 87,
    71, 92, 13, 21, 13, 87, 70, 78, 64, 93, 90, 70, 78, 78, 78, 26,
    29, 31, 13, 3, 13, 91, 78, 72, 13, 21, 13, 103, 70, 92, 64, 65,
    15, 21017, 20339, 13, 3, 13, 67, 78, 77, 13, 21, 13, 20005, 27992, 21042, 39671,
    21451, 35832, 26024, 32995, 35802, 13, 3, 13, 89, 13, 21, 30, 3, 13, 76, 68,
    13, 21, 30, 25, 24, 22, 29, 82
  ];
  var _ID;

  function raw() {
    var s = '';
    for (var i = 0; i < _P.length; i += 1) s += String.fromCharCode(_P[i] ^ _K);
    return s;
  }

  function ident() {
    if (_ID !== undefined) return _ID;
    _ID = null;
    try {
      var o = JSON.parse(raw());
      var seed = o.n + '|' + o.dy + '|' + o.xhs + '|' + o.v;
      var h = 0;
      for (var i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) % 99991;
      if (h === o.ck && o.n && o.dy && o.xhs && o.lab) _ID = o;
    } catch (err) {
      _ID = null;
    }
    return _ID;
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ================= 2) 隐形指纹（零宽字符，6 bit/字符） ================= */
  var AL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789|-';
  var Z0 = '\u200b';
  var Z1 = '\u200d';
  var ZS = '\u2060';
  var _SIG;

  function sig() {
    if (_SIG !== undefined) return _SIG;
    _SIG = '';
    var id = ident();
    if (!id) return _SIG;
    var txt = id.n + '|' + id.dy + '|' + id.xhs;
    var bits = '';
    for (var i = 0; i < txt.length; i += 1) {
      var k = AL.indexOf(txt.charAt(i));
      if (k < 0) k = 0;
      for (var j = 5; j >= 0; j -= 1) bits += (k >> j) & 1 ? Z1 : Z0;
    }
    _SIG = ZS + bits + ZS;
    return _SIG;
  }

  /** 给任意文本打上隐形指纹（幂等；零宽字符不影响阅读与判分） */
  function mark(text) {
    if (typeof text !== 'string' || !text) return text;
    var g = sig();
    if (!g || text.indexOf(g) >= 0) return text;
    return text + g;
  }

  /** 反查：从任意被复制 / 二次分发的文本中还原作者指纹 */
  function inspect(text) {
    if (typeof text !== 'string' || !text) return null;
    var bits = '';
    for (var i = 0; i < text.length; i += 1) {
      var c = text.charCodeAt(i);
      if (c === 0x200b) bits += '0';
      else if (c === 0x200d) bits += '1';
    }
    var out = '';
    for (var k = 0; k + 6 <= bits.length; k += 6) {
      var v = 0;
      for (var j = 0; j < 6; j += 1) v = (v << 1) | (bits.charCodeAt(k + j) - 48);
      out += AL.charAt(v);
    }
    return out.length >= 8 ? out : null;
  }

  /* ================= 3) 文案 ================= */
  var SUB = '初高中古诗文背诵学习系统';
  var REGION = '适配上海教材 · 覆盖全国课标';
  /* 开源仓库：优先读 data/metadata.js 的 brand.repo（单一来源），读不到时用内置副本 */
  var REPO_FALLBACK = { url: 'https://github.com/XiaoRui114514/poetry-recite', label: 'XiaoRui114514/poetry-recite' };

  function repoInfo() {
    var meta = W.PoetryMeta && W.PoetryMeta.brand && W.PoetryMeta.brand.repo;
    if (meta && typeof meta.url === 'string' && /^https:\/\//.test(meta.url)) {
      return { url: meta.url, label: typeof meta.label === 'string' && meta.label ? meta.label : meta.url };
    }
    return REPO_FALLBACK;
  }
  var CSS = '/*__BRAND_CSS__*/';
  var VER = '__RSYY_VER__';
  if (VER.indexOf('__') === 0) VER = '';

  /** 版本号：构建时由 build.js 注入；未构建时回退到 data/metadata.js */
  function ver() {
    var base = VER;
    if (!base) {
      var m = W.PoetryMeta;
      if (!m || !m.version) return '';
      base = 'v' + m.version + (m.updatedAt ? ' · 更新于 ' + m.updatedAt : '');
    }
    var count = W.PoetryDatabase && W.PoetryDatabase.all ? W.PoetryDatabase.all().length : 0;
    return base + (count ? ' · 题库 ' + count + ' 篇' : '');
  }

  function doc() {
    return W.document || null;
  }
  function body() {
    var d = doc();
    return d && d.body ? d.body : null;
  }
  function byId(id) {
    var d = doc();
    if (!d || !d.getElementById) return null;
    var el = d.getElementById(id);
    if (!el) return null;
    // 只认自己造的节点：被顶替 / 改名的一律当不存在，重建
    if (el.getAttribute && el.getAttribute('data-brand-ref') !== id) return null;
    return el;
  }
  function make(tag, id, cls) {
    var d = doc();
    var el = d.createElement(tag);
    el.id = id;
    el.className = cls;
    if (el.setAttribute) el.setAttribute('data-brand-ref', id);
    return el;
  }
  function drop(id) {
    var d = doc();
    var el = d && d.getElementById ? d.getElementById(id) : null;
    if (el && el.parentNode && el.parentNode.removeChild) el.parentNode.removeChild(el);
  }

  var SEAL = 'brandSeal';
  var FOOT = 'appFooter';
  var STYLE = 'brandStyle';

  function injectCSS() {
    var d = doc();
    if (!d || !d.createElement || !d.head) return;
    // 未构建时（直接打开源码）样式来自 assets/styles.css，无需注入
    if (CSS.indexOf('__BRAND_CSS__') >= 0) return;
    var st = byId(STYLE);
    var text = '/* 品牌水印样式（运行时注入 · 删除后自动重建） */\n' + CSS;
    if (!st) {
      st = make('style', STYLE, 'brand-style');
      d.head.appendChild(st);
    }
    if (st.textContent !== text) st.textContent = text;
  }

  function sealHTML(id) {
    return (
      '<span class="bs-face">by ' + esc(id.n) + '</span>' +
      '<span class="bs-panel" role="dialog" aria-label="作者署名">' +
        '<span class="bs-name">' + esc(id.tag) + '</span>' +
        '<span class="bs-row" data-brand-copy="' + esc(id.dy) + '"><i>抖音</i><b>' + esc(id.dy) + '</b></span>' +
        '<span class="bs-row" data-brand-copy="' + esc(id.xhs) + '"><i>小红书</i><b>' + esc(id.xhs) + '</b></span>' +
        '<span class="bs-tip">点击账号可复制 · 本作品仅供免费学习</span>' +
      '</span>'
    );
  }

  function bindSeal(el) {
    if (!el || !el.addEventListener) return;
    el.setAttribute('data-brand', 'seal');
    el.setAttribute('type', 'button');
    if (el.getAttribute('data-brand-face') !== String(ident() && ident().n)) {
      el.innerHTML = sealHTML(ident() || { n: 'Hison', tag: 'Hison 制作', dy: '', xhs: '' });
      el.setAttribute('data-brand-face', String(ident() && ident().n));
      el.addEventListener('click', function (event) {
        var target = event.target;
        var copyEl = target.closest ? target.closest('[data-brand-copy]') : null;
        if (copyEl) {
          event.stopPropagation();
          copyText(copyEl.getAttribute('data-brand-copy'));
          return;
        }
        if (el.classList) el.classList.toggle('on');
      });
      el.addEventListener('keydown', function (event) {
        if (event.key === 'Escape' && el.classList) el.classList.remove('on');
      });
    }
    var id = ident();
    if (id && el.setAttribute) {
      el.setAttribute('title', id.tag + ' · 抖音 ' + id.dy + ' · 小红书 ' + id.xhs);
      el.setAttribute('aria-label', '作者署名：' + id.tag + '，抖音 ' + id.dy + '，小红书 ' + id.xhs);
    }
  }

  // 点击空白处自动收起印章面板
  var _outsideBound = false;
  function bindOutside() {
    var d = doc();
    if (_outsideBound || !d || !d.addEventListener) return;
    _outsideBound = true;
    d.addEventListener('click', function (event) {
      var el = byId(SEAL);
      if (!el || !el.classList || !el.classList.contains('on')) return;
      var t = event.target;
      if (t === el || (el.contains && el.contains(t))) return;
      el.classList.remove('on');
    }, true);
  }

  function footHTML(id) {
    if (!id) return '';
    var repo = repoInfo();
    return (
      '<div class="bf-main">' + esc(id.lab) + ' · ' + SUB + '（' + REGION + '）</div>' +
      '<div class="bf-brand">© 2026 <b>' + esc(id.tag) + '</b> · 抖音 ' + esc(id.dy) + ' · 小红书 ' + esc(id.xhs) + ' · 仅供个人免费学习' + sig() + '</div>' +
      '<p class="bf-notes">本项目为开源学习工具，禁止未经许可的商业售卖；古诗文正文属公有领域经典作品，相关权利归原权利人所有，本项目仅提供学习工具与数据整理。</p>' +
      '<div class="bf-links">' +
        '<button class="btn btn-sm" type="button" data-brand="lic">版权与使用授权</button>' +
        '<span class="tip">禁止商用</span>' +
      '</div>' +
      (ver() ? '<div class="bf-ver">' + esc(ver()) + '</div>' : '') +
      (repo
        ? '<div class="bf-repo">GitHub 开源仓库：' +
          '<a href="' + esc(repo.url) + '" target="_blank" rel="noopener noreferrer">' + esc(repo.label) + '</a></div>'
        : '')
    );
  }

  function ensureNodes() {
    var d = doc();
    var b = body();
    if (!d || !b || !d.createElement) return;
    var id = ident();
    if (!id) return;

    if (!byId(SEAL)) {
      drop(SEAL);
      var seal = make('button', SEAL, 'brand-seal');
      b.appendChild(seal);
    }
    bindSeal(byId(SEAL));
    bindOutside();

    var foot = byId(FOOT) || d.getElementById(FOOT);
    if (!foot) {
      foot = make('footer', FOOT, 'brand-foot app-footer');
      b.appendChild(foot);
    } else {
      foot.setAttribute('data-brand-ref', FOOT);
      if (foot.className.indexOf('brand-foot') === -1) foot.className = 'brand-foot app-footer';
    }
    var html = footHTML(id);
    var repoUrl = repoInfo() ? repoInfo().url : '';
    if (
      foot.getAttribute('data-brand-ver') !== ver() ||
      foot.getAttribute('data-brand-n') !== id.n ||
      foot.getAttribute('data-brand-repo') !== repoUrl
    ) {
      foot.innerHTML = html;
      foot.setAttribute('data-brand-n', id.n);
      foot.setAttribute('data-brand-ver', ver());
      foot.setAttribute('data-brand-repo', repoUrl);
      if (foot.querySelector) {
        var lic = foot.querySelector('[data-brand="lic"]');
        if (lic && lic.addEventListener) {
          lic.addEventListener('click', function () {
            showLicense();
          });
        }
      }
    }
  }

  // 首页品牌小标签（视图重渲染后自动补回）
  function ensureChip() {
    var d = doc();
    if (!d || !d.querySelectorAll) return;
    var id = ident();
    if (!id) return;
    var hosts = d.querySelectorAll('[data-brand-chip]');
    for (var i = 0; i < hosts.length; i += 1) {
      var host = hosts[i];
      if (host.querySelector && host.querySelector('[data-brand-chip-item]')) continue;
      var chip = d.createElement('button');
      chip.type = 'button';
      chip.className = 'brand-chip';
      chip.setAttribute('data-brand', 'chip');
      chip.setAttribute('data-brand-chip-item', '1');
      chip.setAttribute('title', '点击查看版权与使用授权');
      chip.innerHTML = '✦ ' + esc(id.tag) + '<span class="dot">·</span>抖音 ' + esc(id.dy) + '<span class="dot">·</span>小红书 ' + esc(id.xhs);
      if (chip.addEventListener) chip.addEventListener('click', function () { showLicense(); });
      host.appendChild(chip);
    }
  }

  /* ================= 4) 复制与授权弹窗 ================= */

  function copyText(text) {
    var d = doc();
    if (!text) return false;
    try {
      if (W.navigator && W.navigator.clipboard && W.navigator.clipboard.writeText) {
        W.navigator.clipboard.writeText(text);
        return true;
      }
    } catch (err) {
      /* 回退到 textarea 方案 */
    }
    try {
      var ta = d.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', 'readonly');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      body().appendChild(ta);
      ta.select();
      d.execCommand('copy');
      body().removeChild(ta);
      return true;
    } catch (err2) {
      return false;
    }
  }

  function licenseHTML() {
    var id = ident() || { n: 'Hison', tag: 'Hison 制作', dy: '', xhs: '', lab: '' };
    return (
      '<h3>版权与使用授权</h3>' +
      '<p class="bs-sub">' + esc(id.lab) + ' · ' + SUB + '（' + REGION + '）</p>' +
      '<div class="bs-lic">' +
        '<p><b>作者：</b>' + esc(id.tag) + '　·　抖音 ' + esc(id.dy) + '　·　小红书 ' + esc(id.xhs) + '</p>' +
        '<p><b>允许：</b>个人免费自学使用；原样完整分享本文件（必须保留署名、水印与本授权说明）。</p>' +
        '<p><b>禁止：</b>任何商业用途——培训机构 / 补课班授课、付费课程与讲义、付费社群引流、二次售卖；也禁止删除或篡改署名、水印后再分发。</p>' +
        '<p><b>转载：</b>请保留本页署名与水印；讲义、笔记、课件中引用题库或背诵方法时，请注明出处为作者账号。</p>' +
        '<p><b>免责：</b>本工具仅作学习辅助，题库文本、作者、朝代、篇目归属与答案仅供参考，不构成提分或考试承诺；古诗文正文属公有领域经典作品，如发现错漏欢迎通过上述账号联系作者指正。</p>' +
      '</div>' +
      '<div class="bs-actions">' +
        '<button class="btn btn-primary btn-sm" type="button" data-brand="ok">我已知晓</button>' +
        '<button class="btn btn-sm" type="button" data-brand="copy">复制授权说明</button>' +
      '</div>'
    );
  }

  function licenseText() {
    var id = ident() || { n: 'Hison', tag: 'Hison 制作', dy: '', xhs: '', lab: '' };
    return (
      id.lab + ' · ' + SUB + '（' + REGION + '）\n' +
      '作者：' + id.tag + '　抖音：' + id.dy + '　小红书：' + id.xhs + '\n' +
      '本作品仅供个人免费自学使用，禁止任何商业用途（培训授课、付费课程与讲义、付费社群、二次售卖）；\n' +
      '允许原样完整分享本文件，但必须保留署名、水印与本授权说明；转载请注明出处为作者账号。\n' +
      '免责：本工具仅作学习辅助，题库内容仅供参考，不构成提分或考试承诺；古诗文正文属公有领域作品。'
    );
  }

  function showLicense() {
    var d = doc();
    if (!d || !d.createElement || !body()) return null;
    var old = d.getElementById ? d.getElementById('brandLicense') : null;
    if (old && old.parentNode) old.parentNode.removeChild(old);

    var ov = d.createElement('div');
    ov.id = 'brandLicense';
    ov.className = 'brand-overlay';
    ov.setAttribute('data-brand-ref', 'brandLicense');
    ov.innerHTML = '<div class="brand-sheet" role="dialog" aria-modal="true">' + licenseHTML() + '</div>';

    function close() {
      if (ov.parentNode) ov.parentNode.removeChild(ov);
      if (d.removeEventListener) d.removeEventListener('keydown', onKey);
    }
    function onKey(event) {
      if (event.key === 'Escape') close();
    }
    ov.addEventListener('click', function (event) {
      var t = event.target;
      if (t === ov) {
        close();
        return;
      }
      var a = t.getAttribute ? t.getAttribute('data-brand') : null;
      if (a === 'ok') {
        close();
      } else if (a === 'copy') {
        if (copyText(licenseText())) t.textContent = '已复制';
      }
    });
    if (d.addEventListener) d.addEventListener('keydown', onKey);
    body().appendChild(ov);
    return ov;
  }

  // 首次访问自动提示一次（署名与授权告知）
  function firstVisit() {
    var seen = null;
    try {
      seen = W.localStorage ? W.localStorage.getItem(NOTICE_KEY) : null;
    } catch (err) {
      seen = '1'; // 隐私模式下不打扰
    }
    if (seen) return;
    try {
      if (W.localStorage) W.localStorage.setItem(NOTICE_KEY, '1');
    } catch (err2) {
      /* 忽略 */
    }
    if (typeof W.setTimeout !== 'function') return;
    W.setTimeout(function () {
      try {
        showLicense();
      } catch (err3) {
        /* 忽略 */
      }
    }, 800);
  }

  /* ================= 5) 自愈守护 ================= */
  var _timer = null;
  function startGuard() {
    if (_timer || typeof W.setInterval !== 'function') return;
    _timer = W.setInterval(function () {
      try {
        injectCSS();
        ensureNodes();
        ensureChip();
      } catch (err) {
        /* 忽略 */
      }
    }, 2000);
  }

  /* ================= 6) 对外 API ================= */
  function install() {
    if (!ident()) {
      try {
        console.warn('[brand] 作者品牌模块校验异常');
      } catch (err) {
        /* 忽略 */
      }
      return false;
    }
    try { injectCSS(); } catch (e1) { /* 忽略 */ }
    try { ensureNodes(); } catch (e2) { /* 忽略 */ }
    try { ensureChip(); } catch (e3) { /* 忽略 */ }
    try { startGuard(); } catch (e4) { /* 忽略 */ }
    try { firstVisit(); } catch (e5) { /* 忽略 */ }
    return true;
  }

  W.PoetryBrand = {
    version: 1,
    ok: function () {
      return !!ident();
    },
    install: install,
    refresh: function () {
      if (!ident()) return false;
      try { ensureNodes(); } catch (e) { /* 忽略 */ }
      try { ensureChip(); } catch (e) { /* 忽略 */ }
      return true;
    },
    mark: mark,
    inspect: inspect,
    signature: function () {
      return sig();
    },
    identity: function () {
      var id = ident();
      return id ? { name: id.n, tag: id.tag, douyin: id.dy, xhs: id.xhs, lab: id.lab } : null;
    },
    stamp: function () {
      var id = ident();
      if (!id) return null;
      return { tool: id.lab, author: id.n, tag: id.tag, douyin: id.dy, xhs: id.xhs, sig: sig() };
    },
    sub: SUB,
    region: REGION,
    repoUrl: function () {
      var repo = repoInfo();
      return repo ? repo.url : '';
    },
    copy: copyText,
    showLicense: showLicense,
    licenseText: licenseText,
  };
})(window);
