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
