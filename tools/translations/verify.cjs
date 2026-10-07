/* 校验翻译批次产出：node tools/translations/verify.cjs
   逐篇核对 data/translations/in（原文句子）与 data/translations/poems（译文）：
   篇目齐全、顺序对位、translations.length === sentences.length、无空译文 / 占位符 / 换行。 */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', '..');
const inDir = path.join(root, 'data', 'translations', 'in');
const outDir = path.join(root, 'data', 'translations', 'poems');

const files = fs.readdirSync(inDir).filter((f) => /^batch-\d+\.json$/.test(f)).sort();
let totalPoems = 0;
let totalSentences = 0;
const errors = [];
const warns = [];

for (const file of files) {
  const input = JSON.parse(fs.readFileSync(path.join(inDir, file), 'utf8'));
  const outPath = path.join(outDir, file);
  if (!fs.existsSync(outPath)) { errors.push(`${file}: 缺少产出文件`); continue; }
  let output;
  try {
    output = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  } catch (err) {
    errors.push(`${file}: JSON 解析失败 ${err.message}`);
    continue;
  }
  const map = new Map();
  (output.poems || []).forEach((p) => {
    if (!p || typeof p.id !== 'string') { errors.push(`${file}: 存在缺少 id 的条目`); return; }
    if (map.has(p.id)) errors.push(`${file}: id 重复 ${p.id}`);
    map.set(p.id, p.translations);
  });

  for (const poem of input.poems) {
    totalPoems += 1;
    totalSentences += poem.sentences.length;
    const tr = map.get(poem.id);
    if (!tr) { errors.push(`${file}: 缺少篇目 ${poem.id}（${poem.title}）`); continue; }
    if (!Array.isArray(tr)) { errors.push(`${file}: ${poem.id} translations 不是数组`); continue; }
    if (tr.length !== poem.sentences.length) {
      errors.push(`${file}: ${poem.id}（${poem.title}）句数不匹配 原文 ${poem.sentences.length} / 译文 ${tr.length}`);
      continue;
    }
    tr.forEach((line, i) => {
      const where = `${file}: ${poem.id}[${i}] «${poem.sentences[i]}»`;
      if (typeof line !== 'string' || !line.trim()) { errors.push(`${where} 译文为空`); return; }
      if (/[\r\n\t]/.test(line)) errors.push(`${where} 译文含换行/制表符`);
      if (/[□]/.test(line)) errors.push(`${where} 译文含占位符 □`);
      if (/[A-Za-z]/.test(line)) warns.push(`${where} 译文含拉丁字母`);
      if (line === poem.sentences[i]) errors.push(`${where} 译文与原文完全相同`);
      if (line.length > 120) warns.push(`${where} 译文偏长（${line.length} 字）`);
      if (line.length < 2) warns.push(`${where} 译文过短（${line.length} 字）`);
    });
  }
  const extra = [...map.keys()].filter((id) => !input.poems.some((p) => p.id === id));
  if (extra.length) errors.push(`${file}: 多出篇目 ${extra.join(',')}`);
}

console.log(`批次 ${files.length}｜篇目 ${totalPoems}｜句数 ${totalSentences}`);
console.log(`ERROR ${errors.length}｜WARN ${warns.length}`);
errors.slice(0, 40).forEach((m) => console.log('  ✗ ' + m));
warns.slice(0, 20).forEach((m) => console.log('  ⚠ ' + m));
if (errors.length) process.exitCode = 1;
