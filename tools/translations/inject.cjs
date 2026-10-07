/* 把 data/translations/poems 的逐句翻译写回 data/junior.js、data/senior.js（维护工具）
   运行：node tools/translations/inject.cjs [--out-dir <目录>] [--dry] [--check]

   思路：扫描 JS 源码（跳过字符串 / 模板串 / 注释）定位每个篇目对象的起止，
   在对象自己的 `}` 之前插入 `,\n      translation: [...]`；只在源码上做切片，
   其它字节一律不动，所以产生的格式和手工编写完全一致。

   脚本可反复执行：每次先删掉已有的 translation 字段，结果幂等。
   写盘前会用 vm 真正执行一遍产物：语法错、条数不对、译文数与句数不一致都不会写文件。 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..', '..');
const args = process.argv.slice(2);
const outDir = args.includes('--out-dir')
  ? path.resolve(args[args.indexOf('--out-dir') + 1])
  : path.join(root, 'data', 'translations', 'poems');
const dry = args.includes('--dry');
const checkOnly = args.includes('--check');

const FIELD = 'translation';

/* ---------- 1. 读取翻译 ---------- */
const trans = new Map();
for (const file of fs.readdirSync(outDir).filter((f) => /^batch-\d+\.json$/.test(f)).sort()) {
  const data = JSON.parse(fs.readFileSync(path.join(outDir, file), 'utf8'));
  for (const poem of data.poems || []) trans.set(poem.id, poem.translations);
}

/* ---------- 2. 源码扫描 ---------- */

/** 从 open（必须是 { [ ( 之一）出发，返回配对括号的下标；字符串 / 模板串 / 注释整体跳过。
    用「期望的收尾括号栈」而不是单一 depth，这样 { } 与 [ ] 混排也不会错配。 */
function matchBracket(src, open) {
  const opener = src[open];
  const PAIR = { '{': '}', '[': ']', '(': ')' };
  const CLOSER = { '}': '{', ']': '[', ')': '(' };
  if (!PAIR[opener]) return -1;
  const stack = [PAIR[opener]];
  let i = open + 1;
  const n = src.length;
  while (i < n) {
    const ch = src[i];
    const next = src[i + 1];
    if (ch === "'" || ch === '"' || ch === '`') {
      i += 1;
      while (i < n) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === ch) { i += 1; break; }
        i += 1;
      }
      continue;
    }
    if (ch === '/' && next === '/') { while (i < n && src[i] !== '\n') i += 1; continue; }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    if (PAIR[ch]) {
      stack.push(PAIR[ch]);
      i += 1;
      continue;
    }
    if (CLOSER[ch]) {
      const want = stack[stack.length - 1];
      if (ch !== want) return -1; // 不配对
      stack.pop();
      if (!stack.length) return i;
      i += 1;
      continue;
    }
    i += 1;
  }
  return -1;
}

/** 从 idx 往前吃掉空白与一个可选逗号，再吃掉逗号前的行内空白，返回新的起点 */
function backOverSeparator(src, idx) {
  let i = idx;
  while (i > 0 && (src[i - 1] === ' ' || src[i - 1] === '\t' || src[i - 1] === '\n' || src[i - 1] === '\r')) i -= 1;
  if (i > 0 && src[i - 1] === ',') {
    i -= 1;
    while (i > 0 && (src[i - 1] === ' ' || src[i - 1] === '\t')) i -= 1;
  }
  return i;
}

/**
 * 扫描题库源码，返回每个顶层数组元素对象：{ id, objStart, objEnd }。
 * 逐个 `{` 做括号配对，只收集“最外层的那一批对象”（题库数组的元素），
 * 因此嵌套的 highlights / variants 对象不会被误当成篇目。
 */
function scanPoems(src) {
  const candidates = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const ch = src[i];
    const next = src[i + 1];
    if (ch === "'" || ch === '"' || ch === '`') {
      i += 1;
      while (i < n) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === ch) { i += 1; break; }
        i += 1;
      }
      continue;
    }
    if (ch === '/' && next === '/') { while (i < n && src[i] !== '\n') i += 1; continue; }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    if (ch === '{') {
      const head = src.slice(i, i + 120);
      const m = /^\{\s*id:\s*'([a-z0-9-]+)'\s*,\s*title:/.exec(head);
      if (m) {
        const objEnd = matchBracket(src, i);
        if (objEnd === -1) throw new Error(`括号不配对：${m[1]}`);
        candidates.push({ id: m[1], objStart: i, objEnd });
        i = objEnd + 1;
        continue;
      }
    }
    i += 1;
  }
  // 只保留“没有别的候选对象包含它”的那些 = 最外层（题库数组元素）
  return candidates.filter((a) => !candidates.some((b) => b !== a && b.objStart < a.objStart && b.objEnd > a.objEnd));
}

/**
 * 剥掉已经存在的 translation 字段，返回 { code, removed }。
 * 字段范围 = 上一个字段的分隔逗号 … 对象自己的 `}` 之前（`}` 本身保留）。
 */
function stripTranslation(src) {
  const poems = scanPoems(src);
  const ranges = [];
  for (const poem of poems) {
    const body = src.slice(poem.objStart, poem.objEnd + 1);
    const at = body.indexOf(FIELD + ':');
    if (at === -1) continue;
    ranges.push({ start: backOverSeparator(src, poem.objStart + at), end: poem.objEnd });
  }
  let code = src;
  ranges.sort((a, b) => b.start - a.start);
  for (const range of ranges) code = code.slice(0, range.start) + code.slice(range.end);
  return { code, removed: ranges.length };
}

/* ---------- 3. 校验并注入 ---------- */
function inject(file, arrayName) {
  const filePath = path.join(root, file);
  const { code: cleaned } = stripTranslation(fs.readFileSync(filePath, 'utf8'));
  const poems = scanPoems(cleaned);
  const byId = new Map(poems.map((poem) => [poem.id, poem]));

  const sb = { console, window: null };
  sb.window = sb;
  vm.createContext(sb);
  for (const f of ['data/metadata.js', 'data/junior.js', 'data/senior.js', 'js/utils.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), sb, { filename: f });
  }
  const list = sb[arrayName];
  const U = sb.PoetryUtils;

  const edits = [];
  const problems = [];
  for (const poem of list) {
    const lines = trans.get(poem.id);
    const sentences = U.splitSentences(poem.text);
    if (!lines) { problems.push(`${poem.id}: 没有翻译`); continue; }
    if (lines.length !== sentences.length) {
      problems.push(`${poem.id}: 译文 ${lines.length} 条 ≠ 原文 ${sentences.length} 句`);
      continue;
    }
    lines.forEach((line, index) => {
      if (typeof line !== 'string' || !line.trim()) problems.push(`${poem.id}[${index}]: 空译文`);
      if (/['\\\r\n]/.test(line)) problems.push(`${poem.id}[${index}]: 含需要转义的字符`);
    });
    const target = byId.get(poem.id);
    if (!target) { problems.push(`${poem.id}: 在 ${file} 中找不到对象`); continue; }
    edits.push({ id: poem.id, end: target.objEnd, lines });
  }
  if (problems.length) {
    problems.slice(0, 20).forEach((m) => console.log('  ✗ ' + m));
    throw new Error(`${file} 有 ${problems.length} 处问题，未写入`);
  }

  // 从后往前插入，保证前面的下标不失效。
  // edit.end 指向对象自己的 `}`，它仍在 slice(edit.end) 里，所以插入内容不补 `}`。
  edits.sort((a, b) => b.end - a.end);
  let out = cleaned;
  for (const edit of edits) {
    const lines = [','];
    lines.push('      ' + FIELD + ': [');
    edit.lines.forEach((line) => lines.push("        '" + line + "',"));
    lines.push('      ] ');
    out = out.slice(0, edit.end) + lines.join('\n') + out.slice(edit.end);
  }

  // 写盘前必须确认产物是能跑的 JS：语法错 / 条数不对都不允许写文件
  const verifySandbox = { console, window: null };
  verifySandbox.window = verifySandbox;
  vm.createContext(verifySandbox);
  for (const f of ['data/metadata.js', 'js/utils.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), verifySandbox, { filename: f });
  }
  vm.runInContext(out, verifySandbox, { filename: file });
  const after = verifySandbox[arrayName];
  if (!Array.isArray(after) || after.length !== list.length) {
    throw new Error(`${file} 注入后条数异常（${after ? after.length : 'n/a'} ≠ ${list.length}），未写入`);
  }
  for (const poem of after) {
    if (!Array.isArray(poem.translation) || poem.translation.length !== U.splitSentences(poem.text).length) {
      throw new Error(`${file} 注入后 ${poem.id} 译文数与句数不一致，未写入`);
    }
  }

  if (checkOnly) {
    console.log(`  · ${file}: ${edits.length} 篇可注入（--check，未写入）`);
    return;
  }
  if (dry) {
    console.log(`  · ${file}: ${edits.length} 篇（--dry）`);
    return;
  }
  fs.writeFileSync(filePath, out, 'utf8');
  console.log(`  ✓ ${file}: 注入 ${edits.length} 篇，${(out.length / 1024).toFixed(1)} KB`);
}

inject('data/junior.js', 'POETRY_JUNIOR');
inject('data/senior.js', 'POETRY_SENIOR');
