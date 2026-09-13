import { defineConfig } from '@playwright/test';

/* 浏览器策略：默认用 Playwright 自带的 Chromium（首次运行前执行一次
   `npm run test:e2e:install`），不假设开发机 / CI 一定装了 Microsoft Edge。
   需要在某些机器上复用 Edge 时可以覆盖：
     PowerShell:  $env:PW_CHANNEL='msedge'; npm run test:e2e
     bash:        PW_CHANNEL=msedge npm run test:e2e */
const channel = process.env.PW_CHANNEL || undefined;

export default defineConfig({
  testDir: './tests',
  timeout: 45_000,
  retries: 0,
  reporter: [['list']],
  use: {
    channel,
    headless: true,
    baseURL: 'http://localhost:5173',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node tools/serve.mjs',
    url: 'http://localhost:5173/index.html',
    reuseExistingServer: true,
    timeout: 30_000,
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1280, height: 800 } } },
    { name: 'tablet', use: { viewport: { width: 834, height: 1112 }, hasTouch: true }, grep: /@responsive/ },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }, grep: /@responsive/ },
  ],
});
