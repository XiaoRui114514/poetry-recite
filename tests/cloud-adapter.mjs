/* Synthetic fixtures only: adapter whitelist, legacy migration, failure atomicity. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const root = new URL('../', import.meta.url);
const data = new Map();
let options;
let changed;
let failWrites = false;
const sandbox = {
  console, Date, JSON, Math,
  location: { protocol: 'https:' },
  document: { readyState: 'complete', querySelector: () => ({}) },
  localStorage: {
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => { if (failWrites) throw Error('quota'); data.set(key, value); },
    removeItem: key => data.delete(key)
  },
  addEventListener: (name, listener) => { if (name === 'poetry-storage') changed = listener; },
  dispatchEvent: () => {}, CustomEvent: class {},
  LearningCloud: { start: value => { options = value; return {}; } },
};
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const file of ['js/utils.js','data/junior.js','data/senior.js','data/database.js','js/storage.js']) {
  vm.runInContext(readFileSync(new URL(file, root), 'utf8'), sandbox, {filename:file});
}
const storage = sandbox.PoetryStorage;
const original = storage.defaults();
original.stage = '初中';
original.selectedIds = ['guan-cang-hai'];
original.learnedIds = {'guan-cang-hai': 123456789};
original.wrongBook = [{id:'guan-cang-hai',time:123456789,count:2,mode:'next'}];
delete original.wrongItems;
original.version = 1;
// The unchanged legacy key is loaded before the optional adapter starts.
data.set(storage.KEY, JSON.stringify(original));
storage.load();
vm.runInContext(readFileSync(new URL('js/cloud-adapter.js',root),'utf8'),sandbox);
assert.equal(options.app, 'poetry');
assert.equal(storage.KEY, 'ruishao-poetry-study-v1');
assert.equal(options.getData().learnedIds['guan-cang-hai'],123456789);
assert.equal(options.getData().wrongItems[0].key,'legacy|guan-cang-hai');
assert.equal(storage.validate(options.getData()).length,0);
assert.equal(options.isEmpty(options.defaults()),true);
assert.equal(options.isEmpty(options.getData()),false);
storage.patch({apiKey:'synthetic-never-upload',privateNote:'synthetic-never-upload'});
assert.equal(JSON.stringify(options.getData()).includes('synthetic-never-upload'),false);
const before = JSON.stringify(storage.getState());
assert.throws(() => options.setData({wrongApplication:true}));
assert.equal(JSON.stringify(storage.getState()),before);
assert.throws(() => options.setData({...options.getData(),version:999}));
assert.equal(JSON.stringify(storage.getState()),before);
options.subscribe(() => {});
assert.equal(typeof changed,'function');
options.setData(options.defaults());
assert.equal(options.isEmpty(options.getData()),true);
assert.equal(data.has(storage.KEY),true);
failWrites = true;
assert.throws(() => options.setData(options.defaults()),/空间不足/);
console.log('cloud adapter: legacy key/schema migration, whitelist, unsupported payload preservation, storage failure checks passed');
