/* 把 meta/ 下的「考试重点 + 中心思想」元数据写回 data/junior.js、data/senior.js（维护工具）
   运行：node tools/meta/inject-meta.cjs [--dir <目录>] [--dry] [--check]

   数据流：
     tools/meta/export.cjs  →  meta/poems.json      （只读导出：id / 篇名 / 每句原文，
                                                     供人工或 AI 逐篇填写 summary 与 examFocus）
     meta/poems.json        →  data/*.js 的 summary 与 examFocus 字段

   与 tools/translations/inject.cjs 同一套思路：扫描 JS 源码定位篇目对象，
   只在源码上做切片，其它字节一律不动；每次先剥掉已有字段，因此可反复执行（幂等）。
   写盘前会用 vm 真正执行一遍产物：语法错、篇数不对、下标越界都不会写文件。 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..', '..');
const args = process.argv.slice(2);
const dataDir = args.includes('--dir')
  ? path.resolve(args[args.indexOf('--dir') + 1])
  : path.join(root, 'meta');
const dry = args.includes('--dry');
const checkOnly = args.includes('--check');
const allowEmpty = args.includes('--allow-empty');

/* ---------- 1. 读取元数据 ---------- */
const meta = new Map();
const metaFile = path.join(dataDir, 'poems.json');
if (!fs.existsSync(metaFile)) throw new Error('找不到元数据文件：' + metaFile);
const raw = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
const entries = Array.isArray(raw) ? raw : raw.poems;
if (!Array.isArray(entries)) throw new Error('meta/poems.json 必须是数组，或 { poems: [...] }');
for (const entry of entries) {
  if (!entry || typeof entry.id !== 'string' || !entry.id.trim()) throw new Error('元数据里有缺少 id 的条目');
  if (meta.has(entry.id)) throw new Error('元数据里 id 重复：' + entry.id);
  meta.set(entry.id, entry);
}

/* ---------- 2. 源码扫描（与 translations/inject.cjs 同一套） ---------- */

/** 从 open 出发返回配对括号下标；字符串 / 模板串 / 注释整体跳过，括号分类型配对 */
function matchBracket(src, open) {
  const PAIR = { '{': '}', '[': ']', '(': ')' };
  const CLOSER = { '}': '{', ']': '[', ')': '(' };
  if (!PAIR[src[open]]) return -1;
  const stack = [PAIR[src[open]]];
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
    if (PAIR[ch]) { stack.push(PAIR[ch]); i += 1; continue; }
    if (CLOSER[ch]) {
      if (ch !== stack[stack.length - 1]) return -1;
      stack.pop();
      if (!stack.length) return i;
      i += 1;
      continue;
    }
    i += 1;
  }
  return -1;
}

/** 找出题库数组里的篇目对象：{ id, objStart, objEnd }（只保留最外层的那一批） */
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
      const m = /^\{(?:\s*\/\*[\s\S]*?\*\/)?\s*id:\s*'([a-z0-9-]+)'\s*,\s*title:/.exec(src.slice(i, i + 200));
      if (m) {
        const objEnd = matchBracket(src, i);
        if (objEnd === -1) throw new Error('括号不配对：' + m[1]);
        candidates.push({ id: m[1], objStart: i, objEnd });
        i = objEnd + 1;
        continue;
      }
    }
    i += 1;
  }
  return candidates.filter((a) => !candidates.some((b) => b !== a && b.objStart < a.objStart && b.objEnd > a.objEnd));
}

/** 从 idx 往前吃掉空白与一个可选逗号（含逗号前的行内空白） */
function backOverSeparator(src, idx) {
  let i = idx;
  while (i > 0 && (src[i - 1] === ' ' || src[i - 1] === '\t' || src[i - 1] === '\n' || src[i - 1] === '\r')) i -= 1;
  if (i > 0 && src[i - 1] === ',') {
    i -= 1;
    while (i > 0 && (src[i - 1] === ' ' || src[i - 1] === '\t')) i -= 1;
  }
  return i;
}

/** 剥掉对象里的某个字段（含前面的分隔逗号），返回新源码 */
function stripField(src, field) {
  const poems = scanPoems(src);
  const ranges = [];
  for (const poem of poems) {
    const body = src.slice(poem.objStart, poem.objEnd + 1);
    const at = body.indexOf(field + ':');
    if (at === -1) continue;
    // 字段值到对象结尾（这两个字段都写在对象最后）
    ranges.push({ start: backOverSeparator(src, poem.objStart + at), end: poem.objEnd });
  }
  let code = src;
  ranges.sort((a, b) => b.start - a.start);
  for (const range of ranges) code = code.slice(0, range.start) + code.slice(range.end);
  return code;
}

/** 生成与文件现有风格一致的字符串字面量（单引号，转义反斜杠与单引号） */
function quote(text) {
  return "'" + String(text).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
}

/* ---------- 3. 校验并注入 ---------- */
function inject(file, arrayName) {
  const filePath = path.join(root, file);
  let cleaned = fs.readFileSync(filePath, 'utf8');
  cleaned = stripField(cleaned, 'summary');
  cleaned = stripField(cleaned, 'examFocus');
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
    const entry = meta.get(poem.id);
    if (!entry) { problems.push(`${poem.id}: 元数据里缺少这一篇`); continue; }
    const sentences = U.splitSentences(poem.text);
    const total = sentences.length;

    const summary = String(entry.summary || '').trim();
    const focus = Array.isArray(entry.examFocus) ? entry.examFocus : [];
    // --allow-empty：只给已填写的篇目注入（用于分批维护 / 局部验证）
    if (!summary && !focus.length) {
      if (allowEmpty) continue;
      problems.push(`${poem.id}: 缺少 summary 与 examFocus`);
      continue;
    }
    if (!summary) problems.push(`${poem.id}: 缺少 summary`);
    if (/[\r\n]/.test(summary)) problems.push(`${poem.id}: summary 含换行`);
    if (/['\\]/.test(summary)) problems.push(`${poem.id}: summary 含需要转义的字符`);
    if (/[★☆]/.test(summary)) problems.push(`${poem.id}: summary 含星标符号`);
    if (summary.length > 120) problems.push(`${poem.id}: summary 过长（${summary.length} 字）`);

    if (!focus.length) problems.push(`${poem.id}: examFocus 为空（每一篇都应至少标 1 句重点）`);
    const seen = new Set();
    focus.forEach((item, i) => {
      if (!item || typeof item.index !== 'number' || !Number.isInteger(item.index)) {
        problems.push(`${poem.id}: examFocus[${i}] 缺少整数 index`);
        return;
      }
      if (item.index < 0 || item.index >= total) {
        problems.push(`${poem.id}: examFocus[${i}] index=${item.index} 越界（正文共 ${total} 句）`);
      }
      if (seen.has(item.index)) problems.push(`${poem.id}: examFocus 里 index=${item.index} 重复`);
      seen.add(item.index);
      const reason = String(item.reason || '').trim();
      if (!reason) problems.push(`${poem.id}: examFocus[${item.index}] 缺少 reason`);
      if (/[\r\n]/.test(reason)) problems.push(`${poem.id}: examFocus[${item.index}] reason 含换行`);
      if (/['\\]/.test(reason)) problems.push(`${poem.id}: examFocus[${item.index}] reason 含需要转义的字符`);
    });

    const target = byId.get(poem.id);
    if (!target) { problems.push(`${poem.id}: 在 ${file} 中找不到对象`); continue; }
    edits.push({
      id: poem.id,
      end: target.objEnd,
      summary: summary,
      focus: focus
        .slice()
        .sort((a, b) => a.index - b.index)
        .map((item) => ({ index: item.index, reason: String(item.reason).trim() })),
    });
  }
  if (problems.length) {
    problems.slice(0, 25).forEach((m) => console.log('  ✗ ' + m));
    throw new Error(`${file} 有 ${problems.length} 处问题，未写入`);
  }

  // 从后往前插入；edit.end 指向对象自己的 `}`，它仍在 slice(edit.end) 里，所以不补 `}`
  edits.sort((a, b) => b.end - a.end);
  let out = cleaned;
  for (const edit of edits) {
    const lines = [];
    const hasFocus = edit.focus.length > 0;
    lines.push('      summary: ' + quote(edit.summary) + (hasFocus ? ',' : ''));
    if (hasFocus) {
      lines.push('      examFocus: [');
      edit.focus.forEach((item) => {
        lines.push('        { index: ' + item.index + ', reason: ' + quote(item.reason) + ' },');
      });
      lines.push('      ] ');
    }
    out = out.slice(0, edit.end) + ',\n' + lines.join('\n') + out.slice(edit.end);
  }

  // 写盘前用 vm 真跑一遍：语法错 / 篇数不对 / 字段缺失 / 下标越界都不写文件
  const verify = { console, window: null };
  verify.window = verify;
  vm.createContext(verify);
  for (const f of ['data/metadata.js', 'js/utils.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), verify, { filename: f });
  }
  vm.runInContext(out, verify, { filename: file });
  const after = verify[arrayName];
  if (!Array.isArray(after) || after.length !== list.length) {
    throw new Error(`${file} 注入后条数异常（${after ? after.length : 'n/a'} ≠ ${list.length}），未写入`);
  }
  let focusTotal = 0;
  for (const poem of after) {
    const total = U.splitSentences(poem.text).length;
    if (poem.summary === undefined || poem.examFocus === undefined) continue;
    if (typeof poem.summary !== 'string' || !poem.summary.trim()) {
      throw new Error(`${file} 注入后 ${poem.id} summary 为空，未写入`);
    }
    if (!Array.isArray(poem.examFocus) || !poem.examFocus.length) {
      throw new Error(`${file} 注入后 ${poem.id} examFocus 为空，未写入`);
    }
    poem.examFocus.forEach((item) => {
      if (!Number.isInteger(item.index) || item.index < 0 || item.index >= total) {
        throw new Error(`${file} 注入后 ${poem.id} examFocus 下标越界，未写入`);
      }
      focusTotal += 1;
    });
  }

  if (checkOnly) {
    console.log(`  · ${file}: ${edits.length} 篇可注入，共 ${focusTotal} 个重点标记（--check，未写入）`);
    return;
  }
  if (dry) {
    console.log(`  · ${file}: ${edits.length} 篇，共 ${focusTotal} 个重点标记（--dry）`);
    return;
  }
  fs.writeFileSync(filePath, out, 'utf8');
  console.log(`  ✓ ${file}: ${edits.length} 篇 / ${focusTotal} 个重点标记，${(out.length / 1024).toFixed(1)} KB`);
}

inject('data/junior.js', 'POETRY_JUNIOR');
inject('data/senior.js', 'POETRY_SENIOR');
