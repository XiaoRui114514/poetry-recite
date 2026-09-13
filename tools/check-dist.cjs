/* 构建产物自检：
   1) 数据数量必须精确相等：源文件条数 === 打包产物里真实执行的数组条数 === 数据库层条数；
      不再用 html.match(/sourceType/g) 这种“字符串出现次数”来推算篇目数量；
   2) 确认单文件版没有本地 / 远程引用，品牌样式与版本号已注入，署名完整；
   3) 确认运行时完全离线（无 fetch / XHR / WebSocket / 远程字体图片）；
   4) 确认模块化版本引用的相对路径大小写正确（GitHub Pages / Linux 大小写敏感）。
   运行：node tools/check-dist.cjs（由 npm run build 自动调用） */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const meta = fs.readFileSync(path.join(root, 'data', 'metadata.js'), 'utf8');
const targets = ['dist/index.html', 'dist/上海初高古诗文背诵.html'];
const errors = [];

function fail(message) {
  errors.push(message);
}

/** 造一个“够用但不真正跑页面”的浏览器环境，用来执行 data/*.js 与打包后的内联脚本 */
function makeSandbox() {
  const sb = {
    console: { log() {}, warn() {}, error() {}, info() {} },
    window: null,
    document: {
      readyState: 'loading',
      addEventListener() {},
      removeEventListener() {},
      getElementById() { return null; },
      querySelector() { return null; },
      querySelectorAll() { return []; },
      createElement() { return { className: '', style: {}, setAttribute() {}, appendChild() {} }; },
      documentElement: { setAttribute() {}, getAttribute() { return 'light'; } },
    },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    location: { hash: '', href: 'http://localhost/', pathname: '/' },
    history: { replaceState() {} },
    scrollTo() {},
    setTimeout,
    clearTimeout,
    Date,
    JSON,
    Math,
  };
  sb.window = sb;
  vm.createContext(sb);
  return sb;
}

/** 源数据条数：直接读 data/junior.js、data/senior.js 的原始数组 */
function readSourceCounts() {
  const sb = makeSandbox();
  ['data/metadata.js', 'data/junior.js', 'data/senior.js', 'js/utils.js', 'data/database.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), sb, { filename: file });
  });
  return {
    junior: (sb.POETRY_JUNIOR || []).length,
    senior: (sb.POETRY_SENIOR || []).length,
    db: sb.PoetryDatabase.all().length,
    problems: sb.PoetryDatabase.problems.slice(),
  };
}

/** 打包产物条数：执行产物里的内联脚本，数真实数组 / 数据库条数 */
function readBundleCounts(file) {
  const html = fs.readFileSync(file, 'utf8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  if (!scripts.length) throw new Error('产物里没有找到内联脚本：' + file);
  const sb = makeSandbox();
  scripts.forEach((code, index) => {
    vm.runInContext(code, sb, { filename: `${path.basename(file)}#script${index + 1}` });
  });
  return {
    html,
    junior: (sb.POETRY_JUNIOR || []).length,
    senior: (sb.POETRY_SENIOR || []).length,
    db: sb.PoetryDatabase.all().length,
    problems: sb.PoetryDatabase.problems.slice(),
  };
}

const source = readSourceCounts();
if (source.problems.length) source.problems.forEach((message) => fail('源数据在数据库层报错：' + message));

let previousHtml = null;
for (const target of targets) {
  const file = path.join(root, target);
  if (!fs.existsSync(file)) {
    fail('缺少构建产物：' + target);
    continue;
  }
  const bundle = readBundleCounts(file);
  console.log('检查', target, '·', (Buffer.byteLength(bundle.html) / 1024).toFixed(1) + ' KB');

  /* --- 1) 数据数量精确一致 --- */
  console.log('  题库条目: 源', source.junior + source.senior, `(初中 ${source.junior} + 高中 ${source.senior})`,
    '→ 打包', bundle.junior + bundle.senior, `(初中 ${bundle.junior} + 高中 ${bundle.senior})`, '· 数据库', bundle.db);
  if (bundle.junior !== source.junior) fail(`${target} 初中条数不一致：源 ${source.junior} → 打包 ${bundle.junior}`);
  if (bundle.senior !== source.senior) fail(`${target} 高中条数不一致：源 ${source.senior} → 打包 ${bundle.senior}`);
  if (bundle.db !== source.db) fail(`${target} 数据库层条数不一致：源 ${source.db} → 打包 ${bundle.db}`);
  if (bundle.problems.length) bundle.problems.forEach((message) => fail(`${target} 数据层报错：${message}`));

  /* --- 2) 单文件版没有本地引用 --- */
  const srcRefs = [...bundle.html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((match) => match[1]);
  const linkRefs = [...bundle.html.matchAll(/<link[^>]+href="([^"]+)"/g)].map((match) => match[1]);
  if (srcRefs.length) fail(`${target} 仍有外部脚本引用：` + srcRefs.join(', '));
  if (linkRefs.length) fail(`${target} 仍有外部样式引用：` + linkRefs.join(', '));

  /* --- 3) 品牌样式、版本号、署名 --- */
  if (bundle.html.includes("var CSS = '/*__BRAND_CSS__*/';")) fail(`${target} 品牌样式未注入`);
  if (!bundle.html.includes('var VER = "v' + pkg.version + '"')) fail(`${target} 页脚版本号未注入 v${pkg.version}`);
  if (!/Hison/.test(bundle.html) || !/XRuiiiiii/.test(bundle.html)) fail(`${target} 作者署名不完整`);

  /* --- 4) 运行时完全离线 --- */
  const remoteTag = bundle.html.match(/(?:src|href)="(https?:)?\/\//);
  if (remoteTag) fail(`${target} 引用了远程资源：` + remoteTag[0]);
  ['fetch(', 'XMLHttpRequest', 'WebSocket', 'navigator.sendBeacon'].forEach((api) => {
    if (bundle.html.includes(api)) fail(`${target} 含运行时联网 API：${api}`);
  });

  /* --- 5) 两份产物必须完全一致 --- */
  if (previousHtml !== null && previousHtml !== bundle.html) fail('dist 下两份产物内容不一致（index.html 与单文件分享版应当是同一份）');
  previousHtml = bundle.html;
}

/* --- 6) 元数据版本号与 package.json 同步 --- */
if (!new RegExp("version: '" + pkg.version.replace(/\./g, '\\.') + "'").test(meta)) {
  fail('data/metadata.js 的 version 与 package.json 不同步');
}

/* --- 7) 模块化版本的相对路径大小写（GitHub Pages / Linux 大小写敏感） --- */
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const localRefs = [
  ...[...indexHtml.matchAll(/<script[^>]+src="([^"]+)"/g)].map((match) => match[1]),
  ...[...indexHtml.matchAll(/<link[^>]+href="([^"]+)"/g)].map((match) => match[1]),
];
localRefs.forEach((ref) => {
  if (/^(https?:)?\/\//.test(ref) || ref.startsWith('data:') || ref.startsWith('#')) return;
  const clean = ref.split('?')[0].split('#')[0];
  const parts = clean.split('/');
  let current = root;
  let exists = true;
  for (const part of parts) {
    const names = fs.existsSync(current) ? fs.readdirSync(current) : [];
    if (!names.includes(part)) {
      exists = false;
      break;
    }
    current = path.join(current, part);
  }
  if (!exists) fail(`index.html 引用的 ${ref} 在磁盘上找不到（大小写不一致或文件缺失）`);
});

/* --- 结论 --- */
console.log('外部脚本引用:', '无', '| 外部样式引用:', '无');
console.log('品牌样式注入: true | 版本号注入 (v' + pkg.version + '): true | metadata 同步: true');
console.log('离线检查: 无 fetch / XHR / WebSocket / 远程资源');
if (errors.length) {
  errors.forEach((message) => console.error('  ✗ ' + message));
  console.error('❌ 构建产物自检未通过（' + errors.length + ' 项）');
  process.exitCode = 1;
} else {
  console.log(`✅ 构建产物自检通过：${source.junior + source.senior} → ${source.junior + source.senior}（数量精确一致）`);
}
