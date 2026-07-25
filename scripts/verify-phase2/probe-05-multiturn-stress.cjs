// scripts/verify-phase2/probe-05-multiturn-stress.cjs
// 验证 5 + 7：多轮对话（同会话多轮 / 新建会话 / 历史切换）+ 30 次连发稳定性
const path = require('path');
const fs = require('fs');
const {
  RESULTS_DIR,
  launch,
  installCdpCapture,
  installConsoleCapture,
  waitForReplyStable,
} = require('./lib.cjs');

(async () => {
  const { ctx, page } = await launch();
  const consoleMsgs = installConsoleCapture(page);
  const { wire, fillPostData } = await installCdpCapture(ctx, page);

  // MutationObserver / listener 计数（document_start 前注入）
  await page.addInitScript(() => {
    window.__P2_COUNTERS__ = { observers: 0, listeners: 0 };
    const OrigMO = window.MutationObserver;
    window.MutationObserver = class extends OrigMO {
      constructor(cb) { super(cb); window.__P2_COUNTERS__.observers++; }
    };
    const origAdd = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (t, f, o) {
      window.__P2_COUNTERS__.listeners++;
      return origAdd.call(this, t, f, o);
    };
  });

  await page.goto('https://www.doubao.com/chat/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(6000);

  const rounds = [];
  const N = 30;

  async function closeCaptchaIfAny() {
    // 图片验证码弹窗：无法自动通过，记录并尝试关闭
    const captcha = await page.evaluate(() => {
      const t = document.body.innerText || '';
      return /符合上文描述的图片|拖拽到下方|安全验证/.test(t);
    });
    if (!captcha) return false;
    try {
      // 尝试点击关闭按钮
      const closed = await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('div[class*="close"], svg[class*="close"], [aria-label*="关闭"], [aria-label*="close"]'));
        for (const b of btns) {
          const r = b.getBoundingClientRect();
          if (r.width > 0 && r.width < 60) { b.dispatchEvent(new MouseEvent('click', { bubbles: true })); return true; }
        }
        return false;
      });
      await page.waitForTimeout(800);
      return true;
    } catch { return true; }
  }

  async function snapshot() {
    return await page.evaluate(() => ({
      jsHeapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
      observers: window.__P2_COUNTERS__?.observers ?? -1,
      listeners: window.__P2_COUNTERS__?.listeners ?? -1,
      dwplusNodes: document.querySelectorAll('[class*="dwplus"], [id*="dwplus"]').length,
      skillPopups: document.querySelectorAll('.dwplus-skill-popup').length,
      url: location.href,
    }));
  }

  let firstConvUrl = null;
  for (let i = 1; i <= N; i++) {
    const errBefore = consoleMsgs.filter((m) => m.type === 'error' || m.type === 'pageerror').length;
    const t0 = Date.now();
    let sendOk = true;
    try {
      // 第 15 轮：新建会话；第 25 轮：切回第一个历史会话
      if (i === 15) {
        const btn = page.locator('text=新对话').first();
        await btn.click({ timeout: 3000 }).catch(() => {});
        await page.waitForTimeout(1500);
      }
      if (i === 25 && firstConvUrl) {
        // 侧边栏点击第一条历史会话
        const item = page.locator('[class*="history"] a, [class*="conversation"] a, aside a[href*="/chat/"]').first();
        const cnt = await item.count();
        if (cnt > 0) { await item.click({ timeout: 3000 }).catch(() => {}); }
        else { await page.goto(firstConvUrl, { waitUntil: 'domcontentloaded' }).catch(() => {}); }
        await page.waitForTimeout(1500);
      }

      const ta = page.locator('textarea').first();
      await ta.click({ timeout: 5000 });
      await ta.fill('');
      await page.keyboard.type(`第${i}轮：${100 + i}+1=?只回数字`, { delay: 10 });
      await page.waitForTimeout(300);
      await page.keyboard.press('Enter');
      await waitForReplyStable(page, { timeoutMs: 45000, stableMs: 2500 });
      const hadCaptcha = await closeCaptchaIfAny();
      if (i === 2) firstConvUrl = page.url();
      const errAfter = consoleMsgs.filter((m) => m.type === 'error' || m.type === 'pageerror').length;
      const snap = i % 5 === 0 || i === 1 ? await snapshot() : null;
      rounds.push({ i, ms: Date.now() - t0, hadCaptcha, newErrors: errAfter - errBefore, snap });
      console.log(`ROUND ${i}: ${Date.now() - t0}ms captcha=${hadCaptcha} newErr=${errAfter - errBefore}` + (snap ? ` heap=${snap.jsHeapMB}MB obs=${snap.observers} lis=${snap.listeners} nodes=${snap.dwplusNodes}` : ''));
    } catch (e) {
      sendOk = false;
      rounds.push({ i, error: e.message.slice(0, 150) });
      console.log(`ROUND ${i}: ERROR ${e.message.slice(0, 120)}`);
    }
  }

  await fillPostData();
  const comps = wire.filter((r) => r.url.includes('/chat/completion'));
  const skippedLogs = consoleMsgs.filter((m) => m.text.includes('DWPLUS-FETCH] Skipped')).length;
  const finalSnap = await snapshot();

  const summary = {
    totalRounds: N,
    okRounds: rounds.filter((r) => !r.error).length,
    captchaRounds: rounds.filter((r) => r.hadCaptcha).length,
    completionRequests: comps.length,
    completionStatuses: comps.map((r) => r.status),
    streamFailed: comps.filter((r) => r.failed).length,
    dwplusFetchSkipLogs: skippedLogs,
    totalConsoleErrors: consoleMsgs.filter((m) => m.type === 'error' || m.type === 'pageerror').length,
    uniqueErrorSamples: [...new Set(consoleMsgs.filter((m) => m.type === 'error' || m.type === 'pageerror').map((m) => m.text.slice(0, 120)))].slice(0, 15),
    finalSnap,
    rounds,
  };
  fs.writeFileSync(path.resolve(RESULTS_DIR, 'phase2-05-stress.json'), JSON.stringify(summary, null, 2));
  console.log('SUMMARY:', JSON.stringify({ ...summary, rounds: undefined }, null, 2));
  await page.screenshot({ path: path.resolve(RESULTS_DIR, 'phase2-05-stress.png') });
  await ctx.close();
})().catch((e) => {
  console.error('FATAL:', e.stack || e.message);
  process.exit(1);
});
