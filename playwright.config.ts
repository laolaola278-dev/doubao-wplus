// playwright.config.ts
// Playwright E2E 配置 — Batch 3-B Smoke Foundation
//
// 目标：
//   - 验证 Chrome MV3 扩展在真实 Chromium 中加载
//   - 验证 content script / main-world 注入路径
//   - 验证 host detection 行为
//
// 第一版不做：
//   - 真实账号登录
//   - 真实模型回复等待
//   - DOM 业务功能验证（导出、UI 增强）
//   - a_bogus / 私有签名算法验证

import { defineConfig, devices } from '@playwright/test';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname);
const E2E_RESULTS_DIR = resolve(ROOT, 'playwright-results');

export default defineConfig({
  testDir: './tests/e2e',
  // E2E tests use the same test runner; keep timeout generous since extension
  // bootstrap + diagnostics marker propagation can take a few seconds.
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false, // 共享一个持久化 Chromium context，串行更稳
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI
    ? [['list'], ['html', { outputFolder: E2E_RESULTS_DIR, open: 'never' }]]
    : [['list']],
  outputDir: E2E_RESULTS_DIR,
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // WXT 打包后是 MV3 service worker + content scripts。
    // 持久化 context 用于加载扩展：必须使用 `chromium` persistent context
    // （Playwright 不支持以扩展方式启动 headed/headless 同时按普通方式加载页面，
    //  推荐用 chromium.launchPersistentContext + --load-extension）。
    // baseURL 留空：smoke tests 直接打开具体 URL。
  },
  projects: [
    {
      name: 'chromium-extension',
      use: {
        ...devices['Desktop Chrome'],
        // 注意：launchPersistentContext 在 playwright.config.ts 中通过
        // globalSetup / fixtures 注入扩展路径；具体实现在 tests/e2e/fixtures/extension.ts。
        viewport: { width: 1280, height: 800 },
        locale: 'zh-CN',
        timezoneId: 'Asia/Shanghai',
      },
    },
  ],
  // 在启动前断言 build 已存在
  // 注意：Playwright 的 globalSetup 必须是文件路径字符串，指向 export default 一个函数的模块。
  globalSetup: resolve(__dirname, 'tests/e2e/global-setup.ts'),
});
