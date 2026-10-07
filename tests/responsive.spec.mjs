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
