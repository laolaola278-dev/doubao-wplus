// scripts/verify-phase2/probe-02-stream-skill.cjs
// 验证 4（流式）+ 验证 3 补充（skill 命令最终发送内容）
const path = require('path');
const fs = require('fs');
const {
  RESULTS_DIR,
  launch,
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

  // ---- TEST A：长回复 + Markdown + 代码块（流式验证）----
  await sendMessage(
    page,
    '请输出一个包含以下内容的示例（不要解释）：一个二级markdown标题、一个3项无序列表、一个python代码块（打印1到5）、一个表格（2列2行）。',
  );
  const streamDone = await waitForReplyStable(page, { timeoutMs: 120000, stableMs: 4000 });
  console.log('TESTA_REPLY_STABLE:', streamDone);
  await fillPostData();

  const domCheck = await page.evaluate(() => ({
    codeBlocks: document.querySelectorAll('pre code, pre').length,
    tables: document.querySelectorAll('table').length,
    lists: document.querySelectorAll('ul li').length,
    h2: document.querySelectorAll('h2, [class*="heading"]').length,
    bodyLen: (document.body.innerText || '').length,
  }));
  console.log('TESTA_DOM:', JSON.stringify(domCheck));

  const compA = wire.filter((r) => r.url.includes('/chat/completion'));
  console.log(
    'TESTA_STREAM:',
    JSON.stringify(
      compA.map((r) => ({
        status: r.status,
        mime: r.mimeType,
        chunks: r.dataChunks,
        bytes: r.dataBytes,
        finished: r.finished,
        failed: r.failed,
      })),
    ),
  );
  await page.screenshot({ path: path.resolve(RESULTS_DIR, 'phase2-02a-stream.png') });

  // ---- TEST B：/skill 命令 → 检查最终发送 body 是否展开 ----
  const wireCountBefore = wire.length;
  const ta = page.locator('textarea').first();
  await ta.click();
  await ta.fill('');
  await page.keyboard.type('/', { delay: 100 });
  await page.waitForTimeout(1200);
  const popupState = await page.evaluate(() => {
    const popup = document.querySelector('.dwplus-skill-popup');
    return {
      exists: !!popup,
      visible: popup ? popup.style.display !== 'none' : false,
      itemCount: popup ? popup.querySelectorAll('.dwplus-skill-trigger, [class*="skill-item"], li').length : 0,
      firstItems: popup ? Array.from(popup.querySelectorAll('*')).slice(0, 3).map((e) => e.textContent?.slice(0, 40)) : [],
    };
  });
  console.log('TESTB_POPUP:', JSON.stringify(popupState));
  await page.screenshot({ path: path.resolve(RESULTS_DIR, 'phase2-02b-popup.png') });

  if (popupState.visible) {
    await page.keyboard.press('Enter'); // 选中第一个 skill
    await page.waitForTimeout(800);
  }
  const taValue = await page.evaluate(() => document.querySelector('textarea')?.value);
  console.log('TESTB_TEXTAREA_AFTER_SELECT:', JSON.stringify(taValue));

  // 追加参数并发送
  await page.keyboard.type('测试技能参数内容', { delay: 30 });
  await page.waitForTimeout(400);
  const via = await sendMessage(page, (await page.evaluate(() => document.querySelector('textarea')?.value)) || '/test');
  console.log('TESTB_SEND_VIA:', via);
  await waitForReplyStable(page, { timeoutMs: 90000 });
  await fillPostData();

  const compB = wire.slice(wireCountBefore).filter((r) => r.url.includes('/chat/completion'));
  console.log(
    'TESTB_SENT_BODY:',
    JSON.stringify(
      compB.map((r) => ({
        status: r.status,
        postDataPreview: r.postData ? r.postData.slice(0, 1200) : null,
      })),
      null,
      2,
    ),
  );

  const out = {
    testA: { streamDone, domCheck, completions: compA },
    testB: { popupState, taValue, completions: compB.map((r) => ({ url: r.url, postData: r.postData })) },
    consoleErrors: consoleMsgs.filter((m) => m.type === 'error' || m.type === 'pageerror').map((m) => m.text.slice(0, 200)),
    dwplusLogs: consoleMsgs.filter((m) => m.text.includes('DWPLUS')).map((m) => m.text.slice(0, 250)),
  };
  fs.writeFileSync(path.resolve(RESULTS_DIR, 'phase2-02-stream-skill.json'), JSON.stringify(out, null, 2));
  console.log('WROTE phase2-02-stream-skill.json');
  await page.screenshot({ path: path.resolve(RESULTS_DIR, 'phase2-02c-final.png') });
  await ctx.close();
})().catch((e) => {
  console.error('FATAL:', e.stack || e.message);
  process.exit(1);
});
