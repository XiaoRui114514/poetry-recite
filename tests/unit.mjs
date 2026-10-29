/* 单元自测（零依赖，不需要浏览器）：node tests/unit.mjs

   第二轮审计新增的重点：
   - 按 index.html 的真实顺序加载脚本，验证初始化顺序 / 依赖关系；
   - 原始数据层（data/*.js 数组）字段与 id 唯一性检查；
   - 存储层 schema + 业务不变量（correct + wrong === total、正确率 ≤ 100%）；
   - 非法题型白名单、题量规范化、daily 日期排序、幽灵 ID 清理；
   - 日期策略（浏览器本地时间）在 UTC±X、DST、跨日 / 跨月 / 跨年下的行为；
   - 出题逻辑（各题型、素材不足、非法题型）与确定性随机源（不再有概率性测试）。 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

/* 与 index.html 完全一致的加载顺序 */
const SCRIPT_ORDER = [
  'data/metadata.js',
  'js/utils.js',
  'data/junior.js',
  'data/senior.js',
  'data/database.js',
  'js/storage.js',
  'js/study.js',
  'js/quiz.js',
  'js/worksheet.js',
];

function makeLocalStorage(seed) {
  const store = new Map(Object.entries(seed || {}));
  return {
    store,
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
  };
}

function makeSandbox(seed) {
  const sandbox = {
    console,
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
    localStorage: makeLocalStorage(seed),
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    location: { hash: '', href: 'http://localhost/', pathname: '/' },
    history: { replaceState() {} },
    scrollTo() {},
    setTimeout,
    clearTimeout,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  return sandbox;
}

function loadFiles(sandbox, files) {
  for (const file of files) {
    const code = readFileSync(join(root, file), 'utf8');
    vm.runInContext(code, sandbox, { filename: file });
  }
  return sandbox;
}

const sandbox = loadFiles(makeSandbox(), SCRIPT_ORDER);
const U = sandbox.PoetryUtils;
const DB = sandbox.PoetryDatabase;
const Storage = sandbox.PoetryStorage;
const Meta = sandbox.PoetryMeta;
const Quiz = sandbox.PoetryQuiz;
const Junior = sandbox.POETRY_JUNIOR;
const Senior = sandbox.POETRY_SENIOR;

let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition, extra) {
  if (condition) {
    passed += 1;
  } else {
    failed += 1;
    failures.push(name + (extra ? ' -> ' + extra : ''));
  }
}

function eq(name, actual, expected) {
  check(name, actual === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function section(name) {
  check('[' + name + '] 段落执行完成', true);
}

/* ========== 1. 加载顺序 / 依赖关系（与 index.html 一致） ========== */

const indexHtml = readFileSync(join(root, 'index.html'), 'utf8');
const htmlScripts = [...indexHtml.matchAll(/<script src="([^"]+)"><\/script>/g)].map((match) => match[1]);
const expectedScripts = SCRIPT_ORDER.slice(0, 2).concat(['js/brand.js']).concat(SCRIPT_ORDER.slice(2)).concat(['js/app.js', 'js/pwa.js']);
eq('index.html 脚本顺序与依赖链一致', htmlScripts.join(','), expectedScripts.join(','));
eq('品牌层在数据层之前加载', htmlScripts.indexOf('js/brand.js'), 2);

/* 逐个前缀加载：每一步都不能抛异常（不存在“必须先有后面的文件”的隐式依赖） */
let prefixOk = true;
let prefixError = '';
for (let i = 1; i <= SCRIPT_ORDER.length; i += 1) {
  try {
    loadFiles(makeSandbox(), SCRIPT_ORDER.slice(0, i));
  } catch (err) {
    prefixOk = false;
    prefixError = SCRIPT_ORDER[i - 1] + ': ' + err.message;
    break;
  }
}
check('按顺序逐段加载不报错（无循环 / 隐式依赖）', prefixOk, prefixError);

let appOk = true;
try {
  loadFiles(makeSandbox(), SCRIPT_ORDER.concat(['js/app.js']));
} catch (err) {
  appOk = false;
  prefixError = err.message;
}
check('包含 app.js 的完整加载不报错', appOk, prefixError);

/* ========== 2. 标点安全切分 / 挖空 ========== */

eq('分号/逗号不切断句子', U.splitSentences('东临碣石，以观沧海。').length, 1);
eq('问号切句', U.splitSentences('明月几时有？把酒问青天。').length, 2);
eq('书名号内不切分', U.splitSentences('子曰：“小子何莫学夫《诗》？”').length, 1);
eq('连用问号不产生空句', U.splitSentences('贤哉，回也！').length, 1);

const lunyu = '子曰：“学而时习之，不亦说乎？有朋自远方来，不亦乐乎？人不知而不愠，不亦君子乎？”';
const lunyuSentences = U.splitSentences(lunyu);
eq('论语引号内问句切分数量', lunyuSentences.length, 1);
check('引号内的问号不会把引号拆开', lunyuSentences[0].endsWith('”'), lunyuSentences[0]);

const changhen = '安得广厦千万间，大庇天下寒士俱欢颜！风雨不动安如山。呜呼！何时眼前突兀见此屋，吾庐独破受冻死亦足！';
eq('感叹号切句', U.splitSentences(changhen).length, 4);

const ci = '醉里挑灯看剑，梦回吹角连营。八百里分麾下炙，五十弦翻塞外声，沙场秋点兵。';
eq('词句数', U.splitSentences(ci).length, 2);
eq('词小句数', U.splitClauses(U.splitSentences(ci)[1]).length, 3);

const dunhao = '矜、寡、孤、独、废疾者皆有所养，男有分，女有归。';
eq('顿号不切碎小句', U.splitClauses(dunhao).length, 3);

eq('整句挖空保留标点', U.makeBlank('东临碣石，以观沧海。'), '□□□□，□□□□。');
eq('关键词隐藏保留首字', U.blankKeepFirst('东临碣石，以观沧海。'), '东□□□，以□□□。');
eq('书名字符不受影响', U.makeBlank('学《诗》可以群。'), '□《诗》□□□。');
eq('字符统计忽略标点', U.countChars('东临碣石，以观沧海。'), 8);
eq('省略号保留', U.makeBlank('亦若是则已矣……').indexOf('……') > -1, true);
eq('HTML 转义不遗漏引号', U.escapeHtml(`<a href="x">'&`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;');

/* ========== 3. 原始数据层（未经 normalize 的真实数组） ========== */

const ALLOWED_FIELDS = ['id', 'title', 'author', 'dynasty', 'stage', 'grade', 'grades', 'genre', 'sourceType', 'required', 'recommended', 'text', 'translation', 'summary', 'examFocus', 'source', 'highlights', 'tags', 'notes', 'variants'];
const rawEntries = [
  ...Junior.map((poem) => ({ file: 'data/junior.js', stage: '初中', poem })),
  ...Senior.map((poem) => ({ file: 'data/senior.js', stage: '高中', poem })),
];

check('原始数据是数组', Array.isArray(Junior) && Array.isArray(Senior));
check('原始数据每篇都是对象', rawEntries.every(({ poem }) => poem && typeof poem === 'object' && !Array.isArray(poem)));

const rawIds = rawEntries.map(({ poem }) => String(poem.id || ''));
check('原始 id 不为空', rawIds.every((id) => id.trim().length > 0));
check('原始 id 唯一（不允许依赖 database 自动改名）', new Set(rawIds).size === rawIds.length,
  rawIds.filter((id, i) => rawIds.indexOf(id) !== i).join(','));
check('原始 id 格式合法', rawIds.every((id) => /^[a-z0-9][a-z0-9-]*$/.test(id)),
  rawIds.filter((id) => !/^[a-z0-9][a-z0-9-]*$/.test(id)).join(','));

const emptyIssues = [];
rawEntries.forEach(({ file, poem }) => {
  ['title', 'text', 'author', 'dynasty', 'stage', 'grade', 'genre', 'sourceType', 'source'].forEach((field) => {
    if (typeof poem[field] !== 'string' || !poem[field].trim()) emptyIssues.push(`${file}/${poem.id} 缺 ${field}`);
  });
  if (typeof poem.required !== 'boolean') emptyIssues.push(`${file}/${poem.id} required 类型错误`);
  if (poem.recommended !== undefined && typeof poem.recommended !== 'boolean') emptyIssues.push(`${file}/${poem.id} recommended 类型错误`);
  if (poem.notes !== undefined && typeof poem.notes !== 'string') emptyIssues.push(`${file}/${poem.id} notes 类型错误`);
});
check('原始数据必填字段完整、类型正确', emptyIssues.length === 0, emptyIssues.slice(0, 5).join('; '));

const structureIssues = [];
rawEntries.forEach(({ file, poem }) => {
  ['highlights', 'tags', 'variants'].forEach((field) => {
    if (poem[field] !== undefined && !Array.isArray(poem[field])) structureIssues.push(`${file}/${poem.id} ${field} 不是数组`);
  });
  (poem.highlights || []).forEach((item, i) => {
    if (!item || typeof item.type !== 'string' || !item.type || typeof item.text !== 'string' || !item.text) {
      structureIssues.push(`${file}/${poem.id} highlights[${i}] 结构错误`);
    }
  });
  (poem.variants || []).forEach((item, i) => {
    if (!item || typeof item.text !== 'string' || !item.text) structureIssues.push(`${file}/${poem.id} variants[${i}] 结构错误`);
  });
  (poem.tags || []).forEach((tag, i) => {
    if (typeof tag !== 'string' || !tag) structureIssues.push(`${file}/${poem.id} tags[${i}] 错误`);
  });
});
check('variants / highlights / tags 结构正确', structureIssues.length === 0, structureIssues.slice(0, 5).join('; '));

const extraIssues = [];
rawEntries.forEach(({ file, poem }) => {
  Object.keys(poem).forEach((key) => {
    if (!ALLOWED_FIELDS.includes(key)) extraIssues.push(`${file}/${poem.id} 多余字段 ${key}`);
  });
});
check('原始数据没有多余字段', extraIssues.length === 0, extraIssues.slice(0, 5).join('; '));

/* 逐句翻译：与 Utils.splitSentences(poem.text) 的下标严格一一对应，这是全文学习页
   “原文隐藏时翻译同步隐藏”的前提；任何长度不一致都会导致翻译错位。 */
const translationIssues = [];
let translationSentences = 0;
rawEntries.forEach(({ file, poem }) => {
  const sentences = U.splitSentences(poem.text);
  translationSentences += sentences.length;
  if (!Array.isArray(poem.translation)) {
    translationIssues.push(`${file}/${poem.id} 缺少 translation 数组`);
    return;
  }
  if (poem.translation.length !== sentences.length) {
    translationIssues.push(`${file}/${poem.id} 译文 ${poem.translation.length} 条 ≠ 原文 ${sentences.length} 句`);
  }
  poem.translation.forEach((line, i) => {
    if (typeof line !== 'string' || !line.trim()) translationIssues.push(`${file}/${poem.id}[${i}] 译文为空`);
    else if (/[\r\n\t□]/.test(line)) translationIssues.push(`${file}/${poem.id}[${i}] 译文含换行 / 占位符`);
    else if (line === sentences[i]) translationIssues.push(`${file}/${poem.id}[${i}] 译文与原文完全相同`);
  });
});
check('每篇都有逐句翻译且句数与正文完全一致', translationIssues.length === 0, translationIssues.slice(0, 5).join('; '));
check('逐句翻译总量 = 全部篇目的正文句数', translationSentences === rawEntries.reduce((sum, { poem }) => sum + U.splitSentences(poem.text).length, 0));

const translationCount = DB.all().filter((poem) => poem.translations.length === U.splitSentences(poem.text).length).length;
eq('数据库层每篇都能给出对齐的 translations', translationCount, rawEntries.length);
check('数据库层 translationLines 与 splitSentences 一一对应', (() => {
  const poem = DB.byId('guan-cang-hai');
  const lines = DB.translationLines(poem);
  const sentences = U.splitSentences(poem.text);
  return lines.length === sentences.length && lines.every((line) => typeof line === 'string' && line.length > 0);
})(), JSON.stringify(DB.translationLines(DB.byId('guan-cang-hai'))));
eq('数据库层 translationLines 对缺翻译的位置补齐为空串', (() => {
  const fake = { text: '甲乙。丙丁。', translations: ['第一句'] };
  return DB.translationLines(fake).join('|');
})(), '第一句|');
check('数据库层 translationLines 容忍非数组 / 空篇目',
  DB.translationLines({ text: '甲乙。', translations: null }).join('|') === '' &&
  DB.translationLines(null).length === 0);

/* 考试重点星标：数据里只有句子下标，正文绝不含 ★；下标必须落在正文句数范围内。
   这是全文学习页「marker 与句子正确绑定、星标不污染正文」的前提。 */
const focusIssues = [];
let focusTotal = 0;
rawEntries.forEach(({ file, poem }) => {
  const sentences = U.splitSentences(poem.text);
  if (typeof poem.text !== 'string' || !poem.text) return;
  if (/[★☆]/.test(poem.text)) focusIssues.push(`${file}/${poem.id} 正文里出现了星标符号`);
  if (typeof poem.title === 'string' && /[★☆]/.test(poem.title)) {
    focusIssues.push(`${file}/${poem.id} 标题里出现了星标符号`);
  }
  if (!Array.isArray(poem.examFocus)) {
    focusIssues.push(`${file}/${poem.id} 缺少 examFocus 数组`);
    return;
  }
  if (!poem.examFocus.length) focusIssues.push(`${file}/${poem.id} examFocus 为空`);
  const seen = new Set();
  const seenReason = new Set();
  poem.examFocus.forEach((item, i) => {
    if (!item || !Number.isInteger(item.index)) {
      focusIssues.push(`${file}/${poem.id} examFocus[${i}] 缺少整数 index`);
      return;
    }
    if (item.index < 0 || item.index >= sentences.length) {
      focusIssues.push(`${file}/${poem.id} examFocus[${i}] index=${item.index} 越界（共 ${sentences.length} 句）`);
    }
    if (seen.has(item.index)) focusIssues.push(`${file}/${poem.id} examFocus 下标重复 ${item.index}`);
    seen.add(item.index);
    if (!item.reason || !String(item.reason).trim()) focusIssues.push(`${file}/${poem.id} examFocus[${i}] 缺少 reason`);
    // 同一篇里两句话的依据不该完全一样（多半是复制粘贴没改）
    const reason = String(item.reason || '').trim();
    if (reason && seenReason.has(reason)) focusIssues.push(`${file}/${poem.id} examFocus[${i}] reason 重复：${reason}`);
    seenReason.add(reason);
    focusTotal += 1;
  });
});
check('每篇都有考试重点标记且下标落在正文句数范围内', focusIssues.length === 0, focusIssues.slice(0, 5).join('; '));
check('正文与标题里都不含 ★（星标只存在于 examFocus 元数据）',
  rawEntries.every(({ poem }) => !/[★☆]/.test(String(poem.text || '')) && !/[★☆]/.test(String(poem.title || ''))));
check('考试重点标记总量合理（平均每篇 1～8 句）', (() => {
  const avg = focusTotal / rawEntries.length;
  return focusTotal > 0 && avg >= 1 && avg <= 8;
})(), '共 ' + focusTotal + ' 句 / ' + rawEntries.length + ' 篇');

/* 中心思想 / 主旨：文章级信息，每篇都有，简短且不含星标 */
const summaryIssues = [];
rawEntries.forEach(({ file, poem }) => {
  const summary = String(poem.summary == null ? '' : poem.summary).trim();
  if (!summary) { summaryIssues.push(`${file}/${poem.id} 缺少 summary`); return; }
  if (/[\r\n]/.test(summary)) summaryIssues.push(`${file}/${poem.id} summary 含换行`);
  if (/[★☆]/.test(summary)) summaryIssues.push(`${file}/${poem.id} summary 含星标`);
  if (summary.length > 120) summaryIssues.push(`${file}/${poem.id} summary 过长 ${summary.length} 字`);
  if (summary.length < 20) summaryIssues.push(`${file}/${poem.id} summary 过短 ${summary.length} 字`);
});
check('每篇都有简短的中心思想 / 主旨且不含星标', summaryIssues.length === 0, summaryIssues.slice(0, 5).join('; '));

/* 数据库层：examFocusMap 只保留合法下标，越界 / 坏数据不会让页面报错 */
eq('数据库层 examFocusMap 按句子下标对齐', (() => {
  const map = DB.examFocusMap(DB.byId('guan-cang-hai'));
  return Object.keys(map).map(Number).sort((a, b) => a - b).join(',');
})(), DB.byId('guan-cang-hai').examFocus.map((f) => f.index).sort((a, b) => a - b).join(','));
eq('数据库层 examFocusMap 丢弃越界下标', (() => {
  const fake = { text: '甲乙。丙丁。', examFocus: [{ index: 0, reason: 'a' }, { index: 5, reason: 'b' }, { index: -1, reason: 'c' }] };
  return Object.keys(DB.examFocusMap(fake)).join(',');
})(), '0');
check('数据库层 examFocusMap 容忍缺失 / 非数组 / 空篇目',
  Object.keys(DB.examFocusMap({ text: '甲乙。' })).length === 0 &&
  Object.keys(DB.examFocusMap({ text: '甲乙。', examFocus: null })).length === 0 &&
  Object.keys(DB.examFocusMap(null)).length === 0);
check('数据库层每篇都能给出 summary',
  DB.all().every((poem) => typeof poem.summary === 'string' && poem.summary.length > 0));

const fieldValueIssues = [];
rawEntries.forEach(({ file, stage, poem }) => {
  if (poem.stage !== stage) fieldValueIssues.push(`${file}/${poem.id} stage=${poem.stage}`);
  const stageGrades = Meta.grades[poem.stage] || [];
  const gradeValues = Array.isArray(poem.grades) && poem.grades.length
    ? poem.grades
    : String(poem.grade || '').split(/[、,，/]/).map((item) => item.trim()).filter(Boolean);
  gradeValues.forEach((value) => {
    if (!stageGrades.includes(value)) fieldValueIssues.push(`${file}/${poem.id} grade=${value}`);
  });
  if (!Meta.genres.includes(poem.genre)) fieldValueIssues.push(`${file}/${poem.id} genre=${poem.genre}`);
  if (!Meta.sourceTypes.some((item) => item.key === poem.sourceType)) fieldValueIssues.push(`${file}/${poem.id} sourceType=${poem.sourceType}`);
});
check('原始数据的学段 / 年级 / 体裁 / 来源都在 metadata 中', fieldValueIssues.length === 0, fieldValueIssues.slice(0, 5).join('; '));

/* 年级 / 课程模块的“真实性”：不允许再出现与学段重复或范围式的旧值 */
const legacyGrades = rawEntries
  .filter(({ poem }) => ['初中', '高中', '七~九年级', '八~九年级'].includes(String(poem.grade)))
  .map(({ poem }) => poem.id + ':' + poem.grade);
check('不再有“初中 / 高中 / 七~九年级 / 八~九年级”这类旧年级值', legacyGrades.length === 0, legacyGrades.join(','));
const juniorGrades = new Set(Junior.map((poem) => poem.grade).filter((grade) => grade.indexOf('、') === -1));
check('初中年级选项与 metadata 完全一致',
  Meta.grades.初中.every((grade) => juniorGrades.has(grade)) && juniorGrades.size === Meta.grades.初中.length,
  [...juniorGrades].join(','));
const seniorGrades = new Set(Senior.map((poem) => poem.grade));
check('高中课程模块与 metadata 完全一致',
  Meta.grades.高中.every((grade) => seniorGrades.has(grade)) && seniorGrades.size === Meta.grades.高中.length,
  [...seniorGrades].join(','));
check('高中不再出现高一 / 高二 / 高三', Senior.every((poem) => !/^高[一二三]$/.test(poem.grade)));
check('高中课程模块只有 必修 / 选择性必修 / 选修（不再有“诗词曲”）',
  Meta.grades.高中.join(',') === '必修,选择性必修,选修' && Senior.every((poem) => Meta.grades.高中.includes(poem.grade)));
eq('高中·必修模块数量', DB.query({ stage: '高中', grade: '必修' }).length, 27);
eq('高中·选择性必修模块数量', DB.query({ stage: '高中', grade: '选择性必修' }).length, 27);
eq('高中·选修模块数量', DB.query({ stage: '高中', grade: '选修' }).length, 20);
eq('三个模块合计 = 高中题库', DB.query({ stage: '高中', grade: ['必修', '选择性必修', '选修'] }).length, Senior.length);
/* 诗词曲已并入课程模块：原 40 首按教材归属分别落在三个模块里 */
const poemGenreByModule = DB.query({ stage: '高中' }).filter((poem) => poem.genre !== '文言文');
check('诗词类高中篇目分布在三个模块中', new Set(poemGenreByModule.map((poem) => poem.grade)).size === 3,
  JSON.stringify(DB.countBy(poemGenreByModule, 'grade')));

/* 完全重复（标题+作者+学段+正文）必须是 0；同名同作者但正文不同只算 WARN */
const normText = (text) => String(text).replace(/\s+/g, '');
const fullKeys = rawEntries.map(({ poem }) => [poem.title, poem.author, poem.stage, normText(poem.text)].join('|'));
check('没有完全重复的篇目（标题+作者+学段+正文）', new Set(fullKeys).size === fullKeys.length);
const shortGroups = new Map();
rawEntries.forEach(({ poem }) => {
  const key = poem.title + '|' + poem.author;
  if (!shortGroups.has(key)) shortGroups.set(key, []);
  shortGroups.get(key).push(poem);
});
const sameTitleDiffText = [...shortGroups.entries()].filter(([, list]) => new Set(list.map((p) => p.stage + '|' + normText(p.text))).size > 1);
check('同名同作者但内容不同不会被误判为重复（《论语》十二章）',
  sameTitleDiffText.every(([, list]) => new Set(list.map((p) => p.stage)).size > 1),
  JSON.stringify(sameTitleDiffText.map(([key]) => key)));

/* ========== 4. 数据库层 ========== */

const all = DB.all();
check('题库非空', all.length > 100, String(all.length));
eq('数据库条数与原始数据一致（不允许静默跳过）', all.length, rawEntries.length);
eq('rawCount 与原始数据一致', DB.rawCount(), rawEntries.length);
eq('数据库层没有报错', DB.problems.length, 0);
check('每个原始 id 都能在数据库层查到', rawEntries.every(({ poem }) => !!DB.byId(poem.id)),
  rawEntries.filter(({ poem }) => !DB.byId(poem.id)).map(({ poem }) => poem.id).slice(0, 5).join(','));
eq('初中学段数量', DB.byStage('初中').length, Junior.length);
eq('高中学段数量', DB.byStage('高中').length, Senior.length);
eq('题库总数', all.length, 199);
eq('课标推荐篇目数量', DB.query({ onlyRequired: true }).length, 132);
check('所有篇目都有正文', all.every((p) => p.text && p.text.length > 4));
check('所有篇目都有作者与朝代', all.every((p) => p.author && p.dynasty));
check('所有篇目都有来源类型', all.every((p) => p.sourceType));
check('id 唯一', new Set(all.map((p) => p.id)).size === all.length);
check('id 为英文标识', all.every((p) => /^[a-z0-9-]+$/.test(p.id)), all.filter((p) => !/^[a-z0-9-]+$/.test(p.id)).map((p) => p.id).join(','));
check('每篇至少一句', all.every((p) => U.splitSentences(p.text).length >= 1));
check('正文不含半角标点混排', all.every((p) => !/[a-zA-Z0-9,.;:!?]/.test(U.stripPunctuation(p.text).replace(/[a-zA-Z0-9]/g, ''))));
check('正文不含首尾空白', all.every((p) => p.text === p.text.trim()));
check('长文完整（滕王阁序 > 700 字）', DB.byId('teng-wang-ge-xu').text.length > 700);

const bySource = DB.stats().bySource;
check('存在统编教材来源', bySource['统编教材'] > 0, JSON.stringify(bySource));
check('存在上海地区来源', bySource['上海地区'] > 0);
check('存在拓展来源', bySource['拓展'] > 0);
check('存在文言文体裁', DB.query({ genre: '文言文' }).length >= 40);

/* 筛选器必须覆盖题库里出现的所有取值，否则会出现“筛不到 / 排序靠后”的篇目 */
check('每篇的年级 / 课程模块都能在筛选器里找到', all.every((p) => p.grades.length > 0 &&
  p.grades.every((grade) => (Meta.grades[p.stage] || []).includes(grade))),
  all.filter((p) => !p.grades.length || p.grades.some((grade) => !(Meta.grades[p.stage] || []).includes(grade)))
    .map((p) => p.id + ':' + p.grades.join('|')).join(','));
check('体裁都能在筛选器里找到', all.every((p) => Meta.genres.includes(p.genre)));
check('来源都能在筛选器里找到', all.every((p) => Meta.sourceTypes.some((item) => item.key === p.sourceType)));

check('搜索李白可命中', DB.query({ stage: '高中', keyword: '李白' }).length >= 3);
check('搜索篇名可命中', DB.query({ stage: '初中', keyword: '观沧海' }).length === 1);
check('按课程模块筛选（高中·必修）', DB.query({ stage: '高中', grade: '必修' }).length === 27);
check('按年级筛选（初中·六年级）', DB.query({ stage: '初中', grade: '六年级' }).length === 10);
check('课程模块支持多选（必修 27 + 选修 20 = 47）',
  DB.query({ stage: '高中', grade: ['必修', '选修'] }).length === 47,
  String(DB.query({ stage: '高中', grade: ['必修', '选修'] }).length));
check('年级支持多选（六年级 + 七年级 = 47）',
  DB.query({ stage: '初中', grade: ['六年级', '七年级'] }).length === 47,
  String(DB.query({ stage: '初中', grade: ['六年级', '七年级'] }).length));
check('跨年级篇目在两个年级都能筛到（《孟子》三则）',
  DB.query({ stage: '初中', grade: '八年级' }).some((p) => p.id === 'meng-zi-san-ze') &&
  DB.query({ stage: '初中', grade: '九年级' }).some((p) => p.id === 'meng-zi-san-ze'));
check('跨年级篇目只出现一次（去重后仍是 110 篇）',
  new Set(DB.query({ stage: '初中', grade: ['八年级', '九年级'] }).map((p) => p.id)).size ===
  DB.query({ stage: '初中', grade: ['八年级', '九年级'] }).length);
check('空数组 = 不筛选年级', DB.query({ stage: '高中', grade: [] }).length === 74);
check('按体裁筛选', DB.query({ stage: '初中', genre: '词' }).length > 5);
check('按来源筛选', DB.query({ stage: '初中', sourceType: '上海地区' }).length === 10);
check('体裁支持多选（诗 + 词 = 两者之和）',
  DB.query({ stage: '初中', genre: ['诗', '词'] }).length ===
  DB.query({ stage: '初中', genre: '诗' }).length + DB.query({ stage: '初中', genre: '词' }).length,
  String(DB.query({ stage: '初中', genre: ['诗', '词'] }).length));
check('体裁多选与单选结果不重复计数',
  new Set(DB.query({ stage: '初中', genre: ['诗', '词'] }).map((poem) => poem.id)).size ===
  DB.query({ stage: '初中', genre: ['诗', '词'] }).length);
check('来源支持多选（课标推荐 + 上海地区）',
  DB.query({ stage: '初中', sourceType: ['课标推荐', '上海地区'] }).length ===
  DB.query({ stage: '初中', sourceType: '课标推荐' }).length + DB.query({ stage: '初中', sourceType: '上海地区' }).length,
  String(DB.query({ stage: '初中', sourceType: ['课标推荐', '上海地区'] }).length));
check('三类筛选可叠加（模块 + 体裁 + 来源）',
  DB.query({ stage: '高中', grade: ['必修'], genre: ['词'], sourceType: ['课标推荐'] }).every((poem) =>
    poem.grades.includes('必修') && poem.genre === '词' && poem.sourceType === '课标推荐'));
check('排序后初中全部排在高中之前', (() => {
  const sorted = DB.sort(all);
  const firstSenior = sorted.findIndex((poem) => poem.stage === '高中');
  return firstSenior > 0 && sorted.slice(0, firstSenior).every((poem) => poem.stage === '初中');
})());

section('数据层');

/* ========== 5. 日期策略（浏览器本地时间，不用 UTC） ========== */

eq('todayKey 接受日键字符串时原样返回（避免 UTC 偏移）', U.todayKey('2026-09-13'), '2026-09-13');
eq('todayKey 对非法输入回退到当天', U.todayKey('not-a-date'), U.todayKey());
eq('formatDateTime 使用本地时间', U.formatDateTime(new Date(2026, 0, 5, 9, 7).getTime()), '2026-01-05 09:07');
eq('formatDateTime 对非法时间戳返回空字符串', U.formatDateTime('junk'), '');

check('isValidDayKey 接受真实日期', U.isValidDayKey('2026-09-13') && U.isValidDayKey('2024-02-29'));
check('isValidDayKey 拒绝非法日期',
  !U.isValidDayKey('2026-13-01') && !U.isValidDayKey('2026-02-30') && !U.isValidDayKey('2026-9-1') &&
  !U.isValidDayKey('') && !U.isValidDayKey('x') && !U.isValidDayKey('1899-12-31') && !U.isValidDayKey('2101-01-01') &&
  !U.isValidDayKey('2023-02-29'));
eq('sortDayKeys 过滤非法值并按日期升序', U.sortDayKeys(['2026-09-13', 'x', '2026-01-05', '2026-13-01', '2026-09-13']).join(','), '2026-01-05,2026-09-13');
eq('addDaysKey 跨月', U.addDaysKey('2026-01-31', 1), '2026-02-01');
eq('addDaysKey 跨年 / 闰年', U.addDaysKey('2024-02-28', 1), '2024-02-29');
eq('addDaysKey 向前跨年', U.addDaysKey('2027-01-01', -1), '2026-12-31');
eq('daysBetweenKeys 计算日历天数', U.daysBetweenKeys('2026-01-31', '2026-02-02'), 2);
check('daysBetweenKeys 非法输入返回 NaN', Number.isNaN(U.daysBetweenKeys('x', '2026-02-02')));
check('isDueDay 判断到期', U.isDueDay('2026-09-13', '2026-09-13') && U.isDueDay('2026-09-12', '2026-09-13') && !U.isDueDay('2026-09-14', '2026-09-13'));

const utilsPath = join(root, 'js', 'utils.js');
function todayKeyInTz(tz, iso) {
  const script = [
    "const fs=require('fs'),vm=require('vm');",
    'const sb={window:null};sb.window=sb;vm.createContext(sb);',
    `vm.runInContext(fs.readFileSync(${JSON.stringify(utilsPath)},'utf8'),sb,{filename:'js/utils.js'});`,
    'process.stdout.write(sb.PoetryUtils.todayKey(new Date(process.argv[1])));',
  ].join('');
  return execFileSync(process.execPath, ['-e', script, iso], { env: { ...process.env, TZ: tz } }).toString();
}

const tzCases = [
  ['UTC', '2026-09-13T16:30:00Z', '2026-09-13'],
  ['Etc/GMT+5', '2026-09-13T16:30:00Z', '2026-09-13'],
  ['America/New_York', '2026-09-13T16:30:00Z', '2026-09-13'],
  ['Asia/Shanghai', '2026-09-13T16:30:00Z', '2026-09-14'],
  ['Asia/Tokyo', '2026-09-13T16:30:00Z', '2026-09-14'],
  ['Asia/Shanghai', '2026-12-31T16:30:00Z', '2027-01-01'],
  ['America/New_York', '2026-11-01T05:30:00Z', '2026-11-01'],
  ['America/New_York', '2026-11-02T04:30:00Z', '2026-11-01'],
];
tzCases.forEach(([tz, iso, expected]) => {
  eq(`todayKey 本地日期正确 (${tz} ${iso})`, todayKeyInTz(tz, iso), expected);
});
eq('UTC-5 下日键字符串不会被当成 UTC 零点',
  todayKeyInTz('Etc/GMT+5', new Date(Date.UTC(2026, 8, 13, 16, 30)).toISOString()), '2026-09-13');

/* 23:59 → 00:00 跨日、跨月、跨年 */
eq('本地 23:59 属于当天', U.todayKey(new Date(2026, 8, 13, 23, 59)), '2026-09-13');
eq('本地 00:00 属于新一天', U.todayKey(new Date(2026, 8, 14, 0, 0)), '2026-09-14');
eq('本地跨月正确', U.todayKey(new Date(2026, 8, 30, 23, 59)), '2026-09-30');
eq('本地跨年正确', U.todayKey(new Date(2026, 11, 31, 23, 59)), '2026-12-31');

const jsSources = ['utils.js', 'storage.js', 'study.js', 'quiz.js', 'app.js', 'brand.js']
  .map((file) => [file, readFileSync(join(root, 'js', file), 'utf8')]);
const stripComments = (code) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
check('业务代码没有使用 UTC 时间 API（toISOString / getUTC*）',
  jsSources.every(([, code]) => !/toISOString|getUTCFullYear|getUTCMonth|getUTCDate|getUTCHours/.test(stripComments(code))),
  jsSources.filter(([, code]) => /toISOString|getUTC/.test(stripComments(code))).map(([file]) => file).join(','));

section('日期');

/* ========== 6. 存储：schema + 业务不变量 ========== */

const broken = Storage.sanitize({ selectedIds: 'oops', quizStats: 3, wrongBook: [1, 2], prefs: null });
check('损坏数据会被整理成数组', Array.isArray(broken.selectedIds) && broken.selectedIds.length === 0);
check('损坏的统计被重置', broken.quizStats.total === 0);
check('损坏的错题本被重置', Array.isArray(broken.wrongBook) && broken.wrongBook.length === 0);
check('损坏的偏好回落到默认值', broken.prefs.quizCount === 10 && broken.prefs.modes.length === 0);

const messy = Storage.sanitize({
  stage: '大学',
  selectedIds: ['guan-ju', 'guan-ju', 5, null],
  learnedIds: { 'guan-ju': 'x' },
  daily: { '2026-09-12': { quiz: '3', correct: 2 } },
});
eq('非法学段被清空', messy.stage, '');
eq('重复 id 去重', messy.selectedIds.length, 1);
check('学习时间戳被修正', typeof messy.learnedIds['guan-ju'] === 'number' && messy.learnedIds['guan-ju'] > 0);
eq('每日统计转数字', messy.daily['2026-09-12'].quiz, 3);

const repaired = Storage.sanitize({
  quizStats: { total: 1, correct: 5, wrong: -3, byPoem: { 'guan-ju': { total: 10, correct: 2, wrong: 1, lastTime: 0 } } },
  wrongBook: [{ id: 'guan-ju', time: 'x', count: 0, mode: 'unknown-mode' }],
  recents: [{ id: 'guan-ju', time: 2 }, { id: 'guan-ju', time: 1 }],
});
eq('quizStats.total 由 correct + wrong 重建', repaired.quizStats.total, repaired.quizStats.correct + repaired.quizStats.wrong);
eq('quizStats.correct 保持有效值', repaired.quizStats.correct, 5);
eq('负数的 wrong 归零', repaired.quizStats.wrong, 0);
eq('byPoem 同样满足不变量', repaired.quizStats.byPoem['guan-ju'].total, 3);
check('正确率不会超过 100%', repaired.quizStats.correct / repaired.quizStats.total <= 1);
eq('错题本 count 至少为 1', repaired.wrongBook[0].count, 1);
eq('错题本非法题型被清空', repaired.wrongBook[0].mode, '');
eq('recents 去重只留一条', repaired.recents.length, 1);
check('sanitize 之后通过 schema / 业务校验', Storage.validate(repaired).length === 0, Storage.validate(repaired).join('; '));
check('默认状态本身合法', Storage.validate(Storage.defaults()).length === 0, Storage.validate(Storage.defaults()).join('; '));
check('validate 能识破不变量错误',
  Storage.validate(Object.assign(Storage.defaults(), { quizStats: { total: 1, correct: 5, wrong: 0, byPoem: {} } })).length > 0);

/* 题型白名单 */
eq('storage 白名单与 quiz 的 7 种题型一致', Storage.MODE_KEYS.join(','), Quiz.MODES.map((mode) => mode.key).join(','));
eq('全部非法的 modes 被清空（= 随机组合）', Storage.sanitize({ prefs: { modes: ['abc', '123', 'unknown-mode'] } }).prefs.modes.length, 0);
eq('合法 + 非法混合只保留合法值', Storage.sanitize({ prefs: { modes: ['abc', 'full', 'next', 'full'] } }).prefs.modes.join(','), 'full,next');
eq('合法的 modes 原样保留', Storage.sanitize({ prefs: { modes: ['blank-full', 'next', 'prev', 'keyword', 'mixed', 'full', 'translation'] } }).prefs.modes.length, 7);
check('非法 modes 不会让题目数量变成 0',
  Quiz.__internals.pickQuestions([DB.byId('guan-cang-hai')], { count: 5, modes: ['abc', '123'] }).length > 0);

/* 题量规范化 */
const countCases = [
  [1, 5], [5, 5], [10, 10], [20, 20], [30, 30], [60, 30],
  [0, 10], [-1, 10], [61, 30], [NaN, 10], ['20', 20], ['abc', 10], [null, 10], [undefined, 10], [{}, 10],
];
countCases.forEach(([input, expected]) => {
  eq(`quizCount ${JSON.stringify(input)} → ${expected}`, Storage.normalizeQuizCount(input), expected);
});
check('quizCount 规范化结果永远是 UI 可选项',
  countCases.every(([input]) => Storage.QUIZ_COUNT_OPTIONS.includes(Storage.normalizeQuizCount(input))));

/* daily：非法日期 + 排序 + 只保留最近 60 天 */
const dailyInput = {};
for (let i = 0; i < 100; i += 1) {
  const key = U.todayKey(new Date(2026, 0, 1 + i));
  dailyInput[key] = { quiz: i, correct: i };
}
dailyInput['2026-13-01'] = { quiz: 5, correct: 5 };
dailyInput['2026-02-30'] = { quiz: 5, correct: 5 };
dailyInput[''] = { quiz: 5, correct: 5 };
dailyInput['not-a-date'] = { quiz: 5, correct: 5 };
dailyInput['1899-01-01'] = { quiz: 5, correct: 5 };
dailyInput['2026-04-10'] = { quiz: 3, correct: 9 };

const dailyState = Storage.sanitize({ daily: dailyInput });
const dailyKeys = Object.keys(dailyState.daily);
eq('daily 只保留最近 60 天', dailyKeys.length, 60);
check('daily 按日期升序排列', dailyKeys.join(',') === U.sortDayKeys(dailyKeys).join(','));
check('daily 不含非法日期', dailyKeys.every((key) => U.isValidDayKey(key)));
eq('daily 保留的是最新的 60 天（起点正确）', dailyKeys[0], U.todayKey(new Date(2026, 0, 41)));
eq('daily 保留的是最新的 60 天（终点正确）', dailyKeys[dailyKeys.length - 1], U.todayKey(new Date(2026, 0, 100)));
eq('daily correct 不会超过 quiz', dailyState.daily['2026-04-10'].correct, 3);
check('daily 状态通过校验', Storage.validate(dailyState).length === 0, Storage.validate(dailyState).join('; '));

const shuffledDaily = Storage.sanitize({
  daily: {
    '2026-09-13': { quiz: 1, correct: 1 },
    '2026-01-05': { quiz: 2, correct: 1 },
    '2026-05-20': { quiz: 3, correct: 0 },
  },
});
eq('乱序 daily 会被排序', Object.keys(shuffledDaily.daily).join(','), '2026-01-05,2026-05-20,2026-09-13');

section('存储校验');

/* ========== 7. 幽灵 ID 清理 ========== */

const ghostState = Storage.sanitize({
  selectedIds: ['guan-ju', 'ghost-1'],
  learnedIds: { 'guan-ju': 1, 'ghost-1': 2 },
  recents: [{ id: 'ghost-1', time: 5 }, { id: 'guan-ju', time: 6 }],
  quizStats: { total: 2, correct: 1, wrong: 1, byPoem: { 'ghost-1': { total: 1, correct: 1, wrong: 0 }, 'guan-ju': { total: 1, correct: 0, wrong: 1 } } },
  wrongBook: [{ id: 'ghost-1', time: 5, count: 1, mode: 'next' }, { id: 'guan-ju', time: 6, count: 2, mode: 'full' }],
});
const removedCount = Storage.pruneUnknownIds(ghostState, ['guan-ju']);
eq('幽灵 ID 全部被清理（selected/learned/recents/byPoem/wrongBook）', removedCount, 5);
eq('selectedIds 只留数据库里存在的 id', ghostState.selectedIds.join(','), 'guan-ju');
eq('learnedIds 清掉幽灵 id', Object.keys(ghostState.learnedIds).join(','), 'guan-ju');
eq('recents 清掉幽灵 id', ghostState.recents.map((item) => item.id).join(','), 'guan-ju');
eq('byPoem 清掉幽灵 id', Object.keys(ghostState.quizStats.byPoem).join(','), 'guan-ju');
eq('wrongBook 清掉幽灵 id', ghostState.wrongBook.map((item) => item.id).join(','), 'guan-ju');
check('清理后仍然通过校验', Storage.validate(ghostState).length === 0, Storage.validate(ghostState).join('; '));

const ghostPayload = JSON.stringify({
  version: 1,
  stage: '初中',
  selectedIds: ['guan-ju', 'ghost-x'],
  learnedIds: { 'ghost-x': 1 },
  recents: [{ id: 'ghost-x', time: 1 }],
  quizStats: { total: 0, correct: 0, wrong: 0, byPoem: { 'ghost-x': { total: 1, correct: 1, wrong: 0 } } },
  wrongBook: [{ id: 'ghost-x', time: 1, count: 1, mode: 'next' }],
  daily: {},
  prefs: { quizCount: 10, modes: ['abc'], autoNext: false, hideKeywords: false },
});
const loadSandbox = loadFiles(makeSandbox({ [Storage.KEY]: ghostPayload }), SCRIPT_ORDER);
const loaded = loadSandbox.PoetryStorage.load();
eq('load 之后幽灵 id 被清理', loaded.selectedIds.join(','), 'guan-ju');
eq('load 之后被清理的 id 不再出现在错题本', loaded.wrongBook.length, 0);
eq('load 之后非法 modes 被清理', loadSandbox.PoetryStorage.getState().prefs.modes.length, 0);
check('load 会把修正后的数据写回 localStorage',
  loadSandbox.localStorage.getItem(Storage.KEY).indexOf('ghost-x') === -1);
check('load 之后通过校验', loadSandbox.PoetryStorage.validate(loadSandbox.PoetryStorage.getState()).length === 0);

const corruptSandbox = loadFiles(makeSandbox({ [Storage.KEY]: '{"broken": tru' }), SCRIPT_ORDER);
corruptSandbox.PoetryStorage.load();
check('损坏 JSON 会重置并给出提示',
  corruptSandbox.PoetryStorage.getLoadIssue().length > 0 && corruptSandbox.PoetryStorage.getState().selectedIds.length === 0);

section('幽灵 ID');

/* ========== 8. 错题本 / 统计写入 ========== */

const store = loadFiles(makeSandbox(), SCRIPT_ORDER).PoetryStorage;
store.reset();
store.recordQuiz('guan-ju', false, 'next');
eq('第一次答错：错题次数 1', store.getState().wrongBook[0].count, 1);
eq('第一次答错：记录题型', store.getState().wrongBook[0].mode, 'next');
store.recordQuiz('guan-ju', false, 'full');
eq('第二次答错：次数累加到 2', store.getState().wrongBook[0].count, 2);
eq('第二次答错：题型更新为最新', store.getState().wrongBook[0].mode, 'full');
eq('第二次答错：错题本仍然只有一条', store.getState().wrongBook.length, 1);
store.recordQuiz('guan-ju', true, 'full');
eq('答对后整条错题记录被移除（产品设计）', store.getState().wrongBook.length, 0);
eq('答对后累计统计正确', store.getState().quizStats.correct, 1);
eq('答对后 byPoem 统计正确', store.getState().quizStats.byPoem['guan-ju'].total, 3);
eq('答对后 byPoem 的 wrong 计数保留历史', store.getState().quizStats.byPoem['guan-ju'].wrong, 2);
check('统计不变量保持', store.getState().quizStats.correct + store.getState().quizStats.wrong === store.getState().quizStats.total);
eq('今日统计累加', store.todayStats().quiz, 3);
eq('今日正确数累加', store.todayStats().correct, 1);
check('写入后通过校验', Storage.validate(store.getState()).length === 0, Storage.validate(store.getState()).join('; '));

store.addWrong('guan-ju', 'keyword');
eq('手动加入错题本', store.getState().wrongBook[0].count, 1);
store.removeWrong('guan-ju');
eq('手动移除错题本', store.getState().wrongBook.length, 0);

/* 题目级错题：同一篇目不同句子的记录互不覆盖，答对只移除当前题 */
const itemStore = loadFiles(makeSandbox(), SCRIPT_ORDER).PoetryStorage;
itemStore.reset();
itemStore.recordQuiz('guan-ju', false, 'next', { key: 'guan-ju|next|0|0', index: 0, pairIndex: 0 });
itemStore.recordQuiz('guan-ju', false, 'full', { key: 'guan-ju|full|1|s', index: 1, pairIndex: null });
eq('题目级错题记录两条', itemStore.getState().wrongItems.length, 2);
eq('篇目级汇总累计两次', itemStore.getState().wrongBook[0].count, 2);
itemStore.recordQuiz('guan-ju', true, 'next', { key: 'guan-ju|next|0|0', index: 0, pairIndex: 0 });
eq('答对只移除当前题', itemStore.getState().wrongItems.length, 1);
eq('答对后错题本仍保留另一句', itemStore.getState().wrongBook[0].count, 1);
eq('保留的是另一句的 key', itemStore.getState().wrongItems[0].key, 'guan-ju|full|1|s');
itemStore.recordQuiz('guan-ju', true, 'full', { key: 'guan-ju|full|1|s', index: 1, pairIndex: null });
eq('最后一条错题也被移除', itemStore.getState().wrongItems.length, 0);
check('题目级错题生命周期后仍通过校验', Storage.validate(itemStore.getState()).length === 0, Storage.validate(itemStore.getState()).join('; '));

itemStore.patch({ review: { 'guan-ju': { level: 0, due: U.todayKey(), lastTime: 1 } } });
eq('到期复习能取到今天该复习的篇目', itemStore.duePoemIds().join(','), 'guan-ju');
eq('复习条目被规范化', itemStore.reviewFor('guan-ju').level, 0);

/* 同一篇目同一天只升一级：避免一组题把间隔直接推到 30 天 */
const srsStore = loadFiles(makeSandbox(), SCRIPT_ORDER).PoetryStorage;
srsStore.reset();
srsStore.patch({
  review: {
    'guan-ju': { level: 1, due: U.addDaysKey(U.todayKey(), -1), lastTime: Date.now() - 86400000 },
  },
});
srsStore.recordQuiz('guan-ju', true, 'full');
eq('隔天答对升一级', srsStore.reviewFor('guan-ju').level, 2);
srsStore.recordQuiz('guan-ju', true, 'full');
eq('同一天连续答对不重复升级', srsStore.reviewFor('guan-ju').level, 2);
srsStore.recordQuiz('guan-ju', false, 'full');
eq('答错回到第 0 级', srsStore.reviewFor('guan-ju').level, 0);
itemStore.updatePrefs({ fontScale: 2, showTranslation: false });
eq('阅读偏好字号被保存', itemStore.getState().prefs.fontScale, 2);
eq('阅读偏好译文开关被保存', itemStore.getState().prefs.showTranslation, false);
check('阅读偏好修改后仍通过校验', Storage.validate(itemStore.getState()).length === 0, Storage.validate(itemStore.getState()).join('; '));

const exported = itemStore.exportData();
check('导出数据包含 schema 与 state', exported.schema === 3 && !!exported.state && exported.app === 'hison-poetry-recite');
const imported = itemStore.importData(exported);
check('导入导出往返成功', imported.ok && itemStore.getState().wrongItems.length === 0);

/* 选错 JSON 文件不能把现有进度静默替换成默认空数据。 */
const importSandbox = loadFiles(makeSandbox(), SCRIPT_ORDER);
const importStore = importSandbox.PoetryStorage;
importStore.patch({ stage: '初中', selectedIds: ['guan-ju'] });
importStore.recordQuiz('guan-ju', false, 'full');
const beforeImport = JSON.stringify(importStore.getState());
const beforeImportDisk = importSandbox.localStorage.getItem(importStore.KEY);
for (const invalid of [
  {}, { theme: 'dark' }, { state: {} },
  { app: 'another-app', schema: 2, state: exported.state },
  { app: 'hison-poetry-recite', schema: 4, state: exported.state },
  { ...exported.state, version: 4 },
]) {
  check('不可识别 / 不兼容备份被拒绝: ' + JSON.stringify(invalid).slice(0, 70), !importStore.importData(invalid).ok);
  eq('拒绝导入后内存学习数据不变', JSON.stringify(importStore.getState()), beforeImport);
  eq('拒绝导入后持久化学习数据不变', importSandbox.localStorage.getItem(importStore.KEY), beforeImportDisk);
}
check('兼容旧版原始学习数据导入', importStore.importData({ ...exported.state, version: 1 }).ok);
check('合法空白备份仍可导入', importStore.importData({ ...exported, state: importStore.defaults() }).ok);
eq('合法空白备份恢复空选择', importStore.getState().selectedIds.length, 0);

store.touchRecent('guan-ju');
store.touchRecent('jian-jia');
eq('最近学习：最新的排在最前', store.getState().recents[0].id, 'jian-jia');
eq('最近学习：不产生重复记录', store.getState().recents.length, 2);
store.markLearned('guan-ju');
check('markLearned 记录时间戳', typeof store.getState().learnedIds['guan-ju'] === 'number');

store.patch({ selectedIds: ['guan-ju', 'guan-ju', 5, null], prefs: { quizCount: 999, modes: ['abc', 'full'] } });
eq('patch 会去重 selectedIds', store.getState().selectedIds.join(','), 'guan-ju');
eq('patch 会规范化 quizCount', store.getState().prefs.quizCount, 30);
eq('patch 会过滤非法题型', store.getState().prefs.modes.join(','), 'full');

/* ========== 9. 出题逻辑 ========== */

const { unitsOf, buildQuestion, allCandidates, pickQuestions, questionFilterFn, resetLastBatch } = Quiz.__internals;
const guanCangHai = DB.byId('guan-cang-hai');
const jingNv = DB.byId('jing-nv');
const shiWu = DB.byId('shi-wu-cong-jun-zheng');
const allModeKeys = Quiz.MODES.map((mode) => mode.key);

check('unitsOf 能拆出整句与小句对', unitsOf(guanCangHai).length > 6);
check('unitsOf 的 unit 结构完整', unitsOf(guanCangHai).every((unit) => typeof unit.index === 'number' &&
  (Array.isArray(unit.clauses) || (typeof unit.left === 'string' && typeof unit.right === 'string'))));

const pairUnit = unitsOf(guanCangHai).find((unit) => unit.kind === 'pair');
const nextQuestion = buildQuestion(guanCangHai, pairUnit, 'next');
check('给上句写下句：提示上句、挖空下句', !!nextQuestion && nextQuestion.promptHtml.indexOf('□') !== -1);
eq('给上句写下句：答案 = 上句 + 下句', nextQuestion.answerText, pairUnit.left + pairUnit.right);
const prevQuestion = buildQuestion(guanCangHai, pairUnit, 'prev');
check('给下句写上句：挖空上句、保留后句', !!prevQuestion && prevQuestion.promptHtml.indexOf('□') !== -1 && prevQuestion.hint === '补出上句');
eq('整句 unit 不能生成 next/prev', buildQuestion(guanCangHai, unitsOf(guanCangHai)[0], 'next'), null);
eq('非法题型返回 null', buildQuestion(guanCangHai, unitsOf(guanCangHai)[0], 'unknown-mode'), null);
check('整句默写不泄露挖空提示', buildQuestion(guanCangHai, unitsOf(guanCangHai)[0], 'full').promptHtml.indexOf('□') === -1);
check('整句挖空保留方框提示', buildQuestion(guanCangHai, unitsOf(guanCangHai)[0], 'blank-full').promptHtml.indexOf('□□') !== -1);
check('关键词题型保留句首字', buildQuestion(guanCangHai, unitsOf(guanCangHai)[0], 'keyword').promptHtml.indexOf('东') !== -1);
const errataUnit = unitsOf(shiWu).find((unit) => /狗窦|雉|旅葵|羹/.test(unit.sentence));
check('随机挖空会命中易错字提示', !!errataUnit && buildQuestion(shiWu, errataUnit, 'mixed').hint.indexOf('易错字') !== -1);

/* 看译文写原文：译文来自题库逐句翻译，答案仍是原文 */
const sentenceUnit = unitsOf(guanCangHai).find((unit) => unit.kind === 'sentence');
const translationQuestion = buildQuestion(guanCangHai, sentenceUnit, 'translation');
const firstTranslation = guanCangHai.translations[sentenceUnit.index];
check('看译文写原文能生成题目', !!translationQuestion && translationQuestion.promptHtml.indexOf(U.escapeHtml(firstTranslation)) !== -1);
eq('看译文写原文的答案仍是原文', translationQuestion.answerText, sentenceUnit.sentence);
check('看译文写原文的 key 可定位到句子', /^guan-cang-hai\|translation\|\d+\|s$/.test(translationQuestion.key));
eq('重点句范围只出 examFocus 句', allCandidates([guanCangHai], ['full'], questionFilterFn('exam')).length, guanCangHai.examFocus.length);
check('名句范围只出名句句', allCandidates([guanCangHai], ['full'], questionFilterFn('name')).length > 0);
const preferred = pickQuestions([guanCangHai], { count: 3, modes: ['full'], preferKeys: ['guan-cang-hai|full|0|s'] });
eq('错题原题优先排在最前', preferred[0].key, 'guan-cang-hai|full|0|s');

const singlePoemCandidates = allCandidates([guanCangHai], allModeKeys).length;
check('候选题目数量大于 0', singlePoemCandidates > 0);
eq('要求 60 题但素材不足时只返回真实上限', pickQuestions([guanCangHai], { count: 60, modes: allModeKeys }).length, Math.min(60, singlePoemCandidates));
eq('单篇目 + 只给 full：题目数 = 句子数', pickQuestions([guanCangHai], { count: 30, modes: ['full'] }).length, U.splitSentences(guanCangHai.text).length);

allModeKeys.forEach((mode) => {
  const list = pickQuestions([guanCangHai, jingNv], { count: 30, modes: [mode] });
  check(`只给题型 ${mode} 时全部为该题型`, list.length > 0 && list.every((question) => question.mode === mode), list.length + ' 题');
});

const multi = pickQuestions([guanCangHai, jingNv, shiWu], { count: 30, modes: allModeKeys });
eq('多篇目 30 题数量正确', multi.length, 30);
eq('30 题内部没有重复 key', new Set(multi.map((question) => question.key)).size, 30);
check('30 题的篇目都在给定范围内', multi.every((question) => [guanCangHai.id, jingNv.id, shiWu.id].includes(question.poemId)));

const wrongModes = pickQuestions([guanCangHai], { count: 5, modes: ['abc', '123'] });
check('非法题型按随机组合处理且不报错', wrongModes.length === 5 && wrongModes.every((question) => allModeKeys.includes(question.mode)));

eq('count 非法时回落到 10 题', pickQuestions([guanCangHai, jingNv, shiWu], { count: NaN, modes: allModeKeys }).length, 10);
eq('count 超过 60 时被截断', pickQuestions([guanCangHai, jingNv, shiWu], { count: 999, modes: allModeKeys }).length, 60);

/* 确定性随机源：同样的 seed 必然得到同样的批次，避免 flaky test */
function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}
function batchKeys(seed) {
  sandbox.__POETRY_RANDOM__ = seededRandom(seed);
  resetLastBatch();
  return pickQuestions([guanCangHai, jingNv, shiWu], { count: 20, modes: allModeKeys }).map((question) => question.key).join(',');
}
const batchA = batchKeys(20260913);
const batchASecond = batchKeys(20260913);
const batchB = batchKeys(42);
eq('相同随机种子得到完全相同的批次', batchA, batchASecond);
check('不同随机种子得到不同批次', batchA !== batchB);

sandbox.__POETRY_RANDOM__ = seededRandom(7);
resetLastBatch();
const firstBatch = pickQuestions([guanCangHai, jingNv, shiWu], { count: 10, modes: allModeKeys }).map((question) => question.key);
const secondBatch = pickQuestions([guanCangHai, jingNv, shiWu], { count: 10, modes: allModeKeys }).map((question) => question.key);
check('换一批不会和上一批重复（素材充足时）', secondBatch.every((key) => !firstBatch.includes(key)), secondBatch.slice(0, 3).join(','));
delete sandbox.__POETRY_RANDOM__;

check('题目 key 包含篇目 / 题型 / 句序（可用于判重）', /^[a-z0-9-]+\|[a-z-]+\|\d+\|(s|\d+)$/.test(multi[0].key), multi[0].key);

section('出题逻辑');

/* ========== 10. 纯离线 & 版本一致性 ========== */

const runtimeFiles = [
  'js/utils.js', 'js/brand.js', 'js/storage.js', 'js/study.js', 'js/quiz.js', 'js/worksheet.js', 'js/app.js', 'js/pwa.js',
  'data/metadata.js', 'data/database.js', 'assets/styles.css', 'index.html',
];
const runtimeSources = runtimeFiles.map((file) => [file, readFileSync(join(root, file), 'utf8')]);
const networkPatterns = [/\bfetch\s*\(/, /XMLHttpRequest/, /WebSocket/, /sendBeacon/, /\bimport\s*\(/];
runtimeSources.forEach(([file, code]) => {
  networkPatterns.forEach((pattern) => {
    check(`${file} 不含运行时联网调用 (${pattern})`, !pattern.test(code));
  });
});
check('index.html 没有远程资源引用（页脚里的 GitHub 链接不算资源）',
  !/<(?:script|link|img|iframe|source)[^>]+(?:src|href)="(?:https?:)?\/\//.test(indexHtml));
check('运行时不依赖远程字体 / 图片', !/url\(\s*['"]?(?:https?:)?\/\//.test(readFileSync(join(root, 'assets', 'styles.css'), 'utf8')));

/* 页脚版本号下方的 GitHub 仓库链接（单一来源：metadata.brand.repo） */
const repo = Meta.brand && Meta.brand.repo;
check('metadata 里配置了 GitHub 仓库', !!repo && /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/.test(repo.url), repo ? repo.url : '(缺失)');
const brandCode = readFileSync(join(root, 'js', 'brand.js'), 'utf8');
check('brand.js 会把仓库链接渲染到页脚', brandCode.indexOf('bf-repo') !== -1 && brandCode.indexOf('repoInfo') !== -1);
const brandSandbox = makeSandbox();
['data/metadata.js', 'js/utils.js', 'js/brand.js'].forEach((file) => {
  vm.runInContext(readFileSync(join(root, file), 'utf8'), brandSandbox, { filename: file });
});
eq('brand.js 能从 metadata 读到仓库地址',
  brandSandbox.PoetryBrand.repoUrl ? brandSandbox.PoetryBrand.repoUrl() : '', repo.url);

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
eq('package.json 与 metadata.js 版本一致', pkg.version, Meta.version);
const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
eq('package-lock.json 版本与 package.json 一致', lock.version, pkg.version);
const readme = readFileSync(join(root, 'README.md'), 'utf8');
check('README 记录当前版本', readme.includes('v' + pkg.version));
check('README 题库总数与真实数据一致', readme.includes(`**${all.length} 篇（段）**`));

section('离线与版本');

section('新增：输入对照、句子复习与落盘状态');
check('输入对照忽略空白标点', Quiz.compareAnswer('关关 雎鸠。','关关雎鸠').correct);
const diff=Quiz.compareAnswer('关关雎鸟','关关雎鸠');
check('错字对照显示删除和补入', !diff.correct && diff.html.includes('<del>鸟</del>') && diff.html.includes('<ins>鸠</ins>'));
check('输入 HTML 被转义', !Quiz.compareAnswer('<script>','a').html.includes('<script>'));
Storage.reset();
Storage.recordQuiz('guan-ju',false,'full',{key:'guan-ju|full|0|s',index:0,pairIndex:null});
const card=Storage.getState().sentenceReview['guan-ju|full|0|s'];
check('答题建立句子复习卡', card && card.poemId==='guan-ju' && card.level===0);
card.due=U.todayKey();
check('到期句子可精确重练', Storage.dueSentenceKeys().includes('guan-ju|full|0|s'));
const savedCards=Storage.exportData();
Storage.reset();
check('新版备份恢复句子复习卡', Storage.importData(savedCards).ok && !!Storage.getState().sentenceReview['guan-ju|full|0|s']);
const originalWrite=sandbox.localStorage.setItem;
sandbox.localStorage.setItem=()=>{throw new Error('quota');};
check('配额不足时明确报告仅内存状态', Storage.save()===false && !Storage.isPersistent());
sandbox.localStorage.setItem=originalWrite;
check('重试成功恢复持久化状态', Storage.save() && Storage.isPersistent());

/* ========== 输出 ========== */

console.log(`unit checks: ${passed} passed, ${failed} failed`);
if (failures.length) {
  failures.forEach((item) => console.log('  ✗ ' + item));
  process.exitCode = 1;
} else {
  console.log('  ✓ 全部通过');
}
