/* 抽查篇目正文：node tools/qa-text.cjs <篇目id> [更多id...] */
const fs = require('fs');
const vm = require('vm');
const sb = { console, window: null };
sb.window = sb;
vm.createContext(sb);
for (const f of ['data/metadata.js', 'data/junior.js', 'data/senior.js', 'js/utils.js', 'data/database.js']) {
  vm.runInContext(fs.readFileSync(f, 'utf8'), sb, { filename: f });
}
const DB = sb.PoetryDatabase;
const ids = process.argv.slice(2);
for (const id of ids) {
  const p = DB.byId(id);
  if (!p) { console.log('未找到:', id); continue; }
  console.log('====', p.id, '|', p.title, '|', p.author, '|', p.dynasty, '|', p.stage, p.grade, '|', p.sourceType);
  console.log(p.text);
  console.log('');
}
