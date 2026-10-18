/* 单文件打包：把 index.html + CSS + 数据 + 逻辑合成一个可直接双击打开的 HTML。
   运行：node build.js
   产物：dist/index.html（GitHub Pages 可直接部署）与 dist/上海初高古诗文背诵.html（单文件分享版）
   同时把 assets/styles.css 的品牌样式片段与 package.json 的版本号注入 js/brand.js。
   零依赖，不需要安装任何 npm 包。 */
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const distDir = path.join(root, 'dist');

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8');
}

/** 把品牌样式与版本号注入 js/brand.js（单一来源：styles.css + package.json） */
function buildBrandModule() {
  const marker = '/* __BRAND_CSS__ */';
  const css = read('assets/styles.css');
  const markerIndex = css.indexOf(marker);
  if (markerIndex === -1) throw new Error('styles.css 中找不到品牌样式标记 ' + marker);
  const brandCss = css.slice(markerIndex + marker.length).trim();

  const pkg = JSON.parse(read('package.json'));
  let code = read('js/brand.js');
  const cssSlot = "var CSS = '/*__BRAND_CSS__*/';";
  const verSlot = "var VER = '__RSYY_VER__';";
  if (code.indexOf(cssSlot) === -1 || code.indexOf(verSlot) === -1) {
    throw new Error('js/brand.js 中的品牌占位符缺失，无法注入样式 / 版本号');
  }
  code = code.replace(cssSlot, 'var CSS = ' + JSON.stringify(brandCss) + ';');
  code = code.replace(verSlot, 'var VER = ' + JSON.stringify('v' + pkg.version) + ';');
  return code;
}

let html = read('index.html');

// 0) PWA manifest 只属于模块化版本；单文件版没有 sw.js / manifest 文件，去掉引用避免 404
html = html.replace(/[ \t]*<link rel="manifest"[^>]*>\r?\n?/g, '');

// 1) 内联 CSS
const css = read('assets/styles.css');
html = html.replace(/[ \t]*<link rel="stylesheet" href="assets\/styles\.css">\r?\n?/, () => {
  return `  <style>\n${css.trim()}\n  </style>\n`;
});

// 2) 按顺序内联脚本
const scriptSrcs = [...html.matchAll(/[ \t]*<script src="([^"]+)"><\/script>\r?\n?/g)].map((m) => m[1]);
if (!scriptSrcs.length) throw new Error('没有找到需要内联的脚本');

const scripts = scriptSrcs.map((src) => {
  const code = src === 'js/brand.js' ? buildBrandModule() : read(src);
  return `/* ===== ${src} ===== */\n${code.trim()}`;
});
html = html.replace(/[ \t]*<script src="[^"]+"><\/script>\r?\n?/g, '');
html = html.replace(/[ \t]*<\/body>/, () => {
  return `  <script>\n${scripts.join('\n\n')}\n  </script>\n</body>`;
});

// 3) 检查是否还有外部引用
// 只检查真正的资源标签（script / link / img / iframe / source / video / audio），
// 不能把内联脚本里的字符串（例如品牌层生成的 <a href="…"> 外链）也算进来。
const leftovers = [...html.matchAll(/<(?:script|link|img|iframe|source|video|audio)[^>]+?(?:src|href)="((?!https?:|#|data:)[^"]+)"/g)].map((m) => m[1]);
if (leftovers.length) {
  throw new Error('单文件版仍然引用了本地文件：' + leftovers.join(', '));
}

fs.mkdirSync(distDir, { recursive: true });
const banner = `<!-- 古诗文背诵学习系统 · 单文件版（由 build.js 生成，请勿直接编辑） -->\n`;
const outHtml = banner + html;

const targets = ['index.html', '上海初高古诗文背诵.html'];
for (const name of targets) {
  const file = path.join(distDir, name);
  fs.writeFileSync(file, outHtml, 'utf8');
  process.stdout.write(`  ✓ ${path.relative(root, file)}  ${(Buffer.byteLength(outHtml) / 1024).toFixed(1)} KB\n`);
}

process.stdout.write(`单文件打包完成：共内联 ${scriptSrcs.length} 个脚本，${css.length} 字节样式\n`);
