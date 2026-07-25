// scripts/verify-phase2/lib.cjs
// 共享工具：启动持久 context + CDP 抓包 + 原始 body 捕获
const { chromium } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..', '..');
// 默认 dev 构建；可用 DWPLUS_EXT_DIR 指向其他构建目录（如 e2e 构建的 dist/chrome-mv3）
const EXT_DIR = process.env.DWPLUS_EXT_DIR
  ? path.resolve(ROOT, process.env.DWPLUS_EXT_DIR)
  : path.resolve(ROOT, 'dist/chrome-mv3-dev');
const PROFILE_DIR = path.resolve(ROOT, '.e2e-profile');
const RESULTS_DIR = path.resolve(ROOT, 'playwright-results');

async function launch() {
  fs.mkdirSync(PROFILE_DIR, { recursive: true });
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
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
  return { ctx, page };
}

/**
 * 在页面里加一层"最外层 fetch 包装器"：
 * 扩展在 document_start 就 hook 了 window.fetch，此时再包一层，
 * 页面业务代码调用顺序 = 我们的包装器(看到原始 body) -> 扩展 hook(增强) -> 原生 fetch。
 * CDP Network 面板看到的是最终发出的 body。两者对比即 Hook 前后差异。
 */
async function installOriginalBodyCapture(page) {
  await page.evaluate(() => {
    if (window.__P2_ORIG_CAPTURE__) return;
    window.__P2_ORIG_REQUESTS__ = [];
    const hooked = window.fetch; // 此时已是扩展 hook 过的 fetch
    window.fetch = function (input, init) {
      try {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (
          url.includes('doubao.com') &&
          init &&
          typeof init.body === 'string' &&
          (init.method || 'GET').toUpperCase() === 'POST'
        ) {
          window.__P2_ORIG_REQUESTS__.push({
            url,
            method: init.method || 'POST',
            body: init.body,
            ts: Date.now(),
          });
          if (window.__P2_ORIG_REQUESTS__.length > 100) window.__P2_ORIG_REQUESTS__.shift();
        }
      } catch {}
      return hooked.apply(this, arguments);
    };
    window.__P2_ORIG_CAPTURE__ = true;
  });
}

/** CDP Network 抓包：返回收集器（POST 到 doubao.com 的最终请求 + 响应元信息） */
async function installCdpCapture(ctx, page) {
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  const wire = []; // {url, method, headers, postData, requestId, status, mimeType, streamed, responseSize}
  const byId = new Map();
  cdp.on('Network.requestWillBeSent', (e) => {
    const { request, requestId } = e;
    if (!request.url.includes('doubao.com')) return;
    if (request.method !== 'POST') return;
    const rec = {
      requestId,
      url: request.url,
      method: request.method,
      headers: request.headers,
      postData: request.postData ?? null,
      hasPostData: !!request.hasPostData,
      status: null,
      mimeType: null,
      dataChunks: 0,
      dataBytes: 0,
      finished: false,
      failed: null,
      ts: Date.now(),
    };
    byId.set(requestId, rec);
    wire.push(rec);
    if (wire.length > 200) {
      const old = wire.shift();
      byId.delete(old.requestId);
    }
  });
  cdp.on('Network.responseReceived', (e) => {
    const rec = byId.get(e.requestId);
    if (!rec) return;
    rec.status = e.response.status;
    rec.mimeType = e.response.mimeType;
  });
  cdp.on('Network.dataReceived', (e) => {
    const rec = byId.get(e.requestId);
    if (!rec) return;
    rec.dataChunks += 1;
    rec.dataBytes += e.dataLength;
  });
  cdp.on('Network.loadingFinished', (e) => {
    const rec = byId.get(e.requestId);
    if (rec) rec.finished = true;
  });
  cdp.on('Network.loadingFailed', (e) => {
    const rec = byId.get(e.requestId);
    if (rec) rec.failed = e.errorText;
  });
  // postData 可能因体积原因不在事件里，补抓
  async function fillPostData() {
    for (const rec of wire) {
      if (rec.postData == null && rec.hasPostData) {
        try {
          const r = await cdp.send('Network.getRequestPostData', { requestId: rec.requestId });
          rec.postData = r.postData;
        } catch {}
      }
    }
  }
  return { cdp, wire, fillPostData };
}

/** 收集 console 消息 */
function installConsoleCapture(page) {
  const messages = [];
  page.on('console', (msg) => {
    messages.push({ type: msg.type(), text: msg.text().slice(0, 400), ts: Date.now() });
    if (messages.length > 2000) messages.shift();
  });
  page.on('pageerror', (err) => {
    messages.push({ type: 'pageerror', text: String(err.message).slice(0, 400), ts: Date.now() });
  });
  return messages;
}

/** 输入并发送一条消息（优先点发送按钮，兜底 Enter） */
async function sendMessage(page, text) {
  const ta = page.locator('textarea').first();
  await ta.click();
  await ta.fill('');
  await ta.pressSequentially(text, { delay: 15 });
  await page.waitForTimeout(600);
  // 尝试找发送按钮
  const btn = page
    .locator(
      'button[data-testid*="send"], div[class*="send-btn"] button, button[aria-label*="发送"], button[class*="send"]',
    )
    .first();
  let clicked = false;
  try {
    if ((await btn.count()) > 0 && (await btn.isVisible())) {
      await btn.click({ timeout: 2000 });
      clicked = true;
    }
  } catch {}
  if (!clicked) await page.keyboard.press('Enter');
  return clicked ? 'button' : 'enter';
}

/** 等待流式回复结束：轮询消息条数与文本稳定 */
async function waitForReplyStable(page, { timeoutMs = 90000, stableMs = 3500 } = {}) {
  const start = Date.now();
  let lastLen = -1;
  let lastChange = Date.now();
  while (Date.now() - start < timeoutMs) {
    let len = lastLen;
    try {
      len = await page.evaluate(() => (document.body.innerText || '').length);
    } catch {
      // SPA navigation destroyed the context — treat as a change and retry
      lastChange = Date.now();
      await page.waitForTimeout(700);
      continue;
    }
    if (len !== lastLen) {
      lastLen = len;
      lastChange = Date.now();
    } else if (Date.now() - lastChange > stableMs) {
      return true;
    }
    await page.waitForTimeout(700);
  }
  return false;
}

module.exports = {
  ROOT,
  EXT_DIR,
  PROFILE_DIR,
  RESULTS_DIR,
  launch,
  installOriginalBodyCapture,
  installCdpCapture,
  installConsoleCapture,
  sendMessage,
  waitForReplyStable,
};
