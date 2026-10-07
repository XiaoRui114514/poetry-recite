/* 导出「考试重点 + 中心思想」待填清单（维护工具，只读题库，不改任何数据）
   运行：node tools/meta/export.cjs [--out <文件>] [--split] [--batch <每批篇数>] [--rebuild]

   产物：meta/poems.json（默认）
      [
        {
          "id": "guan-cang-hai",
          "title": "观沧海", "author": "曹操", "dynasty": "东汉",
          "stage": "初中", "grade": "七年级", "genre": "诗",
          "sentences": ["东临碣石，以观沧海。", ...],   // 已按 Utils.splitSentences 切好，下标即 examFocus.index
          "summary": "",                              // 待填：中心思想 / 主旨
          "examFocus": []                             // 待填：[{ index, reason }]
        }
      ]

   --split         按 --batch 拆成 meta/batches/batch-NN.json，方便分批人工 / AI 填写
   --rebuild       不保留旧文件内容，直接用题库现有的 summary / examFocus 覆盖
                   （在直接改过题库之后用它把维护文件同步回最新状态） */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..', '..');
const args = process.argv.slice(2);
const outFile = args.includes('--out') ? path.resolve(args[args.indexOf('--out') + 1]) : path.join(root, 'meta', 'poems.json');
const batchSize = args.includes('--batch') ? Number(args[args.indexOf('--batch') + 1]) : 0;
const split = args.includes('--split');
const rebuild = args.includes('--rebuild');

const sb = { console, window: null };
sb.window = sb;
vm.createContext(sb);
for (const f of ['data/metadata.js', 'data/junior.js', 'data/senior.js', 'js/utils.js', 'data/database.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), sb, { filename: f });
}
const DB = sb.PoetryDatabase;
const U = sb.PoetryUtils;

// 已填过的内容保留下来，避免重跑导出时把人工成果清空
const existing = new Map();
if (fs.existsSync(outFile)) {
  try {
    const prev = JSON.parse(fs.readFileSync(outFile, 'utf8'));
    (Array.isArray(prev) ? prev : prev.poems || []).forEach((item) => existing.set(item.id, item));
  } catch (err) {
    console.warn('已有 ' + path.relative(root, outFile) + ' 解析失败，将重新生成：' + err.message);
  }
}

const poems = DB.all().map((poem) => {
  const prev = existing.get(poem.id) || {};
  // --rebuild：以题库里的实际值为准；否则保留旧文件里已填的内容，避免重跑时清空人工成果
  const useDb = rebuild;
  return {
    id: poem.id,
    title: poem.title,
    author: poem.author,
    dynasty: poem.dynasty,
    stage: poem.stage,
    grade: poem.grade,
    genre: poem.genre,
    sourceType: poem.sourceType,
    required: poem.required,
    sentences: U.splitSentences(poem.text),
    summary: useDb ? poem.summary : (typeof prev.summary === 'string' ? prev.summary : ''),
    examFocus: useDb
      ? poem.examFocus.map((item) => ({ index: item.index, reason: item.reason }))
      : (Array.isArray(prev.examFocus) ? prev.examFocus : []),
  };
});

/* 完整清单始终写出（inject-meta 读的就是它）；--split 额外再拆出分批文件。
   两者都来自同一份 poems，所以不会出现「清单与批次不同步」。 */
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(poems, null, 2), 'utf8');
const filled = poems.filter((p) => p.summary && p.examFocus.length).length;
console.log(`已导出 ${poems.length} 篇到 ${path.relative(root, outFile)}（已填写 ${filled} 篇，共 ${poems.reduce((sum, p) => sum + p.sentences.length, 0)} 句）`);

if (split && batchSize > 0) {
  const dir = path.join(path.dirname(outFile), 'batches');
  fs.mkdirSync(dir, { recursive: true });
  let count = 0;
  for (let i = 0; i < poems.length; i += batchSize) {
    const name = 'batch-' + String(Math.floor(i / batchSize) + 1).padStart(2, '0') + '.json';
    const slice = poems.slice(i, i + batchSize);
    fs.writeFileSync(
      path.join(dir, name),
      JSON.stringify({ poems: slice.map((p) => ({ id: p.id, title: p.title, author: p.author, stage: p.stage, grade: p.grade, genre: p.genre, sentences: p.sentences })) }, null, 2),
      'utf8'
    );
    count += 1;
  }
  console.log(`已拆分 ${count} 个批次（每批 ${batchSize} 篇）到 ${path.relative(root, dir)}`);
}
