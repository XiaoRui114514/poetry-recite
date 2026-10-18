/* 响应式测试（@responsive）：在 desktop / tablet / mobile 三种视口下运行。 */
import { expect, test } from '@playwright/test';

async function fresh(page) {
  await page.goto('/index.html');
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('hison-poetry-notice-v1', '1');
  });
  await page.goto('/index.html');
}

async function expectNoHorizontalOverflow(page, label) {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    return Math.max(doc.scrollWidth - doc.clientWidth, document.body.scrollWidth - doc.clientWidth);
  });
  expect(overflow, `${label} 出现横向溢出 ${overflow}px`).toBeLessThanOrEqual(1);
}

test('@responsive 关键流程在各尺寸下可用', async ({ page }) => {
  await fresh(page);
  await expect(page.locator('.stage-card')).toHaveCount(2);
  await expectNoHorizontalOverflow(page, '阶段选择页');

  // 顶栏：竖屏（手机 / 平板）只留左上角图标；横屏保留标题与小标题
  const viewport = page.viewportSize();
  const portrait = viewport.width < viewport.height;
  const titleBox = await page.locator('.app-title-box').boundingBox();
  if (portrait) {
    expect(titleBox.width, `${viewport.width}×${viewport.height} 竖屏应隐藏标题`).toBeLessThanOrEqual(1);
    await expect(page.locator('.brand-logo')).toBeVisible();
  } else {
    expect(titleBox.width, `${viewport.width}×${viewport.height} 横屏应显示标题`).toBeGreaterThan(80);
    await expect(page.locator('.app-title')).toBeVisible();
  }

  await page.locator('[data-stage="初中"]').click();
  await expectNoHorizontalOverflow(page, '篇目选择页');
  await page.click('[data-action="select-none"]');
  await page.locator('.poem-card', { hasText: '观沧海' }).first().click();
  await expect(page.locator('.select-summary')).toHaveText('已选择 1 篇');

  // 移动端点击区域高度检查（勾选卡片 ≥ 40px）
  const box = await page.locator('.poem-card').first().boundingBox();
  expect(box.height).toBeGreaterThanOrEqual(40);

  await page.click('[data-action="start"]');
  await page.click('[data-action="study"]');
  await expectNoHorizontalOverflow(page, '全文学习页');
  await page.locator('.line-item').first().click();
  await expect(page.locator('.line-item').first()).toContainText('□');

  await page.click('#headerBack');
  await page.click('[data-action="quiz"]');
  await expect(page.locator('.quiz-card')).not.toHaveCount(0);
  await expectNoHorizontalOverflow(page, '默写自测页');
  const eye = await page.locator('.quiz-card').first().locator('.btn-eye').boundingBox();
  expect(Math.min(eye.width, eye.height)).toBeGreaterThanOrEqual(36);
});

test('@responsive 长文言文与进度页在窄屏不错位', async ({ page }) => {
  await fresh(page);
  await page.locator('[data-stage="高中"]').click();
  await page.click('[data-action="select-none"]');
  await page.fill('#poemSearch', '滕王阁序');
  await page.locator('.poem-card', { hasText: '滕王阁序' }).first().click();
  await page.click('[data-action="start"]');
  await page.click('[data-action="progress"]');
  await expectNoHorizontalOverflow(page, '进度页');
  await page.click('#headerBack');
  await page.click('[data-action="study"]');
  await expectNoHorizontalOverflow(page, '长文学习页');
  await expect(page.locator('.poem-body')).toContainText('落霞与孤鹜齐飞');
});

test('@responsive 逐句翻译在窄屏不溢出、隐藏时不改变布局', async ({ page }) => {
  await fresh(page);
  await page.locator('[data-stage="初中"]').click();
  await page.click('[data-action="select-none"]');
  await page.locator('.poem-card', { hasText: '观沧海' }).first().click();
  await page.click('[data-action="start"]');
  await page.click('[data-action="study"]');

  const lines = page.locator('.line-item');
  await expect(lines).toHaveCount(6);
  await expect(page.locator('.line-zh')).toHaveCount(6);
  await expectNoHorizontalOverflow(page, '带翻译的全文学习页');

  // 翻译字号必须小于原文，且未加粗、层级更低
  const sizes = await page.evaluate(() => {
    const text = document.querySelector('.line-text');
    const zh = document.querySelector('.line-zh');
    return {
      text: parseFloat(getComputedStyle(text).fontSize),
      zh: parseFloat(getComputedStyle(zh).fontSize),
      weight: getComputedStyle(zh).fontWeight,
      visibility: getComputedStyle(zh).visibility,
    };
  });
  expect(sizes.zh).toBeLessThan(sizes.text);
  expect(sizes.zh / sizes.text).toBeGreaterThanOrEqual(0.6);
  expect(sizes.zh / sizes.text).toBeLessThanOrEqual(0.85);
  expect(Number(sizes.weight)).toBeLessThanOrEqual(400);

  const height = async () => page.evaluate(() => document.getElementById('poemBody').getBoundingClientRect().height);
  const before = await height();

  await page.click('[data-action="hide-all"]');
  await expect(page.locator('.line-zh:not(.is-off)')).toHaveCount(0);
  const afterHide = await height();
  expect(afterHide, '隐藏全部翻译后 poemBody 高度必须不变').toBeCloseTo(before, 0);
  await expectNoHorizontalOverflow(page, '隐藏翻译后的全文学习页');

  await page.click('[data-action="reveal-all"]');
  await expect(page.locator('.line-zh:not(.is-off)')).toHaveCount(6);
  expect(await height(), '恢复显示后 poemBody 高度必须回到原值').toBeCloseTo(before, 0);
  await expectNoHorizontalOverflow(page, '恢复翻译后的全文学习页');
});

test('@responsive 重点星标列在各尺寸下固定占位，原文不被挤压也不溢出', async ({ page }) => {
  const viewport = page.viewportSize();
  const label = `${viewport.width}×${viewport.height}`;
  await fresh(page);
  await page.locator('[data-stage="初中"]').click();
  await page.click('[data-action="select-none"]');
  await page.locator('.poem-card', { hasText: '岳阳楼记' }).first().click();
  await page.click('[data-action="start"]');
  await page.click('[data-action="study"]');
  await expectNoHorizontalOverflow(page, `${label} 全文学习页`);

  const metrics = () => page.evaluate(() => {
    const markers = [...document.querySelectorAll('#poemBody .line-marker')];
    const rows = [...document.querySelectorAll('#poemBody .line-item')];
    return {
      markerCount: markers.length,
      minWidth: Math.min(...markers.map((m) => m.getBoundingClientRect().width)),
      widths: new Set(markers.map((m) => Math.round(m.getBoundingClientRect().width * 100) / 100)).size,
      lefts: new Set(rows.map((r) => Math.round(r.querySelector('.line-text').getBoundingClientRect().left * 100) / 100)).size,
      left: rows[0].querySelector('.line-text').getBoundingClientRect().left,
      stars: markers.filter((m) => m.textContent === '★' && getComputedStyle(m).visibility !== 'hidden').length,
      body: Math.round(document.getElementById('poemBody').getBoundingClientRect().height),
      // marker 是否和原文第一行重叠（星标压在字上）
      overlap: rows.filter((r) => {
        const m = r.querySelector('.line-marker').getBoundingClientRect();
        const t = r.querySelector('.line-text').getBoundingClientRect();
        return m.width > 0 && m.right > t.left + 0.5;
      }).length,
    };
  });

  const base = await metrics();
  expect(base.markerCount, '每句都要有 marker').toBe(22);
  expect(base.minWidth, `${label} marker 必须有可见占位宽度`).toBeGreaterThan(10);
  // marker 列宽不能过大，否则手机端诗句被严重挤压
  expect(base.minWidth, `${label} marker 列宽不应超过 30px（当前 ${base.minWidth}）`).toBeLessThanOrEqual(30);
  expect(base.widths, `${label} 所有 marker 列宽必须完全一致`).toBe(1);
  expect(base.lefts, `${label} 所有原文左边缘必须完全一致`).toBe(1);
  expect(base.overlap, `${label} 星标不能与原文文字重叠`).toBe(0);
  await expectNoHorizontalOverflow(page, `${label} 有星标时的全文学习页`);

  // 隐藏 / 显示后：marker 列宽与原文左边缘都不许变
  await page.click('[data-action="hide-all"]');
  const hidden = await metrics();
  expect(hidden.minWidth, `${label} 隐藏后 marker 列宽不应变化`).toBeCloseTo(base.minWidth, 1);
  expect(hidden.left, `${label} 隐藏后原文左边缘不应移动`).toBeCloseTo(base.left, 1);
  expect(hidden.stars, `${label} 隐藏后不应有可见 ★`).toBe(0);
  expect(hidden.markerCount, `${label} 隐藏后 marker 占位不应消失`).toBe(22);
  await expectNoHorizontalOverflow(page, `${label} 隐藏后的全文学习页`);

  await page.click('[data-action="reveal-all"]');
  const shown = await metrics();
  expect(shown.minWidth).toBeCloseTo(base.minWidth, 1);
  expect(shown.left).toBeCloseTo(base.left, 1);
  expect(shown.body, `${label} 恢复后 poemBody 高度必须回到原值`).toBe(base.body);
  await expectNoHorizontalOverflow(page, `${label} 恢复后的全文学习页`);

  // 中心思想区域同样不能溢出
  await expect(page.locator('.poem-summary')).toHaveCount(1);
  await expectNoHorizontalOverflow(page, `${label} 中心思想区域`);
});

test('@responsive 新工具条、打印页与进度热力图在窄屏不溢出', async ({ page }) => {
  const viewport = page.viewportSize();
  const label = `${viewport.width}×${viewport.height}`;
  await fresh(page);
  await page.locator('[data-stage="初中"]').click();
  await page.click('[data-action="select-none"]');
  await page.locator('.poem-card', { hasText: '观沧海' }).first().click();
  await page.click('[data-action="start"]');
  await page.click('[data-action="study"]');

  await expectNoHorizontalOverflow(page, `${label} 学习页工具条`);
  await page.click('[data-action="toggle-recite"]');
  await expect(page.locator('#poemBody .line-item:visible')).toHaveCount(1);
  await expectNoHorizontalOverflow(page, `${label} 逐句背`);
  await page.click('[data-action="toggle-recite"]');
  await page.click('[data-action="toggle-focus"]');
  await expectNoHorizontalOverflow(page, `${label} 只看重点`);
  await page.click('[data-action="toggle-focus"]');
  await page.click('[data-action="toggle-translation"]');
  await expectNoHorizontalOverflow(page, `${label} 关闭译文`);
  await page.click('[data-action="toggle-translation"]');

  await page.click('#headerBack');
  await page.click('[data-action="print"]');
  await expect(page.locator('.print-sheet')).toBeVisible();
  await expectNoHorizontalOverflow(page, `${label} 打印默写纸`);

  await page.click('#headerBack');
  await page.click('[data-action="progress"]');
  await expect(page.locator('.heatmap')).toBeVisible();
  await expectNoHorizontalOverflow(page, `${label} 进度页热力图`);
});
