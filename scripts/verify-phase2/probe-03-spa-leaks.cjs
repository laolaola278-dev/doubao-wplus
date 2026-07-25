// scripts/verify-phase2/probe-03-spa-leaks.cjs
// 验证 6：SPA 页面切换 — content script 重复初始化 / MutationObserver 重复注册 /
//          EventListener 泄漏 / Popup 重复创建
const path = require('path');
const fs = require('fs');
const { RESULTS_DIR, launch, installConsoleCapture } = require('./lib.cjs');

(async () => {
  const { ctx, page } = await launch();
  const consoleMsgs = installConsoleCapture(page);

  // 在文档创建时(早于 content script)包装 MutationObserver 和 addEventListener 计数
  await page.addInitScript(() => {
    window.__P2_COUNTERS__ = { observers: 0, activeObservers: 0, listeners: {}, popupCreations: 0 };
    const OrigMO = window.MutationObserver;
    window.MutationObserver = class extends OrigMO {
      constructor(cb) {
        super(cb);
        window.__P2_COUNTERS__.observers++;
        window.__P2_COUNTERS__.activeObservers++;
      }
      disconnect() {
        window.__P2_COUNTERS__.activeObservers--;
        return super.disconnect();
      }
    };
    const origAdd = EventTarget.prototype.addEventListener;
    const origRemove = EventTarget.prototype.removeEventListener;
    EventTarget.prototype.addEventListener = function (type, fn, opts) {
      try {
        const tgt = this === window ? 'window' : this === document ? 'document' : null;
        if (tgt) {
          const key = tgt + ':' + type;
          window.__P2_COUNTERS__.listeners[key] = (window.__P2_COUNTERS__.listeners[key] || 0) + 1;
        }
      } catch {}
      return origAdd.call(this, type, fn, opts);
    };
    EventTarget.prototype.removeEventListener = function (type, fn, opts) {
      try {
        const tgt = this === window ? 'window' : this === document ? 'document' : null;
        if (tgt) {
          const key = tgt + ':' + type;
          if (window.__P2_COUNTERS__.listeners[key]) window.__P2_COUNTERS__.listeners[key]--;
        }
      } catch {}
      return origRemove.call(this, type, fn, opts);
    };
  });

  await page.goto('https://www.doubao.com/chat/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(7000);

  async function snapshot(label) {
    const s = await page.evaluate(() => {
      const c = window.__P2_COUNTERS__ || {};
      const dwListeners = Object.fromEntries(
        Object.entries(c.listeners || {}).filter(([, v]) => v > 0),
      );
      return {
        observersCreated: c.observers ?? -1,
        observersActive: c.activeObservers ?? -1,
        winDocListeners: dwListeners,
        skillPopups: document.querySelectorAll('.dwplus-skill-popup').length,
        petElements: document.querySelectorAll('[class*="dwplus-pet"], [id*="dwplus-pet"]').length,
        dwplusNodes: document.querySelectorAll('[class*="dwplus"], [id*="dwplus"]').length,
        url: location.href,
        jsHeap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
      };
    });
    console.log(`SNAPSHOT[${label}]:`, JSON.stringify(s));
    return s;
  }

  const snaps = {};
  snaps.initial = await snapshot('initial');

  // SPA 切换序列：新对话按钮 → 首页 → 回聊天页，重复 5 轮（history.pushState 导航，不整页刷新）
  const initLogCountBefore = consoleMsgs.filter((m) => m.text.includes('initSkillPopup')).length;
  for (let i = 1; i <= 5; i++) {
    // 点"新对话"
    const newChatBtn = page.locator('button:has-text("新对话"), [class*="new"]:has-text("新对话")').first();
    try {
      if ((await newChatBtn.count()) > 0) await newChatBtn.click({ timeout: 3000 });
    } catch {}
    await page.waitForTimeout(1500);
    // SPA 内部导航（pushState 到不同路径再回来）
    await page.evaluate(() => history.pushState({}, '', '/chat/create-image'));
    await page.evaluate(() => window.dispatchEvent(new PopStateEvent('popstate')));
    await page.waitForTimeout(800);
    await page.evaluate(() => history.pushState({}, '', '/chat/'));
    await page.evaluate(() => window.dispatchEvent(new PopStateEvent('popstate')));
    await page.waitForTimeout(800);
    snaps['round' + i] = await snapshot('round' + i);
  }

  const initLogCountAfter = consoleMsgs.filter((m) => m.text.includes('initSkillPopup')).length;
  const attachLogCount = consoleMsgs.filter((m) => m.text.includes('Attached to textarea')).length;
  const bridgeInitCount = consoleMsgs.filter((m) => m.text.includes('installContentBridge() called')).length;

  console.log('INIT_LOGS: initSkillPopup before=' + initLogCountBefore + ' after=' + initLogCountAfter);
  console.log('ATTACH_LOGS:', attachLogCount, 'BRIDGE_INIT_LOGS:', bridgeInitCount);

  const out = {
    snaps,
    reinitCounts: {
      initSkillPopup: initLogCountAfter,
      attachedToTextarea: attachLogCount,
      installContentBridge: bridgeInitCount,
    },
    consoleErrors: consoleMsgs
      .filter((m) => m.type === 'error' || m.type === 'pageerror')
      .map((m) => m.text.slice(0, 200)),
    dwplusLogs: consoleMsgs.filter((m) => m.text.includes('DWPLUS')).map((m) => m.text.slice(0, 200)),
  };
  fs.writeFileSync(path.resolve(RESULTS_DIR, 'phase2-03-spa-leaks.json'), JSON.stringify(out, null, 2));
  console.log('WROTE phase2-03-spa-leaks.json');
  await page.screenshot({ path: path.resolve(RESULTS_DIR, 'phase2-03-spa.png') });
  await ctx.close();
})().catch((e) => {
  console.error('FATAL:', e.stack || e.message);
  process.exit(1);
});
