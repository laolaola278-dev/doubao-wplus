// scripts/verify-phase2/probe-04-skill-send.cjs
// 聚焦验证：/skill 命令发送后，最终发出的 completion body 里是展开的 Skill 指令还是原始 "/shell ..." 文本
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

  await page.goto('https://www.doubao.com/chat/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(6000);

  const ta = page.locator('textarea').first();
  await ta.click();
  await page.keyboard.type('/', { delay: 120 });
  await page.waitForTimeout(1200);
  const popupVisible = await page.evaluate(() => {
    const p = document.querySelector('.dwplus-skill-popup');
    return !!p && p.style.display !== 'none';
  });
  if (popupVisible) await page.keyboard.press('Enter');
  await page.waitForTimeout(600);
  await page.keyboard.type('列出当前目录', { delay: 30 });
  await page.waitForTimeout(400);
  const taValue = await page.evaluate(() => document.querySelector('textarea')?.value);
  console.log('TEXTAREA_BEFORE_SEND:', JSON.stringify(taValue));
  await page.keyboard.press('Enter');

  await waitForReplyStable(page, { timeoutMs: 45000, stableMs: 3000 });
  await fillPostData();

  const comps = wire.filter((r) => r.url.includes('/chat/completion'));
  const result = comps.map((r) => {
    let sentText = null;
    try {
      const body = JSON.parse(r.postData);
      sentText = body?.messages?.[0]?.content_block?.[0]?.content?.text_block?.text ?? null;
    } catch {}
    return { url: r.url.slice(0, 90), status: r.status, mime: r.mimeType, chunks: r.dataChunks, bytes: r.dataBytes, sentText, bodyLen: r.postData?.length ?? null };
  });
  console.log('COMPLETIONS:', JSON.stringify(result, null, 2));
  console.log(
    'DWPLUS_FETCH_LOGS:',
    JSON.stringify(consoleMsgs.filter((m) => m.text.includes('DWPLUS-FETCH') || m.text.includes('augment')).map((m) => m.text.slice(0, 220)), null, 2),
  );

  fs.writeFileSync(
    path.resolve(RESULTS_DIR, 'phase2-04-skill-send.json'),
    JSON.stringify({ taValue, result, logs: consoleMsgs.filter((m) => m.text.includes('DWPLUS')).map((m) => m.text.slice(0, 250)) }, null, 2),
  );
  await page.screenshot({ path: path.resolve(RESULTS_DIR, 'phase2-04-skill-send.png') });
  await ctx.close();
})().catch((e) => {
  console.error('FATAL:', e.stack || e.message);
  process.exit(1);
});
