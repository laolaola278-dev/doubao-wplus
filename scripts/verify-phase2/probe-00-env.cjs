// scripts/verify-phase2/probe-00-env.cjs
// 第二阶段真实浏览器联调 — 环境与登录态探测（只读，不发消息）
const { chromium } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..', '..');
const EXT_DIR = path.resolve(ROOT, 'dist/chrome-mv3-dev');
const PROFILE_DIR = path.resolve(ROOT, '.e2e-profile'); // 持久 profile：登录一次后复用

(async () => {
  fs.mkdirSync(PROFILE_DIR, { recursive: true });
  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    args: [
      '--disable-extensions-except=' + EXT_DIR,
      '--load-extension=' + EXT_DIR,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-timer-throttling',
    ],
    viewport: { width: 1400, height: 900 },
  });

  const page = ctx.pages()[0] || (await ctx.newPage());
  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 200));
  });

  try {
    await page.goto('https://www.doubao.com/chat/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  } catch (e) {
    console.log('GOTO_ERROR:', e.message);
  }
  await new Promise((r) => setTimeout(r, 8000));

  const state = await page.evaluate(() => {
    const d = window.__DWPLUS_DIAG__;
    const ta = document.querySelector('textarea');
    const loginBtn = document.querySelector('button[class*="login"], a[href*="login"]');
    // 粗略判断登录：页面是否有头像/用户区
    const bodyText = (document.body?.innerText || '').slice(0, 300);
    return {
      url: location.href,
      title: document.title,
      diag: d
        ? {
            host: d.host,
            mainWorldReady: d.mainWorldReady,
            fetchHooked: d.fetchHooked,
            selectorHealth: d.selectorHealth,
            lastCapturedRequest: d.lastCapturedRequest,
          }
        : null,
      hasTextarea: !!ta,
      textareaPlaceholder: ta?.placeholder ?? null,
      hasLoginButton: !!loginBtn,
      loginButtonText: loginBtn?.textContent?.slice(0, 30) ?? null,
      bodySnippet: bodyText,
    };
  });
  console.log('ENV_STATE:', JSON.stringify(state, null, 2));
  console.log('CONSOLE_ERRORS:', JSON.stringify(consoleErrors.slice(0, 10), null, 2));

  await page.screenshot({ path: path.resolve(ROOT, 'playwright-results/phase2-00-env.png') });
  await ctx.close();
})().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
