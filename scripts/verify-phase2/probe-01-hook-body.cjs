// scripts/verify-phase2/probe-01-hook-body.cjs
// 验证 1-3：Fetch Hook 是否真正修改最终发送的 Request Body
//   - 页面层包装器捕获"原始 body"（页面业务代码传给 fetch 的）
//   - CDP Network 捕获"最终发送 body"（浏览器网络栈真正发出的）
//   - 对比两者 + 检查 Memory/Skill/System Prompt 是否写入
const path = require('path');
const fs = require('fs');
const {
  ROOT,
  RESULTS_DIR,
  launch,
  installOriginalBodyCapture,
  installCdpCapture,
  installConsoleCapture,
  sendMessage,
  waitForReplyStable,
} = require('./lib.cjs');

(async () => {
  const { ctx, page } = await launch();
  const consoleMsgs = installConsoleCapture(page);
  const { wire, fillPostData } = await installCdpCapture(ctx, page);

  await page.goto('https://www.doubao.com/chat/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(6000);
  await installOriginalBodyCapture(page);

  // 发送一条普通消息
  const marker = 'P2HOOK测试' + Math.floor(Math.random() * 10000);
  const sendVia = await sendMessage(page, `请用一句话回答：${marker} 的下一个整数是什么？`);
  console.log('SEND_VIA:', sendVia);

  const done = await waitForReplyStable(page, { timeoutMs: 60000 });
  console.log('REPLY_STABLE:', done);
  await fillPostData();

  // 页面层原始请求
  const origRequests = await page.evaluate(() => window.__P2_ORIG_REQUESTS__ || []);
  // 扩展诊断
  const diag = await page.evaluate(() => {
    const d = window.__DWPLUS_DIAG__;
    return d ? { host: d.host, fetchHooked: d.fetchHooked, lastCapturedRequest: d.lastCapturedRequest } : null;
  });

  const out = {
    marker,
    sendVia,
    replyStable: done,
    diag,
    origRequests: origRequests.map((r) => ({
      url: r.url,
      method: r.method,
      bodyLength: r.body.length,
      bodyPreview: r.body.slice(0, 2000),
    })),
    wireRequests: wire.map((r) => ({
      url: r.url,
      method: r.method,
      status: r.status,
      mimeType: r.mimeType,
      headerKeys: Object.keys(r.headers || {}),
      hasCookieHeader: Object.keys(r.headers || {}).some((k) => k.toLowerCase() === 'cookie'),
      postDataLength: r.postData ? r.postData.length : null,
      postDataPreview: r.postData ? r.postData.slice(0, 2000) : null,
      dataChunks: r.dataChunks,
      dataBytes: r.dataBytes,
      finished: r.finished,
      failed: r.failed,
    })),
    consoleErrors: consoleMsgs.filter((m) => m.type === 'error' || m.type === 'pageerror').slice(0, 20),
    dwplusLogs: consoleMsgs.filter((m) => m.text.includes('DWPLUS')).slice(0, 30),
  };
  fs.writeFileSync(path.resolve(RESULTS_DIR, 'phase2-01-hook-body.json'), JSON.stringify(out, null, 2));
  console.log('WROTE playwright-results/phase2-01-hook-body.json');
  console.log('ORIG_COUNT:', origRequests.length, 'WIRE_COUNT:', wire.length);
  await page.screenshot({ path: path.resolve(RESULTS_DIR, 'phase2-01-hook-body.png'), fullPage: false });
  await ctx.close();
})().catch((e) => {
  console.error('FATAL:', e.stack || e.message);
  process.exit(1);
});
