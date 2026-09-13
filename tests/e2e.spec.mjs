/* 端到端测试：覆盖“选择学段 → 勾选篇目 → 全文学习 → 默写自测 → 进度持久化”完整流程。
   运行：npx playwright test */
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const CONSOLE_IGNORE = [/favicon/i];
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

/* 期望值直接从真实数据文件算出来，不写死数字：
   题库更新后测试会跟着变，不会出现“测试还停留在旧数据上却通过”的情况。 */
function sourceCounts() {
  const sandbox = { console: { warn() {} }, window: null };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  for (const file of ['data/metadata.js', 'data/junior.js', 'data/senior.js']) {
    vm.runInContext(readFileSync(join(root, file), 'utf8'), sandbox, { filename: file });
  }
  const junior = sandbox.POETRY_JUNIOR;
  const senior = sandbox.POETRY_SENIOR;
  const gradesOf = (poem) => (Array.isArray(poem.grades) && poem.grades.length ? poem.grades : [poem.grade]);
  const countGrades = (list, grades) => list.filter((poem) => grades.some((grade) => gradesOf(poem).includes(grade))).length;
  const countQuery = (list, query) => list.filter((poem) => {
    const grades = gradesOf(poem);
    if (query.grade && !query.grade.some((grade) => grades.includes(grade))) return false;
    if (query.genre && !query.genre.includes(poem.genre)) return false;
    if (query.sourceType && !query.sourceType.includes(poem.sourceType)) return false;
    return true;
  }).length;
  return {
    junior: junior.length,
    senior: senior.length,
    juniorRequired: junior.filter((poem) => poem.required).length,
    seniorRequired: senior.filter((poem) => poem.required).length,
    juniorSixGrade: junior.filter((poem) => poem.grade === '六年级').length,
    juniorSevenGrade: countGrades(junior, ['七年级']),
    juniorGrade: (grades) => countGrades(junior, grades),
    seniorModule: (modules) => countGrades(senior, modules),
    juniorGenre: (genres) => countQuery(junior, { genre: genres }),
    juniorSource: (sources) => countQuery(junior, { sourceType: sources }),
    juniorQuery: (query) => countQuery(junior, query),
    juniorSixShanghai: junior.filter((poem) => poem.grade === '六年级' && poem.sourceType === '上海地区').length,
    firstJuniorId: junior[0].id,
    unselectedJuniorId: junior.find((poem) => poem.id !== 'guan-ju' && poem.id !== 'jian-jia').id,
  };
}
const COUNTS = sourceCounts();

function watchErrors(page) {
  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (CONSOLE_IGNORE.some((re) => re.test(text))) return;
    errors.push('console: ' + text);
  });
  page.on('pageerror', (err) => errors.push('pageerror: ' + err.message));
  page.on('requestfailed', (req) => {
    const url = req.url();
    if (CONSOLE_IGNORE.some((re) => re.test(url))) return;
    errors.push('requestfailed: ' + url + ' ' + (req.failure()?.errorText || ''));
  });
  return errors;
}

async function gotoFresh(page, hash = '') {
  await page.goto('/index.html' + hash);
  await page.evaluate(() => {
    localStorage.clear();
    // 默认跳过首次访问的授权弹窗，弹窗本身由专门的用例覆盖
    localStorage.setItem('hison-poetry-notice-v1', '1');
  });
  await page.goto('/index.html' + hash);
}

async function chooseStage(page, stage = '初中') {
  await page.locator(`[data-stage="${stage}"]`).click();
  await expect(page.locator('.section-title').first()).toHaveText('请选择要背诵的篇目');
}

async function selectPoems(page, titles) {
  for (const title of titles) {
    await page.locator('.poem-card', { hasText: title }).first().click();
  }
}

/** 关掉“首次访问授权说明”弹窗（单文件版 file:// 场景下会真实弹出） */
async function dismissLicense(page) {
  const overlay = page.locator('.brand-overlay');
  try {
    await overlay.waitFor({ state: 'visible', timeout: 2500 });
  } catch (err) {
    return; // 没有弹窗（用户已授权过）
  }
  const ok = page.locator('[data-brand="ok"]');
  if (await ok.count()) await ok.click();
  else await page.keyboard.press('Escape');
  await expect(overlay).toHaveCount(0);
}

test('首次打开显示学段选择页，且控制台无报错', async ({ page }) => {
  const errors = watchErrors(page);
  await gotoFresh(page);

  await expect(page.locator('.app-title')).toHaveText('上海初高古诗文背诵');
  await expect(page.locator('.stage-card')).toHaveCount(2);
  await expect(page.locator('[data-stage="初中"]')).toContainText(`共 ${COUNTS.junior} 篇`);
  await expect(page.locator('[data-stage="高中"]')).toContainText(`共 ${COUNTS.senior} 篇`);
  await expect(page.locator('.bf-brand')).toContainText('Hison');
  expect(errors, errors.join('\n')).toEqual([]);
});

test('首页不再出现“题库 184 篇 / 6 种默写题型”这类标签墙与步骤说明', async ({ page }) => {
  await gotoFresh(page);
  await expect(page.locator('.hero-title')).toHaveText('选好篇目，一句一句背下来');
  await expect(page.locator('.hero-chips')).toHaveCount(0);
  await expect(page.locator('.hero-flow')).toHaveCount(0);
  await expect(page.locator('#viewRoot')).not.toContainText('1 选学段');
  await expect(page.locator('#viewRoot')).not.toContainText('6 种默写题型');
  // 学段卡片本身仍有数量信息，信息不丢
  await expect(page.locator('.stage-card').first()).toContainText(`共 ${COUNTS.junior} 篇`);
});

test('初中：搜索、筛选、多选、全选与取消全选', async ({ page }) => {
  const errors = watchErrors(page);
  await gotoFresh(page);
  await chooseStage(page, '初中');

  // 搜索作者
  await page.fill('#poemSearch', '李白');
  const libaiWorks = ['行路难（其一）', '闻王昌龄左迁龙标遥有此寄', '峨眉山月歌', '春夜洛城闻笛', '送友人'];
  await expect(page.locator('.poem-card')).toHaveCount(libaiWorks.length);
  const titles = await page.locator('.poem-card .poem-title').allInnerTexts();
  expect(titles.every((t) => libaiWorks.includes(t))).toBe(true);

  // 清空搜索 + 年级筛选
  await page.click('[data-action="clear-search"]');
  await page.click('[data-filter="grade"][data-value="六年级"]');
  await expect(page.locator('.poem-card')).toHaveCount(COUNTS.juniorSixGrade);

  // 来源筛选
  await page.click('[data-filter="sourceType"][data-value="上海地区"]');
  await expect(page.locator('.poem-card')).toHaveCount(COUNTS.juniorSixShanghai);

  // 回到全部并多选
  await page.click('[data-filter="grade"][data-value=""]');
  await page.click('[data-filter="sourceType"][data-value=""]');
  await selectPoems(page, ['关雎', '蒹葭', '观沧海']);
  await expect(page.locator('.select-summary')).toHaveText('已选择 3 篇');
  await expect(page.locator('.selected-chip')).toHaveCount(3);

  // 取消其中一篇
  await page.locator('.poem-card', { hasText: '蒹葭' }).first().click();
  await expect(page.locator('.select-summary')).toHaveText('已选择 2 篇');

  // 取消全选
  await page.click('[data-action="select-none"]');
  await expect(page.locator('.select-summary')).toHaveText('已选择 0 篇');

  // 全选当前结果（六年级 6 篇）
  await page.click('[data-filter="grade"][data-value="六年级"]');
  await page.click('[data-action="select-all"]');
  await expect(page.locator('.select-summary')).toHaveText(`已选择 ${COUNTS.juniorSixGrade} 篇`);

  // 只选课标必背（60 篇）
  await page.click('[data-filter="grade"][data-value=""]');
  await page.click('[data-action="select-none"]');
  await page.click('[data-action="select-required"]');
  await expect(page.locator('.select-summary')).toHaveText(`已选择 ${COUNTS.juniorRequired} 篇`);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('进入学习后可返回，且选择与进度在刷新后保留', async ({ page }) => {
  const errors = watchErrors(page);
  await gotoFresh(page);
  await chooseStage(page, '高中');
  await page.click('[data-action="select-required"]');
  await page.click('[data-action="start"]');

  await expect(page.locator('.section-title').first()).toContainText('高中背诵工作台');
  await expect(page.locator('.stat-box').first()).toContainText(`0 / ${COUNTS.seniorRequired}`);

  await page.reload();
  await expect(page.locator('.section-title').first()).toContainText('高中背诵工作台');
  await expect(page.locator('.header-meta')).toContainText(`已选 ${COUNTS.seniorRequired} 篇`);

  // 返回选择页
  await page.click('#headerBack');
  await expect(page.locator('.section-title').first()).toHaveText('请选择要背诵的篇目');
  expect(errors, errors.join('\n')).toEqual([]);
});

test('全文学习：逐句隐藏/显示、关键词隐藏、上一句下一句', async ({ page }) => {
  const errors = watchErrors(page);
  await gotoFresh(page);
  await chooseStage(page, '初中');
  await page.click('[data-action="select-none"]');
  await selectPoems(page, ['观沧海']);
  await page.click('[data-action="start"]');
  await page.click('[data-action="study"]');

  await expect(page.locator('.poem-head h2')).toHaveText('观沧海');
  await expect(page.locator('.poem-byline')).toContainText('曹操');
  const lines = page.locator('.line-item');
  await expect(lines).toHaveCount(6);
  await expect(lines.first()).toContainText('东临碣石，以观沧海。');

  // 点击句子 → 隐藏
  await lines.first().click();
  await expect(lines.first()).toContainText('□□□□，□□□□。');
  await lines.first().click();
  await expect(lines.first()).toContainText('东临碣石，以观沧海。');

  // 逐句隐藏 + 关键词隐藏
  await page.click('[data-action="hide-all"]');
  await expect(page.locator('.line-item.is-hidden')).toHaveCount(6);
  await page.click('[data-action="toggle-keyword"]');
  await expect(page.locator('.line-item').first()).toContainText('东□□□，以□□□。');

  // 显示全部
  await page.click('[data-action="reveal-all"]');
  await expect(page.locator('.line-item.is-hidden')).toHaveCount(0);

  // 上一句 / 下一句
  await page.click('[data-action="next-line"]');
  await page.click('[data-action="next-line"]');
  await expect(page.locator('.line-item.is-active')).toContainText('水何澹澹，山岛竦峙。');
  await page.click('[data-action="prev-line"]');
  await expect(page.locator('.line-item.is-active')).toContainText('东临碣石，以观沧海。');

  // 已学习标记
  await expect(page.locator('.badge', { hasText: '已学习' })).toHaveCount(1);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('默写自测：生成题目、展开答案、判分、错题本、换一批', async ({ page }) => {
  const errors = watchErrors(page);
  await gotoFresh(page);
  await chooseStage(page, '初中');
  await page.click('[data-action="select-none"]');
  await selectPoems(page, ['关雎', '蒹葭', '观沧海', '次北固山下']);
  await page.click('[data-action="start"]');
  await page.click('[data-action="quiz"]');

  const cards = page.locator('.quiz-card');
  await expect(cards).toHaveCount(10);
  await expect(cards.first().locator('.answer-wrapper')).not.toHaveClass(/show/);

  // 单题展开 / 收起
  await cards.first().locator('.btn-eye').click();
  await expect(cards.first().locator('.answer-wrapper')).toHaveClass(/show/);
  await cards.first().locator('.btn-eye').click();
  await expect(cards.first().locator('.answer-wrapper')).not.toHaveClass(/show/);

  // 显示全部 / 隐藏全部
  await page.click('[data-action="toggle-all"]');
  await expect(page.locator('.answer-wrapper.show')).toHaveCount(10);
  await page.click('[data-action="toggle-all"]');
  await expect(page.locator('.answer-wrapper.show')).toHaveCount(0);

  // 判分：答对 1 题
  await cards.first().locator('[data-action="mark-right"]').click();
  await expect(page.locator('#quizCounter')).toContainText('已作答 1 题');
  await expect(cards.first().locator('.badge', { hasText: '答对' })).toHaveCount(1);

  // 答错 → 进错题本
  await cards.nth(1).locator('[data-action="mark-wrong"]').click();
  await page.click('#headerBack');
  await page.click('[data-action="progress"]');
  await expect(page.locator('.progress-item', { hasText: '错 ' })).toHaveCount(1);
  await expect(page.locator('.stat-box').nth(1)).toContainText('2');

  // 错题再练
  await page.click('[data-practice]');
  await expect(page.locator('#quizList .quiz-card')).not.toHaveCount(0);

  // 换一批题目：用 data-key 比较（题干文字可能重名，key 才是真实身份）
  const firstKeys = await page.locator('.quiz-card').evaluateAll((cards) => cards.map((card) => card.getAttribute('data-key')));
  await page.click('[data-action="generate"]');
  await expect(page.locator('.quiz-card')).toHaveCount(10);
  const afterKeys = await page.locator('.quiz-card').evaluateAll((cards) => cards.map((card) => card.getAttribute('data-key')));
  expect(afterKeys.length).toBe(10);
  expect(afterKeys.some((key) => firstKeys.includes(key))).toBe(false);

  expect(errors, errors.join('\n')).toEqual([]);
});

test('题型开关：只保留“整句默写”时全部为该题型', async ({ page }) => {
  await gotoFresh(page);
  await chooseStage(page, '初中');
  await page.click('[data-action="select-none"]');
  await selectPoems(page, ['观沧海', '天净沙·秋思']);
  await page.click('[data-action="start"]');
  await page.click('[data-action="quiz"]');

  for (const key of ['blank-full', 'next', 'prev', 'keyword', 'mixed']) {
    await page.uncheck(`[data-mode="${key}"]`);
  }
  await page.check('[data-mode="full"]');
  await page.click('[data-action="generate"]');
  const modeLabels = await page.locator('.quiz-card .mode-badge').allInnerTexts();
  expect(modeLabels.length).toBeGreaterThan(0);
  expect(modeLabels.every((t) => t === '整句默写')).toBe(true);
});

test('练习题量切换与清空本轮', async ({ page }) => {
  await gotoFresh(page);
  await chooseStage(page, '初中');
  await page.click('[data-action="select-required"]');
  await page.click('[data-action="start"]');
  await page.click('[data-action="quiz"]');

  await page.click('[data-count="5"]');
  await page.click('[data-action="generate"]');
  await expect(page.locator('.quiz-card')).toHaveCount(5);

  await page.click('[data-count="20"]');
  await page.click('[data-action="generate"]');
  await expect(page.locator('.quiz-card')).toHaveCount(20);

  await page.click('[data-action="clear"]');
  await expect(page.locator('.quiz-card')).toHaveCount(0);
  await expect(page.locator('#quizList')).toContainText('还没有题目');
});

test('只选一篇也能正常学习与出题', async ({ page }) => {
  const errors = watchErrors(page);
  await gotoFresh(page);
  await chooseStage(page, '高中');
  await page.click('[data-action="select-none"]');
  await selectPoems(page, ['静女']);
  await page.click('[data-action="start"]');
  await page.click('[data-action="quiz"]');
  const singleCards = page.locator('.quiz-card');
  const singleCount = await singleCards.count();
  expect(singleCount).toBeGreaterThanOrEqual(6);
  const texts = await singleCards.allInnerTexts();
  expect(texts.every((t) => t.includes('《静女》'))).toBe(true);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('长文言文（滕王阁序）不出错且题目可读', async ({ page }) => {
  const errors = watchErrors(page);
  await gotoFresh(page);
  await chooseStage(page, '高中');
  await page.click('[data-action="select-none"]');
  await page.fill('#poemSearch', '滕王阁序');
  await selectPoems(page, ['滕王阁序']);
  await page.click('[data-action="start"]');
  await page.click('[data-action="study"]');
  await expect(page.locator('.line-item')).not.toHaveCount(0);
  await page.click('[data-action="hide-all"]');
  await expect(page.locator('.line-item.is-hidden')).not.toHaveCount(0);
  await page.click('[data-action="reveal-all"]');
  await expect(page.locator('.poem-body')).toContainText('落霞与孤鹜齐飞，秋水共长天一色。');
  expect(errors, errors.join('\n')).toEqual([]);
});

test('篇名含括号、词牌名与特殊标点显示正常', async ({ page }) => {
  await gotoFresh(page);
  await chooseStage(page, '高中');
  await page.click('[data-action="select-none"]');
  await page.fill('#poemSearch', '论语');
  await selectPoems(page, ['《论语》十二章']);
  await page.click('[data-action="start"]');
  await page.click('[data-action="study"]');
  await expect(page.locator('.poem-head h2')).toHaveText('《论语》十二章');
  await page.click('[data-action="toggle-keyword"]');
  await expect(page.locator('.poem-body')).toContainText('《诗》');
  await expect(page.locator('.line-item').first()).toContainText('子□');

  await page.click('#headerBack');
  await page.click('[data-action="to-select"]');
  await expect(page.locator('.section-title').first()).toHaveText('请选择要背诵的篇目');
  await page.click('#headerBack');
  await chooseStage(page, '初中');
  await page.click('[data-action="select-none"]');
  await page.fill('#poemSearch', '水调歌头');
  await selectPoems(page, ['水调歌头（明月几时有）']);
  await page.click('[data-action="start"]');
  await page.click('[data-action="study"]');
  await expect(page.locator('.poem-head h2')).toHaveText('水调歌头（明月几时有）');
  await expect(page.locator('.poem-body')).toContainText('但愿人长久，千里共婵娟。');
});

test('localStorage 被清空 / 数据异常时页面仍能打开', async ({ page }) => {
  const errors = watchErrors(page);
  const KEY = 'ruishao-poetry-study-v1';

  await page.goto('/index.html');
  await page.evaluate((key) => localStorage.setItem(key, '{"broken": tru'), KEY);
  await page.reload();
  await expect(page.locator('.stage-card')).toHaveCount(2);

  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('.stage-card')).toHaveCount(2);

  await page.evaluate(
    (key) => localStorage.setItem(key, JSON.stringify({ selectedIds: {}, quizStats: 'x', wrongBook: 'oops', stage: 42, prefs: 'nope' })),
    KEY,
  );
  await page.reload();
  await expect(page.locator('.stage-card')).toHaveCount(2);
  await expect(page.locator('.header-meta')).toBeEmpty();
  expect(errors, errors.join('\n')).toEqual([]);
});

test('清空本地数据后刷新不会卡在空的学习页', async ({ page }) => {
  await gotoFresh(page);
  await chooseStage(page, '初中');
  await page.click('[data-action="select-none"]');
  await selectPoems(page, ['观沧海']);
  await page.click('[data-action="start"]');
  await page.click('[data-action="quiz"]');
  await expect(page.locator('.quiz-card')).not.toHaveCount(0);

  // 模拟用户手动清空浏览器数据后刷新
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('.stage-card')).toHaveCount(2);
});

test('题库为空时给出提示且不报错', async ({ page }) => {
  await page.route('**/data/junior.js', (route) => route.fulfill({ contentType: 'text/javascript', body: 'window.POETRY_JUNIOR = [];' }));
  await page.route('**/data/senior.js', (route) => route.fulfill({ contentType: 'text/javascript', body: 'window.POETRY_SENIOR = [];' }));
  const errors = watchErrors(page);
  await page.goto('/index.html');
  await expect(page.locator('#viewRoot')).toContainText('题库为空');
  expect(errors, errors.join('\n')).toEqual([]);
});

test('重置本地数据会清空选择与错题', async ({ page }) => {
  await gotoFresh(page);
  await chooseStage(page, '初中');
  await page.click('[data-action="select-none"]');
  await selectPoems(page, ['观沧海']);
  await page.click('[data-action="start"]');
  await page.click('[data-action="quiz"]');
  await page.locator('.quiz-card').first().locator('[data-action="mark-wrong"]').click();
  await page.click('#headerBack');
  await page.click('[data-action="progress"]');
  page.once('dialog', (dialog) => dialog.accept());
  await page.click('[data-action="reset"]');
  await expect(page.locator('.stage-card')).toHaveCount(2);
  await chooseStage(page, '初中');
  await expect(page.locator('.select-summary')).toHaveText('已选择 0 篇');
});

test('单文件版（dist）可直接用 file:// 打开', async ({ page }) => {
  const errors = watchErrors(page);
  const fileUrl = new URL('../dist/上海初高古诗文背诵.html', import.meta.url).href;
  await page.goto(fileUrl);
  await expect(page.locator('.app-title')).toHaveText('上海初高古诗文背诵');
  await dismissLicense(page);
  await page.locator('[data-stage="初中"]').click();
  await expect(page.locator('.poem-card')).not.toHaveCount(0);
  await page.locator('.poem-card').first().click();
  await page.click('[data-action="start"]');
  await expect(page.locator('.section-title').first()).toContainText('初中背诵工作台');
  expect(errors, errors.join('\n')).toEqual([]);
});

test('模块化版本也能直接用 file:// 打开（无需服务器）', async ({ page }) => {
  const errors = watchErrors(page);
  const fileUrl = new URL('../index.html', import.meta.url).href;
  await page.goto(fileUrl);
  await expect(page.locator('.app-title')).toHaveText('上海初高古诗文背诵');
  await expect(page.locator('.stage-card')).toHaveCount(2);
  await dismissLicense(page);
  await page.locator('[data-stage="高中"]').click();
  await expect(page.locator('.poem-card')).not.toHaveCount(0);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('所有页面按钮都有明确功能，没有“死按钮”', async ({ page }) => {
  const known = [
    '#headerBack',
    '#themeToggle',
    '[data-brand]',
    '[data-action]',
    '[data-stage]',
    '[data-poem]',
    '[data-remove]',
    '[data-filter]',
    '[data-study]',
    '[data-practice]',
    '[data-remove-wrong]',
    '[data-safe]',
    '[data-line]',
    '[data-hint]',
    '[data-mode]',
    '[data-count]',
    '[data-scope]',
  ];

  async function collectDeadButtons(label) {
    const dead = await page.evaluate((selectors) => {
      const buttons = [...document.querySelectorAll('button')];
      return buttons
        .filter((btn) => {
          if (btn.hidden || btn.disabled) return false;
          return !selectors.some((selector) => btn.matches(selector) || btn.closest(selector));
        })
        .map((btn) => (btn.textContent || '').trim().slice(0, 20));
    }, known);
    expect(dead, `${label} 存在没有绑定功能的按钮：` + dead.join(' / ')).toEqual([]);
  }

  await gotoFresh(page);
  await collectDeadButtons('学习阶段页');

  await chooseStage(page, '初中');
  await collectDeadButtons('篇目选择页');
  await page.click('[data-action="select-required"]');
  await collectDeadButtons('篇目选择页（有选中）');

  await page.click('[data-action="start"]');
  await collectDeadButtons('工作台');

  await page.click('[data-action="study"]');
  await collectDeadButtons('全文学习');

  await page.click('#headerBack');
  await page.click('[data-action="quiz"]');
  await collectDeadButtons('默写自测');

  await page.click('#headerBack');
  await page.click('[data-action="progress"]');
  await collectDeadButtons('我的进度');
});

test('页面中文编码正确，标题与正文没有乱码', async ({ page }) => {
  await gotoFresh(page);
  await expect(page.locator('.app-title')).toHaveText('上海初高古诗文背诵');
  const charset = await page.evaluate(() => document.characterSet);
  expect(charset.toLowerCase()).toBe('utf-8');

  await chooseStage(page, '初中');
  await page.fill('#poemSearch', '观沧海');
  await selectPoems(page, ['观沧海']);
  await page.click('[data-action="start"]');
  await page.click('[data-action="study"]');
  await expect(page.locator('.poem-body')).toContainText('东临碣石，以观沧海。');
  await expect(page.locator('.poem-body')).toContainText('水何澹澹，山岛竦峙。');
  await expect(page.locator('.poem-body')).not.toContainText('�');
});

test('深色模式：跟随系统、手动切换并记住选择', async ({ page }) => {
  const errors = watchErrors(page);

  // 跟随系统（无本地记录时）
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('#themeToggle')).toHaveText('☀️');

  // 手动切回浅色并刷新，选择要保留
  await page.click('#themeToggle');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  // 再切到深色，刷新后仍然生效
  await page.click('#themeToggle');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('#themeToggle')).toHaveText('☀️');

  // 深色模式下关键流程仍然可用
  await page.locator('[data-stage="初中"]').click();
  await page.locator('.poem-card', { hasText: '观沧海' }).first().click();
  await page.click('[data-action="start"]');
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent').toBe(true);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('作者品牌层：页脚署名、印章账号与首次授权弹窗', async ({ page }) => {
  const errors = watchErrors(page);

  // 首次访问：自动弹出授权说明
  await page.goto('/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  const overlay = page.locator('.brand-overlay');
  await expect(overlay).toBeVisible();
  await expect(overlay).toContainText('Hison 制作');
  await expect(overlay).toContainText('XRuiiiiii');
  await expect(overlay).toContainText('xiaoruiaaa520');
  await page.click('[data-brand="ok"]');
  await expect(overlay).toHaveCount(0);

  // 页脚署名
  await expect(page.locator('.bf-brand')).toContainText('Hison');
  await expect(page.locator('.bf-brand')).toContainText('XRuiiiiii');
  await expect(page.locator('.bf-ver')).toContainText('v' + pkg.version);

  // 首页品牌标签（点击可打开授权说明）
  await expect(page.locator('.brand-chip')).toContainText('Hison');

  // 右下角印章：点击展开账号
  await page.click('[data-brand="seal"] .bs-face');
  await expect(page.locator('[data-brand="seal"]')).toHaveClass(/on/);
  await expect(page.locator('[data-brand="seal"]')).toContainText('抖音');
  await expect(page.locator('[data-brand="seal"]')).toContainText('小红书');
  await page.click('.hero-title');
  await expect(page.locator('[data-brand="seal"]')).not.toHaveClass(/on/);

  // 鼠标移到右下角水印上：胶囊原地展开成署名卡片（无图标）；移开自动收起
  const viewport = page.viewportSize();
  const seal = page.locator('[data-brand="seal"]');
  await page.mouse.move(10, 10); // 先离开水印，等收起动画结束再测量
  await expect.poll(async () => (await seal.boundingBox()).height, '水印应先收回成小胶囊').toBeLessThan(60);
  const before = await seal.boundingBox();
  expect(before.width).toBeGreaterThan(before.height); // 默认是小胶囊
  await expect(page.locator('[data-brand="seal"] .bs-stamp')).toHaveCount(0); // 不再有图标
  await page.hover('[data-brand="seal"]');
  await expect(page.locator('[data-brand="seal"] .bs-panel')).toBeVisible();
  await expect(page.locator('[data-brand="seal"] .bs-panel')).toContainText('XRuiiiiii');
  await expect.poll(async () => (await seal.boundingBox()).width, '悬停后应展开成卡片').toBeGreaterThanOrEqual(150);
  const after = await seal.boundingBox();
  expect(after.height).toBeGreaterThan(before.height + 20);
  await expect(page.locator('[data-brand="seal"] .bs-face')).toContainText('by Hison');
  // 卡片仍然贴着右下角（留 24px 容差）
  expect(viewport.width - (after.x + after.width)).toBeLessThanOrEqual(24);
  expect(viewport.height - (after.y + after.height)).toBeLessThanOrEqual(24);
  await page.hover('.hero-title');
  await expect(page.locator('[data-brand="seal"] .bs-panel')).toBeHidden();
  await expect
    .poll(async () => {
      const box = await seal.boundingBox();
      return box.width < 120;
    }, '移开鼠标后应恢复成小胶囊')
    .toBe(true);

  // 再次访问不再自动弹窗
  await page.reload();
  await expect(page.locator('.brand-overlay')).toHaveCount(0);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('正文带有作者隐形指纹，可在复制文本中反查', async ({ page }) => {
  await gotoFresh(page);
  await chooseStage(page, '初中');
  await page.click('[data-action="select-none"]');
  await selectPoems(page, ['观沧海']);
  await page.click('[data-action="start"]');
  await page.click('[data-action="study"]');

  const decoded = await page.evaluate(() => {
    const text = document.getElementById('poemBody').textContent;
    return {
      hasZeroWidth: text.indexOf('\u2060') !== -1,
      decoded: window.PoetryBrand.inspect(text),
      identity: window.PoetryBrand.identity(),
    };
  });
  expect(decoded.hasZeroWidth).toBe(true);
  expect(decoded.decoded).toContain('Hison');
  expect(decoded.decoded).toContain('XRuiiiiii');
  expect(decoded.identity.tag).toBe('Hison 制作');

  // 默写答案里同样带有指纹
  await page.click('#headerBack');
  await page.click('[data-action="quiz"]');
  const answerDecoded = await page.evaluate(() => {
    const el = document.querySelector('.answer-text');
    return window.PoetryBrand.inspect(el.textContent);
  });
  expect(answerDecoded).toContain('xiaoruiaaa520');
});

test('错题「再练一次」只练该篇，且不会虚增错误次数', async ({ page }) => {
  const errors = watchErrors(page);
  await gotoFresh(page);
  await chooseStage(page, '初中');
  await page.click('[data-action="select-none"]');
  await selectPoems(page, ['观沧海', '关雎']);
  await page.click('[data-action="start"]');
  await page.click('[data-action="quiz"]');

  // 先答错一题，让它进错题本
  await page.locator('.quiz-card').first().locator('[data-action="mark-wrong"]').click();
  await page.click('#headerBack');
  await page.click('[data-action="progress"]');
  const wrongRow = page.locator('.progress-item', { hasText: '错 ' });
  await expect(wrongRow).toContainText('错 1 次');
  const wrongTitle = (await wrongRow.locator('.pi-main > div').first().innerText()).trim();

  // 再练一次 → 只出这一篇的题
  await page.click('[data-practice]');
  await expect(page.locator('[data-scope="focus"]')).toHaveClass(/active/);
  const poems = await page.locator('.quiz-card .badge-primary').allInnerTexts();
  expect(poems.length).toBeGreaterThan(0);
  expect(new Set(poems).size).toBe(1);
  expect(poems[0]).toContain(wrongTitle);

  // 打开练习本身不算答错：错误次数保持 1
  await page.click('#headerBack');
  await page.click('[data-action="progress"]');
  await expect(page.locator('.progress-item', { hasText: '错 ' })).toContainText('错 1 次');
  expect(errors, errors.join('\n')).toEqual([]);
});

test('同一题重复判分不会重复计分', async ({ page }) => {
  await gotoFresh(page);
  await chooseStage(page, '初中');
  await page.click('[data-action="select-none"]');
  await selectPoems(page, ['观沧海']);
  await page.click('[data-action="start"]');
  await page.click('[data-action="quiz"]');

  const card = page.locator('.quiz-card').first();
  await card.locator('[data-action="mark-right"]').click();
  await expect(card.locator('[data-action="mark-right"]')).toBeDisabled();
  await expect(card.locator('[data-action="mark-wrong"]')).toBeDisabled();
  // 绕过 disabled 再触发一次，统计仍然只记一次
  await card.locator('[data-action="mark-right"]').dispatchEvent('click');
  await expect(page.locator('#quizCounter')).toContainText('已作答 1 题');

  await page.click('#headerBack');
  await page.click('[data-action="progress"]');
  await expect(page.locator('.stat-box').nth(1).locator('.stat-num')).toHaveText('1');
  await expect(page.locator('.stat-box').nth(3).locator('.stat-num')).toHaveText('1');
});

test('「整句默写」只给篇目与句序，不泄露挖空提示', async ({ page }) => {
  await gotoFresh(page);
  await chooseStage(page, '初中');
  await page.click('[data-action="select-none"]');
  await selectPoems(page, ['观沧海']);
  await page.click('[data-action="start"]');
  await page.click('[data-action="quiz"]');

  for (const key of ['blank-full', 'next', 'prev', 'keyword', 'mixed']) {
    await page.uncheck(`[data-mode="${key}"]`);
  }
  await page.check('[data-mode="full"]');
  await page.click('[data-action="generate"]');

  const question = page.locator('.quiz-card .question-text').first();
  await expect(question).toContainText('请默写本篇第');
  await expect(question).not.toContainText('□');
  await page.locator('.quiz-card').first().locator('.btn-eye').click();
  await expect(page.locator('.answer-text').first()).not.toBeEmpty();
});

test('畸形链接与不存在的篇目不会让页面崩溃', async ({ page }) => {
  const errors = watchErrors(page);
  await gotoFresh(page);
  await chooseStage(page, '初中');
  await page.click('[data-action="select-none"]');
  await selectPoems(page, ['观沧海']);
  await page.click('[data-action="start"]');

  await page.goto('/index.html#/study?poem=%');
  await expect(page.locator('#viewRoot')).not.toContainText('页面渲染出现异常');
  await expect(page.locator('.poem-head h2')).toHaveText('观沧海');

  await page.goto('/index.html#/study?poem=' + encodeURIComponent('不存在的篇目'));
  await expect(page.locator('#viewRoot')).not.toContainText('页面渲染出现异常');
  await expect(page.locator('.poem-head h2')).toHaveText('观沧海');
  expect(errors, errors.join('\n')).toEqual([]);
});

test('学习页边界：空 poem / 未选中 / 跨学段 / 非法编码都落到已选篇目，且不会误标记已学习', async ({ page }) => {
  const errors = watchErrors(page);
  await gotoFresh(page);
  await chooseStage(page, '初中');
  await page.click('[data-action="select-none"]');
  await selectPoems(page, ['关雎']);
  await page.click('[data-action="start"]');

  const cases = [
    '#/study',
    '#/study?poem=',
    '#/study?poem=' + encodeURIComponent(COUNTS.unselectedJuniorId),
    '#/study?poem=jing-nv',
    '#/study?poem=%',
    '#/study?poem=' + encodeURIComponent('不存在的篇目'),
  ];
  for (const hash of cases) {
    await page.goto('/index.html' + hash);
    await page.reload();
    await expect(page.locator('.poem-head h2'), hash).toHaveText('关雎');
    const learned = await page.evaluate(() => Object.keys(window.PoetryStorage.getState().learnedIds).sort());
    expect(learned, `${hash}: 只能把已选中的篇目标记为已学习`).toEqual(['guan-ju']);
  }
  expect(errors, errors.join('\n')).toEqual([]);
});

test('切换页面后回到顶部，不会停在上一页的滚动位置', async ({ page }) => {
  await gotoFresh(page);
  await chooseStage(page, '高中');
  await page.click('[data-action="select-none"]');
  await page.fill('#poemSearch', '滕王阁序');
  await selectPoems(page, ['滕王阁序']);
  await page.click('[data-action="start"]');
  await page.click('[data-action="study"]');

  await page.evaluate(() => window.scrollTo(0, 1500));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(1500);
  await page.click('#headerBack');
  await expect(page.locator('.section-title').first()).toContainText('高中背诵工作台');
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

/* ================= 第二轮审计新增用例 ================= */

test('无效的“只练这一篇”链接（不存在 / 非法转义 / 未选中 / 跨学段）都会回到全部已选篇目', async ({ page }) => {
  const errors = watchErrors(page);
  await gotoFresh(page);
  await chooseStage(page, '初中');
  await page.click('[data-action="select-none"]');
  await selectPoems(page, ['关雎', '蒹葭']);
  await page.click('[data-action="start"]');

  const selectedTitles = ['关雎', '蒹葭'];

  async function expectFallbackToAll(label, hash) {
    // 每次都整页重新加载：hash 相同文档导航不会重新挂载视图，直接 goto 会读到上一个用例的状态
    await page.goto('/index.html' + hash);
    await page.reload();
    const state = await page.evaluate(() => window.PoetryQuiz.currentState());
    expect(state.focusPoemId, `${label}: focusPoemId 必须清空`).toBe('');
    expect(state.scope, `${label}: scope 必须回退 all`).toBe('all');
    await expect(page.locator('[data-scope="all"]'), `${label}: “全部已选篇目”应处于选中态`).toHaveClass(/active/);
    await expect(page.locator('[data-scope="focus"]')).toHaveCount(0);
    const badges = await page.locator('.quiz-card .badge-primary').allInnerTexts();
    expect(badges.length, label).toBeGreaterThan(0);
    expect(badges.every((text) => selectedTitles.some((title) => text.includes(title))), label).toBe(true);
  }

  await expectFallbackToAll('不存在的篇目', '#/quiz?poem=' + encodeURIComponent('不存在的篇目'));
  await expectFallbackToAll('非法 URI 转义', '#/quiz?poem=%');
  await expectFallbackToAll('未选中的有效篇目', '#/quiz?poem=' + encodeURIComponent(COUNTS.unselectedJuniorId));
  await expectFallbackToAll('跨学段的篇目', '#/quiz?poem=jing-nv');

  // 选中范围内的篇目仍然可以正常聚焦
  await page.goto('/index.html#/quiz?poem=' + encodeURIComponent('guan-ju'));
  await page.reload();
  const focused = await page.evaluate(() => window.PoetryQuiz.currentState());
  expect(focused.focusPoemId).toBe('guan-ju');
  expect(focused.scope).toBe('focus');
  await expect(page.locator('[data-scope="focus"]')).toHaveClass(/active/);

  // 同一个视图内直接改地址栏（不刷新页面）也必须重新校验 focus
  await page.goto('/index.html#/quiz?poem=' + encodeURIComponent(COUNTS.unselectedJuniorId));
  const changed = await page.evaluate(() => window.PoetryQuiz.currentState());
  expect(changed.focusPoemId).toBe('');
  expect(changed.scope).toBe('all');
  expect(errors, errors.join('\n')).toEqual([]);
});

test('素材不足时如实提示“最多可生成 X 题”，不再假装生成用户要求的数量', async ({ page }) => {
  const errors = watchErrors(page);
  await gotoFresh(page);
  await chooseStage(page, '初中');
  await page.click('[data-action="select-none"]');
  await selectPoems(page, ['观沧海']);
  await page.click('[data-action="start"]');
  await page.click('[data-action="quiz"]');

  // 只保留“整句默写”并要求 30 题：观沧海只有 6 句
  for (const key of ['blank-full', 'next', 'prev', 'keyword', 'mixed']) {
    await page.uncheck(`[data-mode="${key}"]`);
  }
  await page.check('[data-mode="full"]');
  const sentences = await page.evaluate(() => window.PoetryUtils.splitSentences(window.PoetryDatabase.byId('guan-cang-hai').text).length);
  await page.click('[data-count="30"]');
  await page.click('[data-action="generate"]');

  await expect(page.locator('.quiz-card')).toHaveCount(sentences);
  await expect(page.locator('#quizNotice')).toContainText(`当前条件最多可生成 ${sentences} 题`);
  await expect(page.locator('#quizNotice')).toContainText(`本次生成 ${sentences} / 30 题`);
  await expect(page.locator('#quizCounter')).toContainText(`本轮 ${sentences} 题`);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('localStorage 里的幽灵 ID 会被自动清理，进度显示按当前有效篇目计算', async ({ page }) => {
  const errors = watchErrors(page);
  const KEY = 'ruishao-poetry-study-v1';
  await page.goto('/index.html');
  await page.evaluate(
    ({ key, poemId, otherId }) => {
      localStorage.clear();
      localStorage.setItem('hison-poetry-notice-v1', '1');
      localStorage.setItem(
        key,
        JSON.stringify({
          version: 1,
          stage: '初中',
          selectedIds: [poemId, 'ghost-999'],
          // 另一个 id 是题库里真实存在、但当前没被选中的篇目：不该计入“已学习”显示
          learnedIds: { 'ghost-999': 1, [poemId]: 2, [otherId]: 3 },
          recents: [{ id: 'ghost-999', time: 1 }, { id: poemId, time: 2 }],
          quizStats: { total: 1, correct: 1, wrong: 0, byPoem: { 'ghost-999': { total: 1, correct: 1, wrong: 0, lastTime: 1 } } },
          wrongBook: [{ id: 'ghost-999', time: 1, count: 3, mode: 'next' }],
          daily: { '2026-09-12': { quiz: 4, correct: 2 } },
          prefs: { quizCount: 10, modes: ['full'], autoNext: false, hideKeywords: false },
        }),
      );
    },
    { key: KEY, poemId: COUNTS.firstJuniorId, otherId: COUNTS.unselectedJuniorId },
  );
  await page.reload();

  await expect(page.locator('.header-meta')).toContainText('已选 1 篇');
  const state = await page.evaluate(() => window.PoetryStorage.getState());
  expect(state.selectedIds).toEqual([COUNTS.firstJuniorId]);
  expect(state.wrongBook).toEqual([]);
  expect(Object.keys(state.quizStats.byPoem)).toEqual([]);
  expect(state.recents.map((item) => item.id)).toEqual([COUNTS.firstJuniorId]);
  expect(state.learnedIds['ghost-999']).toBeUndefined();
  expect(state.learnedIds[COUNTS.unselectedJuniorId]).toBe(3);

  // 页面不崩溃：工作台 → 进度页仍然可用
  await page.click('[data-action="progress"]');
  await expect(page.locator('.section-title').first()).toHaveText('我的进度');
  // 已学习计数只统计“当前已选中的有效篇目”，不统计未选中 / 幽灵篇目
  await expect(page.locator('.stat-box').first()).toContainText(`1 / 1`);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('损坏的统计（correct 大于 total）会被自动修正，正确率不会超过 100%', async ({ page }) => {
  const errors = watchErrors(page);
  const KEY = 'ruishao-poetry-study-v1';
  await page.goto('/index.html');
  await page.evaluate(
    ({ key, poemId }) => {
      localStorage.clear();
      localStorage.setItem('hison-poetry-notice-v1', '1');
      localStorage.setItem(
        key,
        JSON.stringify({
          version: 1,
          stage: '初中',
          selectedIds: [poemId],
          learnedIds: { [poemId]: 1 },
          recents: [{ id: poemId, time: 1 }],
          quizStats: { total: 1, correct: 5, wrong: 0, byPoem: { [poemId]: { total: 1, correct: 9, wrong: 0, lastTime: 1 } } },
          wrongBook: [],
          daily: { '2026-01-01': { quiz: 2, correct: 9 } },
          prefs: { quizCount: 10, modes: [], autoNext: false, hideKeywords: false },
        }),
      );
    },
    { key: KEY, poemId: COUNTS.firstJuniorId },
  );
  await page.reload();

  const state = await page.evaluate(() => window.PoetryStorage.getState());
  expect(state.quizStats.correct + state.quizStats.wrong).toBe(state.quizStats.total);
  expect(state.quizStats.correct / state.quizStats.total).toBeLessThanOrEqual(1);
  expect(state.daily['2026-01-01'].correct).toBeLessThanOrEqual(state.daily['2026-01-01'].quiz);

  await page.click('[data-action="progress"]');
  const accuracy = await page.locator('.stat-box').nth(2).locator('.stat-num').innerText();
  expect(accuracy).toBe('100%');
  expect(errors, errors.join('\n')).toEqual([]);
});

test('快速连续点击：换一批、展开答案、判分、切换篇目都不会重复计分或状态错乱', async ({ page }) => {
  const errors = watchErrors(page);
  await gotoFresh(page);
  await chooseStage(page, '初中');
  await page.click('[data-action="select-none"]');
  await selectPoems(page, ['观沧海', '关雎']);
  await page.click('[data-action="start"]');
  await page.click('[data-action="quiz"]');

  // 连续点击“换一批”三次：题目数量必须还是一次生成的数量
  await page.evaluate(() => {
    const button = document.querySelector('[data-action="generate"]');
    button.click();
    button.click();
    button.click();
  });
  await expect(page.locator('.quiz-card')).toHaveCount(10);
  const keys = await page.locator('.quiz-card').evaluateAll((cards) => cards.map((card) => card.getAttribute('data-key')));
  expect(new Set(keys).size).toBe(10);

  // 连续点击 6 次眼睛按钮：偶数次后答案应回到隐藏状态
  await page.evaluate(() => {
    const eye = document.querySelector('.quiz-card .btn-eye');
    for (let i = 0; i < 6; i += 1) eye.click();
  });
  await expect(page.locator('.quiz-card').first().locator('.answer-wrapper')).not.toHaveClass(/show/);

  // 连续两次判分（第二次点击发生在 disabled 之后，统计只能 +1）
  const card = page.locator('.quiz-card').first();
  await card.locator('[data-action="mark-right"]').click();
  await card.locator('[data-action="mark-right"]').dispatchEvent('click');
  await expect(page.locator('#quizCounter')).toContainText('已作答 1 题');

  // 快速切换篇目选择 5 次：状态与 localStorage 保持一致
  await page.click('#headerBack');
  await page.click('[data-action="to-select"]');
  await page.evaluate(() => {
    for (let i = 0; i < 5; i += 1) {
      const element = [...document.querySelectorAll('.poem-card')].find((card) => card.textContent.includes('观沧海'));
      if (element) element.click();
    }
  });
  const selected = await page.evaluate(() => window.PoetryStorage.getState().selectedIds);
  expect(selected).not.toContain('guan-cang-hai');
  expect(selected).toContain('guan-ju');
  expect(new Set(selected).size).toBe(selected.length);
  await expect(page.locator('.select-summary')).toHaveText('已选择 1 篇');

  // 快速输入搜索：结果数量必须和数据库真实命中数一致（防抖不能丢最后一次输入）
  const expected = await page.evaluate(() => window.PoetryDatabase.query({ stage: '初中', keyword: '李白' }).length);
  await page.locator('#poemSearch').pressSequentially('李白', { delay: 5 });
  await expect(page.locator('.poem-card')).toHaveCount(expected);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('主题：localStorage 记录损坏时跟随系统，theme-color 同步更新', async ({ page }) => {
  const errors = watchErrors(page);
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/index.html');
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('hison-poetry-notice-v1', '1');
    localStorage.setItem('hison-poetry-theme', 'purple');
  });
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#0b1020');
  await expect(page.locator('#themeToggle')).toHaveText('☀️');

  await page.click('#themeToggle');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#f4f7ff');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#f4f7ff');
  expect(errors, errors.join('\n')).toEqual([]);
});

test('错题本完整生命周期：连续答错累加、答对后移除、从链接直接进入', async ({ page }) => {
  const errors = watchErrors(page);
  await gotoFresh(page);
  await chooseStage(page, '初中');
  await page.click('[data-action="select-none"]');
  await selectPoems(page, ['观沧海', '关雎']);
  await page.click('[data-action="start"]');
  await page.click('[data-action="quiz"]');

  await page.locator('.quiz-card').first().locator('[data-action="mark-wrong"]').click();
  await page.click('#headerBack');
  await page.click('[data-action="progress"]');
  const row = page.locator('.progress-item', { hasText: '错 ' });
  await expect(row).toContainText('错 1 次');
  const wrongTitle = (await row.locator('.pi-main > div').first().innerText()).trim();

  // 再练一次 → 只出该篇 → 再答错一次，次数累加
  await page.click('[data-practice]');
  await expect(page.locator('.quiz-card .badge-primary').first()).toContainText(wrongTitle);
  await page.locator('.quiz-card').first().locator('[data-action="mark-wrong"]').click();
  await page.click('#headerBack');
  await page.click('[data-action="progress"]');
  await expect(page.locator('.progress-item', { hasText: '错 ' })).toContainText('错 2 次');

  // 再练一次 → 答对 → 整条错题记录移除（产品设计：答对即认为已经掌握）
  await page.click('[data-practice]');
  await page.locator('.quiz-card').first().locator('[data-action="mark-right"]').click();
  await page.click('#headerBack');
  await page.click('[data-action="progress"]');
  await expect(page.locator('.progress-item', { hasText: '错 ' })).toHaveCount(0);
  await expect(page.locator('.section-title', { hasText: '错题本（0）' })).toHaveCount(1);

  // 直接通过链接进入错误篇目，同样只出该篇
  await page.goto('/index.html#/quiz?poem=guan-ju');
  const focusState = await page.evaluate(() => window.PoetryQuiz.currentState());
  expect(focusState.focusPoemId).toBe('guan-ju');
  expect(errors, errors.join('\n')).toEqual([]);
});

test('初中年级筛选：只保留六年级~九年级且可多选，跨年级篇目两个年级都能筛到', async ({ page }) => {
  const errors = watchErrors(page);
  await gotoFresh(page);
  await chooseStage(page, '初中');

  const gradeChips = await page.locator('[data-filter="grade"]').allInnerTexts();
  expect(gradeChips).toEqual(['全部年级', '六年级', '七年级', '八年级', '九年级']);
  expect(gradeChips.some((text) => /初中|高中|七~九年级|八~九年级/.test(text))).toBe(false);

  // 单选 + 多选累加 + 再点一次取消
  await page.click('[data-filter="grade"][data-value="六年级"]');
  await expect(page.locator('.poem-card')).toHaveCount(COUNTS.juniorSixGrade);
  await page.click('[data-filter="grade"][data-value="七年级"]');
  await expect(page.locator('.poem-card')).toHaveCount(COUNTS.juniorGrade(['六年级', '七年级']));
  await expect(page.locator('[data-filter="grade"][data-value="六年级"]')).toHaveClass(/active/);
  await page.click('[data-filter="grade"][data-value="六年级"]');
  await expect(page.locator('.poem-card')).toHaveCount(COUNTS.juniorGrade(['七年级']));

  // 跨年级篇目（《孟子》三则）在八年级、九年级都能筛到
  await page.click('[data-filter="grade"][data-value=""]');
  await page.fill('#poemSearch', '孟子');
  await page.click('[data-filter="grade"][data-value="八年级"]');
  await expect(page.locator('.poem-card .poem-title')).toContainText('《孟子》三则');
  await page.click('[data-filter="grade"][data-value="九年级"]');
  await expect(page.locator('.poem-card .poem-title')).toContainText('《孟子》三则');
  await expect(page.locator('.poem-card')).toHaveCount(1); // 多选时也不会重复出现两次
  expect(errors, errors.join('\n')).toEqual([]);
});

test('高中课程模块筛选：只有必修 / 选择性必修 / 选修，不再出现诗词曲与高一高二高三', async ({ page }) => {
  const errors = watchErrors(page);
  await gotoFresh(page);
  await chooseStage(page, '高中');

  const label = await page.locator('.filter-group', { hasText: '课程模块' }).first().innerText();
  expect(label).toContain('课程模块（可多选）');
  const moduleChips = await page.locator('[data-filter="grade"]').allInnerTexts();
  expect(moduleChips).toEqual(['全部模块', '必修', '选择性必修', '选修']);
  expect(moduleChips.some((text) => /高一|高二|高三|诗词曲/.test(text))).toBe(false);

  await page.click('[data-filter="grade"][data-value="必修"]');
  await expect(page.locator('.poem-card')).toHaveCount(COUNTS.seniorModule(['必修']));
  await page.click('[data-filter="grade"][data-value="选修"]');
  await expect(page.locator('.poem-card')).toHaveCount(COUNTS.seniorModule(['必修', '选修']));
  await page.click('[data-filter="grade"][data-value="选择性必修"]');
  await expect(page.locator('.poem-card')).toHaveCount(COUNTS.senior);

  // 学习页徽章显示课程模块，而不是“高一”
  await page.click('[data-action="select-all"]');
  await page.click('[data-action="start"]');
  await page.click('[data-action="study"]');
  const badges = await page.locator('.poem-tags .badge-primary').first().innerText();
  expect(/必修|选择性必修|选修/.test(badges)).toBe(true);
  expect(/高一|高二|高三/.test(badges)).toBe(false);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('体裁与来源筛选同样支持多选', async ({ page }) => {
  const errors = watchErrors(page);
  await gotoFresh(page);
  await chooseStage(page, '初中');

  const genreChips = await page.locator('[data-filter="genre"]').allInnerTexts();
  expect(genreChips).toEqual(['全部体裁', '诗', '词', '曲', '文言文']);
  const sourceChips = await page.locator('[data-filter="sourceType"]').allInnerTexts();
  expect(sourceChips).toEqual(['全部来源', '课标推荐', '统编教材', '上海地区', '拓展']);

  // 体裁：诗 + 词（两者不重叠）
  await page.click('[data-filter="genre"][data-value="诗"]');
  await expect(page.locator('.poem-card')).toHaveCount(COUNTS.juniorGenre(['诗']));
  await page.click('[data-filter="genre"][data-value="词"]');
  await expect(page.locator('.poem-card')).toHaveCount(COUNTS.juniorGenre(['诗', '词']));
  await expect(page.locator('[data-filter="genre"][data-value="诗"]')).toHaveClass(/active/);
  await page.click('[data-filter="genre"][data-value="诗"]');
  await expect(page.locator('.poem-card')).toHaveCount(COUNTS.juniorGenre(['词']));

  // 来源：课标推荐 + 上海地区，并能与体裁叠加
  await page.click('[data-filter="genre"][data-value=""]');
  await page.click('[data-filter="sourceType"][data-value="课标推荐"]');
  await expect(page.locator('.poem-card')).toHaveCount(COUNTS.juniorSource(['课标推荐']));
  await page.click('[data-filter="sourceType"][data-value="上海地区"]');
  await expect(page.locator('.poem-card')).toHaveCount(COUNTS.juniorSource(['课标推荐', '上海地区']));
  await page.click('[data-filter="genre"][data-value="文言文"]');
  await expect(page.locator('.poem-card')).toHaveCount(COUNTS.juniorQuery({ sourceType: ['课标推荐', '上海地区'], genre: ['文言文'] }));
  await page.click('[data-filter="grade"][data-value="七年级"]');
  await expect(page.locator('.poem-card')).toHaveCount(
    COUNTS.juniorQuery({ sourceType: ['课标推荐', '上海地区'], genre: ['文言文'], grade: ['七年级'] }),
  );
  expect(errors, errors.join('\n')).toEqual([]);
});
