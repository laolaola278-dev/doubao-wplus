// 验证 skill popup 初始化崩溃假设：检查 keydown 监听 & popup 功能
const { chromium } = require('@playwright/test');
const path = require('path');
const os = require('os');
const fs = require('fs');

(async () => {
  const extDir = path.resolve('dist/chrome-mv3-dev');
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dwplus-test-'));
  const ctx = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: ['--disable-extensions-except=' + extDir, '--load-extension=' + extDir, '--no-first-run', '--disable-background-timer-throttling'],
    viewport: { width: 1280, height: 800 },
  });

  const page = await ctx.newPage();
  const errors = [];
  const logs = [];
  page.on('pageerror', err => errors.push(err.message + ' || STACK: ' + (err.stack || '').slice(0, 500)));
  page.on('console', msg => {
    const t = msg.text();
    if (t.includes('SKILLPOPUP') || t.includes('skill')) logs.push('[' + msg.type() + '] ' + t);
  });

  try { await page.goto('https://www.doubao.com/chat/', { waitUntil: 'domcontentloaded', timeout: 20000 }); } catch(e) {}
  await new Promise(r => setTimeout(r, 5000));

  console.log('PAGE_ERRORS:', JSON.stringify(errors, null, 2));
  console.log('SKILL_LOGS:', JSON.stringify(logs, null, 2));

  // 现在测试完整用户流程：点击输入框，输入 "/"，看弹窗是否出现
  const ta = await page.$('textarea.semi-input-textarea');
  if (ta) {
    await ta.click();
    await page.keyboard.type('/', { delay: 100 });
    await new Promise(r => setTimeout(r, 1500));

    const popupState = await page.evaluate(() => {
      const popup = document.querySelector('.dwplus-skill-popup');
      return {
        popupExists: !!popup,
        popupVisible: popup ? popup.style.display !== 'none' : false,
        popupItemCount: popup ? popup.querySelectorAll('.dwplus-skill-item').length : 0,
        textareaValue: document.querySelector('textarea.semi-input-textarea')?.value,
        stylesInjected: !!document.getElementById('dwplus-skill-popup-css'),
      };
    });
    console.log('POPUP_STATE:', JSON.stringify(popupState, null, 2));
  } else {
    console.log('NO_TEXTAREA');
  }

  console.log('LATE_SKILL_LOGS:', JSON.stringify(logs, null, 2));

  await ctx.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
