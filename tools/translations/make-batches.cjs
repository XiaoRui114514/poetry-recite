/* 把题库按 Utils.splitSentences 切句后分成若干批，生成逐句翻译的输入清单。
   运行：node tools/translations/make-batches.cjs <每批句数>
   产物：data/translations/in/batch-XX.json（可核查的“第 k 句原文”清单） */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..', '..');
const sb = { console, window: null };
sb.window = sb;
vm.createContext(sb);
for (const f of ['data/metadata.js', 'data/junior.js', 'data/senior.js', 'js/utils.js', 'data/database.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), sb, { filename: f });
}
const DB = sb.PoetryDatabase;
const U = sb.PoetryUtils;
const all = DB.all();

const PER_BATCH = Number(process.argv[2] || 170);

const poems = all.map((p) => ({
  id: p.id,
  title: p.title,
  author: p.author,
  dynasty: p.dynasty,
  stage: p.stage,
  genre: p.genre,
  sentences: U.splitSentences(p.text),
}));

// 按句数降序 + 蛇形分配，保证每批工作量接近
const ordered = poems.slice().sort((a, b) => b.sentences.length - a.sentences.length);
const batches = [];
let total = 0;
ordered.forEach((poem) => { total += poem.sentences.length; });
const batchCount = Math.max(1, Math.ceil(total / PER_BATCH));
for (let i = 0; i < batchCount; i += 1) batches.push([]);
ordered.forEach((poem, index) => {
  // 蛇形：0,1,2,...,n-1,n-1,...,2,1,0
  const cycle = Math.floor(index / batchCount);
  let slot = index % batchCount;
  if (cycle % 2 === 1) slot = batchCount - 1 - slot;
  batches[slot].push(poem);
});
batches.forEach((list) => list.sort((a, b) => a.id.localeCompare(b.id)));

const outDir = path.join(root, 'data', 'translations', 'in');
fs.mkdirSync(outDir, { recursive: true });
batches.forEach((list, index) => {
  const name = 'batch-' + String(index + 1).padStart(2, '0') + '.json';
  const payload = {
    batch: index + 1,
    poems: list.map((poem) => ({
      id: poem.id,
      title: poem.title,
      author: poem.author,
      dynasty: poem.dynasty,
      stage: poem.stage,
      genre: poem.genre,
      sentences: poem.sentences,
    })),
  };
  fs.writeFileSync(path.join(outDir, name), JSON.stringify(payload, null, 2), 'utf8');
  const count = list.reduce((sum, poem) => sum + poem.sentences.length, 0);
  console.log(name, '篇目', list.length, '句数', count);
});
console.log('合计篇目', poems.length, '句数', total, '批数', batchCount);
