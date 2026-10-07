/* 题库体检（原始数据层 + 数据库层 + 文档一致性）
   运行：node tools/qa-data.cjs

   与第一轮的区别：
   1) 直接在 data/junior.js、data/senior.js 的【原始数组】上检查字段与重复，
      不依赖 database.normalize()（normalize 会自动改名 / 补默认值，会掩盖原始错误）；
   2) 重复篇目分级：ERROR = 标题+作者+学段+正文完全相同；WARN = 同名同作者但正文不同；
   3) 有 ERROR 时以非 0 退出码结束，可被 npm test / CI 捕获，不再“只打印不失败”。 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const sb = { console, window: null };
sb.window = sb;
vm.createContext(sb);
for (const f of ['data/metadata.js', 'data/junior.js', 'data/senior.js', 'js/utils.js', 'data/database.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), sb, { filename: f });
}

const meta = sb.PoetryMeta;
const DB = sb.PoetryDatabase;
const errors = [];
const warns = [];

function fail(message) {
  errors.push(message);
}
function caution(message) {
  warns.push(message);
}

/* ---------------- 1. 原始数据层字段检查 ---------------- */

const ALLOWED_FIELDS = ['id', 'title', 'author', 'dynasty', 'stage', 'grade', 'grades', 'genre', 'sourceType', 'required', 'recommended', 'text', 'translation', 'summary', 'examFocus', 'source', 'highlights', 'tags', 'notes', 'variants'];
const TEXT_FIELDS = ['title', 'text', 'author', 'dynasty', 'stage', 'grade', 'genre', 'sourceType', 'source'];
const isPlainObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
const norm = (text) => String(text == null ? '' : text).replace(/\s+/g, '');

const files = [
  ['data/junior.js', '初中', sb.POETRY_JUNIOR],
  ['data/senior.js', '高中', sb.POETRY_SENIOR],
];

const rawEntries = [];
for (const [file, stageName, list] of files) {
  if (!Array.isArray(list)) {
    fail(`${file} 没有导出数组`);
    continue;
  }
  list.forEach((poem, index) => rawEntries.push({ file, stageName, index, poem }));
}

for (const { file, stageName, index, poem } of rawEntries) {
  const where = `${file} 第 ${index + 1} 条${poem && poem.id ? '（' + poem.id + '）' : ''}`;
  if (!isPlainObject(poem)) {
    fail(`${where} 不是对象`);
    continue;
  }
  TEXT_FIELDS.forEach((field) => {
    if (typeof poem[field] !== 'string' || !poem[field].trim()) fail(`${where} 字段 ${field} 为空或不是字符串`);
  });
  if (typeof poem.id === 'string' && !/^[a-z0-9][a-z0-9-]*$/.test(poem.id)) {
    fail(`${where} id 格式不合法（只允许小写字母、数字、连字符）: ${poem.id}`);
  }
  if (typeof poem.required !== 'boolean') fail(`${where} required 必须是布尔值，实际为 ${typeof poem.required}`);
  if (poem.recommended !== undefined && typeof poem.recommended !== 'boolean') {
    fail(`${where} recommended 必须是布尔值，实际为 ${typeof poem.recommended}`);
  }
  if (poem.notes !== undefined && typeof poem.notes !== 'string') fail(`${where} notes 必须是字符串`);
  ['highlights', 'tags', 'variants'].forEach((field) => {
    if (poem[field] !== undefined && !Array.isArray(poem[field])) fail(`${where} ${field} 必须是数组`);
  });
  (poem.highlights || []).forEach((item, i) => {
    if (!isPlainObject(item) || typeof item.type !== 'string' || !item.type || typeof item.text !== 'string' || !item.text) {
      fail(`${where} highlights[${i}] 结构不合法（需要 { type, text }）`);
    }
  });
  (poem.variants || []).forEach((item, i) => {
    if (!isPlainObject(item) || typeof item.text !== 'string' || !item.text) fail(`${where} variants[${i}] 结构不合法（至少需要 text）`);
    if (item.label !== undefined && typeof item.label !== 'string') fail(`${where} variants[${i}].label 必须是字符串`);
  });
  (poem.tags || []).forEach((tag, i) => {
    if (typeof tag !== 'string' || !tag) fail(`${where} tags[${i}] 必须是非空字符串`);
  });
  Object.keys(poem).forEach((key) => {
    if (!ALLOWED_FIELDS.includes(key)) fail(`${where} 出现多余字段 ${key}（数据库层不会读取）`);
  });
  if (poem.stage !== stageName) fail(`${where} stage=${poem.stage} 与所在文件（${stageName}）不一致`);
  /* 年级 / 课程模块：grade 为展示值，可写成“八年级、九年级”；grades 数组用于多值匹配。
     两者都必须落在 metadata.grades[stage] 里，且不能再用“七~九年级 / 初中 / 高中”这类旧值。 */
  const stageGrades = meta.grades[poem.stage] || [];
  const gradeValues = Array.isArray(poem.grades) && poem.grades.length
    ? poem.grades
    : String(poem.grade || '').split(/[、,，/]/).map((item) => item.trim()).filter(Boolean);
  gradeValues.forEach((value) => {
    if (!stageGrades.includes(value)) fail(`${where} grade=${value} 不在 metadata.grades.${poem.stage} 中（可用值：${stageGrades.join(' / ')}）`);
  });
  if (poem.grades !== undefined && !Array.isArray(poem.grades)) fail(`${where} grades 必须是数组`);
  if (poem.genre && !meta.genres.includes(poem.genre)) fail(`${where} genre=${poem.genre} 不在 metadata.genres 中`);
  if (poem.sourceType && !meta.sourceTypes.some((item) => item.key === poem.sourceType)) {
    fail(`${where} sourceType=${poem.sourceType} 不在 metadata.sourceTypes 中`);
  }
  if (typeof poem.text === 'string') {
    if (/[\u200b\u200d\u2060\ufeff]/.test(poem.text + poem.title)) fail(`${where} 含零宽字符`);
    if (/[ \t]/.test(poem.text)) fail(`${where} 正文含半角空格 / 制表符`);
    if (/[,.!?;:]/.test(poem.text)) fail(`${where} 正文含半角标点`);
    if (/[A-Za-z0-9]/.test(poem.text)) fail(`${where} 正文含字母或数字`);
  }
  /* 逐句翻译：必须与 Utils.splitSentences(poem.text) 严格一一对应（下标即句序）。
     这是“原文句数 = 翻译句数”的硬约束，缺一条就说明对应关系错位。 */
  const sentences = sb.PoetryUtils.splitSentences(poem.text);
  if (!Array.isArray(poem.translation)) {
    fail(`${where} 缺少 translation 数组`);
  } else {
    if (poem.translation.length !== sentences.length) {
      fail(`${where} translation 长度 ${poem.translation.length} ≠ 正文句数 ${sentences.length}`);
    }
    poem.translation.forEach((line, i) => {
      if (typeof line !== 'string') { fail(`${where} translation[${i}] 不是字符串`); return; }
      if (!line.trim()) fail(`${where} translation[${i}] 为空（第 ${i + 1} 句：${sentences[i] || ''}）`);
      if (/[\r\n\t]/.test(line)) fail(`${where} translation[${i}] 含换行 / 制表符`);
      if (/[□]/.test(line)) fail(`${where} translation[${i}] 含占位符 □`);
      if (/[<>]/.test(line)) fail(`${where} translation[${i}] 含 HTML 尖括号`);
      if (/[A-Za-z]/.test(line)) caution(`${where} translation[${i}] 含拉丁字母：${line}`);
      if (line === sentences[i]) fail(`${where} translation[${i}] 与原文完全相同`);
    });
  }

  /* 中心思想 / 主旨：文章级信息，必须存在且足够简短；
     正文里绝不能出现 ★ / ☆ —— 星标只存在于 examFocus 元数据里。 */
  const summary = String(poem.summary == null ? '' : poem.summary).trim();
  if (!summary) fail(`${where} 缺少 summary（中心思想 / 主旨）`);
  if (/[\r\n]/.test(summary)) fail(`${where} summary 含换行`);
  if (/[★☆]/.test(summary)) fail(`${where} summary 含星标符号`);
  if (summary.length > 120) fail(`${where} summary 过长（${summary.length} 字，应 ≤ 120 字）`);
  if (/[<>]/.test(summary)) fail(`${where} summary 含 HTML 尖括号`);
  if (/[。！？]$/.test(summary) === false && summary) caution(`${where} summary 未以句末标点结尾`);

  /* 考试重点：只存句子下标，下标必须落在正文句数范围内且不重复。
     这是“marker 与句子正确绑定”的硬约束。 */
  if (!Array.isArray(poem.examFocus)) {
    fail(`${where} 缺少 examFocus 数组`);
  } else {
    if (!poem.examFocus.length) fail(`${where} examFocus 为空（每篇至少标 1 句重点）`);
    if (poem.examFocus.length > 12) caution(`${where} examFocus 标了 ${poem.examFocus.length} 句，可能过多`);
    if (poem.examFocus.length > sentences.length) {
      fail(`${where} examFocus 数量 ${poem.examFocus.length} > 正文句数 ${sentences.length}`);
    }
    const seenFocus = new Set();
    const seenReason = new Set();
    poem.examFocus.forEach((item, i) => {
      if (!isPlainObject(item)) { fail(`${where} examFocus[${i}] 不是对象`); return; }
      if (!Number.isInteger(item.index)) { fail(`${where} examFocus[${i}] 缺少整数 index`); return; }
      if (item.index < 0 || item.index >= sentences.length) {
        fail(`${where} examFocus[${i}] index=${item.index} 越界（正文共 ${sentences.length} 句）`);
      }
      if (seenFocus.has(item.index)) fail(`${where} examFocus 里 index=${item.index} 重复`);
      seenFocus.add(item.index);
      const reason = String(item.reason == null ? '' : item.reason).trim();
      if (!reason) fail(`${where} examFocus[${i}] 缺少 reason`);
      // 同一篇里两句话不该有完全一样的判定依据（说明有一处是复制粘贴没改）
      if (seenReason.has(reason)) fail(`${where} examFocus[${i}] reason 与另一句完全相同：${reason}`);
      seenReason.add(reason);
      if (/[\r\n]/.test(reason)) fail(`${where} examFocus[${i}] reason 含换行`);
      if (/[★☆]/.test(reason)) fail(`${where} examFocus[${i}] reason 含星标符号`);
      // reason 只允许写在“可核查依据”上，不允许编造考试年份 / 频次
      if (/(\d{4}\s*年|中考真题|高考真题|频率|高频度|第\s*\d+\s*次)/.test(reason)) {
        fail(`${where} examFocus[${i}] reason 含无法核查的考试频率表述：${reason}`);
      }
    });
  }
}

/* ---------------- 1b. 背诵提示（highlights）必须能在正文里找到 ---------------- */

/* 「名句」应当是正文原句（去掉标点后做子串比对）；
   「易错字」是按空格分隔的零散字词，逐个比对。提示里的字如果正文里根本没有，
   说明正文或提示至少有一处写错了，必须人工确认。 */
const bare = (text) => String(text == null ? '' : text).replace(/[^\u4e00-\u9fff0-9]/g, '');
for (const { file, index, poem } of rawEntries) {
  if (!isPlainObject(poem) || typeof poem.text !== 'string') continue;
  const where = `${file} 第 ${index + 1} 条${poem.id ? '（' + poem.id + '）' : ''}`;
  const body = bare(poem.text);
  (poem.highlights || []).forEach((item, i) => {
    if (!isPlainObject(item) || typeof item.text !== 'string') return;
    const words = item.type === '易错字' ? item.text.split(/\s+/).filter(Boolean) : [item.text];
    const missing = words.filter((word) => bare(word) && body.indexOf(bare(word)) === -1);
    if (missing.length) fail(`${where} highlights[${i}]（${item.type || '名句'}）不在正文中：${missing.join(' / ')}`);
  });
}

/* ---------------- 2. 重复篇目分级 ---------------- */

const idSeen = new Map();
const fullSeen = new Map();
const titleAuthor = new Map();
for (const { file, index, poem } of rawEntries) {
  if (!isPlainObject(poem) || typeof poem.id !== 'string') continue;
  const where = `${file} 第 ${index + 1} 条`;
  if (idSeen.has(poem.id)) fail(`原始数据 id 重复：${poem.id}（${idSeen.get(poem.id)} 与 ${where}）`);
  else idSeen.set(poem.id, where);

  const fullKey = [poem.title, poem.author, poem.stage, norm(poem.text)].join('|');
  if (fullSeen.has(fullKey)) fail(`完全重复的篇目（标题+作者+学段+正文相同）：${poem.title}｜${poem.author}（${fullSeen.get(fullKey)} 与 ${where}）`);
  else fullSeen.set(fullKey, where);

  const shortKey = poem.title + '|' + poem.author;
  if (!titleAuthor.has(shortKey)) titleAuthor.set(shortKey, []);
  titleAuthor.get(shortKey).push({ where, poem });
}
for (const [key, list] of titleAuthor) {
  if (list.length < 2) continue;
  const distinct = new Set(list.map((item) => [item.poem.stage, norm(item.poem.text)].join('|')));
  if (distinct.size > 1) {
    caution(`同名同作者但内容/学段不同（WARN，需人工确认）：${key} → ${list.map((item) => item.where + '｜' + item.poem.stage).join(' vs ')}`);
  }
}

/* ---------------- 3. 数据库层与原始数据必须一致 ---------------- */

const all = DB.all();
console.log('原始数据条数:', rawEntries.length, '（初中', (sb.POETRY_JUNIOR || []).length, '+ 高中', (sb.POETRY_SENIOR || []).length, '）');
console.log('数据库层条数:', all.length);
if (all.length !== rawEntries.length) fail(`数据库层条数 ${all.length} ≠ 原始数据条数 ${rawEntries.length}（有数据被静默跳过）`);
if (DB.rawCount() !== rawEntries.length) fail('PoetryDatabase.rawCount() 与原始数据条数不一致');
if (DB.problems.length) DB.problems.forEach((message) => fail('数据库层报错：' + message));
for (const { poem } of rawEntries) {
  if (isPlainObject(poem) && typeof poem.id === 'string' && !DB.byId(poem.id)) {
    fail(`原始数据 id=${poem.id} 在数据库层找不到（可能被改名）`);
  }
}

/* ---------------- 4. 文档 / 元数据 / package 一致性 ---------------- */

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
const gitignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
const juniorCount = (sb.POETRY_JUNIOR || []).length;
const seniorCount = (sb.POETRY_SENIOR || []).length;

if (pkg.version !== meta.version) fail(`package.json 版本 ${pkg.version} ≠ data/metadata.js 版本 ${meta.version}`);
if (lock.version !== pkg.version || (lock.packages && lock.packages[''] && lock.packages[''].version !== pkg.version)) {
  fail(`package-lock.json 版本与 package.json 不同步（${lock.version} ≠ ${pkg.version}）`);
}
if (!readme.includes('v' + pkg.version)) fail(`README 版本记录里没有 v${pkg.version}（改版本号时必须同步 README）`);
if (!readme.includes(`**${all.length} 篇（段）**`)) fail(`README 里的题库总数与真实数据不一致（应为 ${all.length} 篇）`);
if (!readme.includes(`| 初中 | ${juniorCount} |`)) fail(`README 初中数量与真实数据不一致（应为 ${juniorCount}）`);
if (!readme.includes(`| 高中 | ${seniorCount} |`)) fail(`README 高中数量与真实数据不一致（应为 ${seniorCount}）`);
['node_modules/', 'test-results/', 'playwright-report/', '*.log'].forEach((pattern) => {
  if (!gitignore.includes(pattern)) fail(`.gitignore 缺少 ${pattern}（构建 / 测试产物不应进 Git）`);
});

/* ---------------- 5. 分布概览 ---------------- */

const countBy = (key) => {
  const map = {};
  all.forEach((poem) => {
    const value = poem[key];
    map[value] = (map[value] || 0) + 1;
  });
  return map;
};
console.log('年级分布:', JSON.stringify(countBy('grade')));
console.log('来源分布:', JSON.stringify(countBy('sourceType')));
console.log('体裁分布:', JSON.stringify(countBy('genre')));

/* ---------------- 结论 ---------------- */

warns.forEach((message) => console.log('  ⚠ WARN ' + message));
errors.forEach((message) => console.log('  ✗ ERROR ' + message));
console.log(`数据体检: ${errors.length} 个 ERROR / ${warns.length} 个 WARN`);
if (errors.length) {
  process.exitCode = 1;
} else {
  console.log('  ✓ 原始数据层、数据库层与文档一致');
}
