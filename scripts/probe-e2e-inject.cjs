// 端到端验证：skill 选择注入 + 选择器健康 + React 状态同步
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
  const logs = [];
  page.on('console', msg => {
    const t = msg.text();
    if (t.includes('DWPLUS') || t.includes('selector')) logs.push('[' + msg.type() + '] ' + t.slice(0, 150));
  });

  try { await page.goto('https://www.doubao.com/chat/', { waitUntil: 'domcontentloaded', timeout: 20000 }); } catch(e) {}
  await new Promise(r => setTimeout(r, 5000));

  // === TEST 1: 选择器健康检查（修复后） ===
  await page.evaluate(() => window.__DWPLUS_RUN_HEALTH_CHECK__?.());
  await new Promise(r => setTimeout(r, 500));
  const health = await page.evaluate(() => window.__DWPLUS_DIAG__?.selectorHealth);
  console.log('TEST1_SELECTOR_HEALTH:', JSON.stringify(health));

  // === TEST 2: Skill 弹窗选择注入 ===
  const ta = await page.$('textarea.semi-input-textarea');
  await ta.click();
  await page.keyboard.type('/mem', { delay: 80 });
  await new Promise(r => setTimeout(r, 800));

  const popupBefore = await page.evaluate(() => {
    const popup = document.querySelector('.dwplus-skill-popup');
    return {
      visible: popup && popup.style.display !== 'none',
      items: popup ? Array.from(popup.querySelectorAll('.dwplus-skill-trigger')).map(e => e.textContent) : [],
    };
  });
  console.log('TEST2_POPUP_FILTERED:', JSON.stringify(popupBefore));

  // 按 Enter 选中第一个匹配项
  await page.keyboard.press('Enter');
  await new Promise(r => setTimeout(r, 800));

  const afterSelect = await page.evaluate(() => {
    const ta = document.querySelector('textarea.semi-input-textarea');
    return {
      textareaValue: ta?.value,
      popupHidden: (() => { const p = document.querySelector('.dwplus-skill-popup'); return !p || p.style.display === 'none'; })(),
    };
  });
  console.log('TEST2_AFTER_SELECT:', JSON.stringify(afterSelect));

  // === TEST 3: React 状态同步验证（输入后发送按钮出现 = 框架感知了 value）===
  await new Promise(r => setTimeout(r, 500));
  const sendBtnState = await page.evaluate(() => {
    const wrapper = document.querySelector('div[class*="send-btn-wrapper"]');
    const btn = wrapper?.querySelector('button');
    return {
      sendBtnWrapperFound: !!wrapper,
      sendBtnFound: !!btn,
      sendBtnDisabled: btn ? (btn.disabled || btn.getAttribute('aria-disabled') === 'true') : null,
    };
  });
  console.log('TEST3_SEND_BTN_AFTER_INJECT:', JSON.stringify(sendBtnState));

  // === TEST 4: 继续追加文字后验证 UI 联动 ===
  await page.keyboard.type('保存测试内容', { delay: 50 });
  await new Promise(r => setTimeout(r, 500));
  const finalValue = await page.evaluate(() => document.querySelector('textarea.semi-input-textarea')?.value);
  console.log('TEST4_FINAL_VALUE:', JSON.stringify(finalValue));

  // === TEST 5: fetch hook 是否捕获请求路径（不真正发送，仅检查 hook 状态）===
  const hookState = await page.evaluate(() => ({
    fetchHooked: window.__DWPLUS_DIAG__?.fetchHooked,
    mainWorldReady: window.__DWPLUS_DIAG__?.mainWorldReady,
    host: window.__DWPLUS_DIAG__?.host,
  }));
  console.log('TEST5_HOOK_STATE:', JSON.stringify(hookState));

  console.log('RELEVANT_LOGS:', JSON.stringify(logs.filter(l => l.includes('selector') || l.includes('SKILLPOPUP')).slice(-8), null, 2));

  await ctx.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
