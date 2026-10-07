/* 重新生成翻译批次的可核查输入文件
   运行：node tools/translations/rebuild-input.cjs

   背景：data/translations/poems/batch-NN.json 是每个批次的译文产出（篇目 id + translations），
   本脚本按同一批篇目顺序，从题库正文重新切句生成 data/translations/in/batch-NN.json，
   供人工 / AI 核对“第 k 条译文是否对应第 k 句原文”。 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..', '..');
const transDir = path.join(root, 'data', 'translations');
const poemsDir = path.join(transDir, 'poems');
const inDir = path.join(transDir, 'in');

// 1) 读题库
const sb = { console, window: null };
sb.window = sb;
vm.createContext(sb);
for (const f of ['data/metadata.js', 'data/junior.js', 'data/senior.js', 'js/utils.js', 'data/database.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), sb, { filename: f });
}
const DB = sb.PoetryDatabase;
const U = sb.PoetryUtils;

// 2) 按产出文件里的篇目顺序重建输入
fs.mkdirSync(inDir, { recursive: true });
const files = fs.readdirSync(poemsDir).filter((f) => /^batch-\d+\.json$/.test(f)).sort();
let poems = 0;
let sentences = 0;
for (const file of files) {
  const out = JSON.parse(fs.readFileSync(path.join(poemsDir, file), 'utf8'));
  const payload = { batch: Number(/(\d+)/.exec(file)[1]), poems: [] };
  for (const entry of out.poems) {
    const poem = DB.byId(entry.id);
    if (!poem) throw new Error(`${file}: 题库里没有 ${entry.id}`);
    const list = U.splitSentences(poem.text);
    if (list.length !== entry.translations.length) {
      throw new Error(`${file}: ${entry.id} 译文 ${entry.translations.length} 条 ≠ 原文 ${list.length} 句`);
    }
    payload.poems.push({
      id: poem.id,
      title: poem.title,
      author: poem.author,
      dynasty: poem.dynasty,
      stage: poem.stage,
      genre: poem.genre,
      sentences: list,
    });
    poems += 1;
    sentences += list.length;
  }
  fs.writeFileSync(path.join(inDir, file), JSON.stringify(payload, null, 2), 'utf8');
}
console.log(`输入文件重建完成：${files.length} 批 / ${poems} 篇 / ${sentences} 句`);
