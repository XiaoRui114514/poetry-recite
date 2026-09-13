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

const ALLOWED_FIELDS = ['id', 'title', 'author', 'dynasty', 'stage', 'grade', 'grades', 'genre', 'sourceType', 'required', 'recommended', 'text', 'source', 'highlights', 'tags', 'notes', 'variants'];
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
