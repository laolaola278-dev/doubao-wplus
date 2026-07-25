// 真实浏览器探测脚本 — 输入文本后探测条件渲染的发送按钮
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
  try { await page.goto('https://www.doubao.com/chat/', { waitUntil: 'domcontentloaded', timeout: 20000 }); } catch(e) {}
  await new Promise(r => setTimeout(r, 5000));

  // 用真实键盘输入文本
  const ta = await page.$('textarea.semi-input-textarea');
  if (ta) {
    await ta.click();
    await ta.type('你好测试', { delay: 30 });
  } else {
    console.log('NO_TEXTAREA_HANDLE');
  }
  await new Promise(r => setTimeout(r, 1500));

  const info = await page.evaluate(() => {
    const results = {};
    results.textareaValue = document.querySelector('textarea.semi-input-textarea')?.value;

    const submitBtns = Array.from(document.querySelectorAll('button[type="submit"]'));
    results.submitBtnCount = submitBtns.length;
    results.submitBtns = submitBtns.map(b => {
      const r = b.getBoundingClientRect();
      return {
        className: b.className?.slice(0, 100),
        ariaLabel: b.getAttribute('aria-label'),
        dataTestId: b.getAttribute('data-testid'),
        svgInside: !!b.querySelector('svg'),
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        text: b.textContent?.trim().slice(0, 15),
        parentClass: b.parentElement?.className?.slice(0, 80),
      };
    });

    // 类似发送按钮的 svg-only 小按钮
    const allBtns = Array.from(document.querySelectorAll('button'));
    results.svgOnlyBtns = allBtns.filter(b => {
      const r = b.getBoundingClientRect();
      return r.width >= 28 && r.width <= 48 && r.height >= 28 && r.height <= 48 && !!b.querySelector('svg') && !b.textContent?.trim();
    }).map(b => {
      const r = b.getBoundingClientRect();
      return {
        type: b.type,
        className: b.className?.slice(0, 110),
        ariaLabel: b.getAttribute('aria-label'),
        dataTestId: b.getAttribute('data-testid'),
        title: b.title,
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        parentClass: b.parentElement?.className?.slice(0, 60),
      };
    });

    return results;
  });
  console.log(JSON.stringify(info, null, 2));

  await ctx.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
