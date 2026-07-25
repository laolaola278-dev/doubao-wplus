// scripts/verify-phase2/probe-09-prompt-inspector.cjs
// Prompt Inspector 真机冒烟：
//   1. 发一条普通消息 → __DWPLUS_DIAG__.lastPromptSnapshot 摘要出现且 augmentSucceeded
//   2. Ctrl+Shift+P 打开面板 → 5 个 Timeline 节点渲染
//   3. 诊断导出含 lastPromptSnapshot
const path = require('path');
const fs = require('fs');
const { RESULTS_DIR, launch, installConsoleCapture, waitForReplyStable } = require('./lib.cjs');

(async () => {
  const { ctx, page } = await launch();
  const consoleLog = installConsoleCapture(page);
  await page.goto('https://www.doubao.com/chat/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);

  const ta = page.locator('textarea').first();
  await ta.click();
  await ta.pressSequentially('P9标记5511 只回答标记数字', { delay: 10 });
  await ta.press('Enter');
  await waitForReplyStable(page, { timeoutMs: 60000 });

  const snapshotSummary = await page.evaluate(() => window.__DWPLUS_DIAG__?.lastPromptSnapshot ?? null);
  const exported = await page.evaluate(() =>
    typeof window.__DWPLUS_EXPORT_DIAG__ === 'function'
      ? { hasSnapshot: Boolean(window.__DWPLUS_EXPORT_DIAG__().lastPromptSnapshot) }
      : null);

  // 打开面板（快捷键发往页面）
  await page.keyboard.press('Control+Shift+P');
  await page.waitForTimeout(800);
  const panel = await page.evaluate(() => {
    const el = document.getElementById('dwplus-prompt-inspector');
    if (!el) return null;
    return {
      visible: el.style.display !== 'none',
      stageCount: el.querySelectorAll('.dwplus-pi-stage').length,
      metaText: el.querySelector('.dwplus-pi-meta')?.textContent?.slice(0, 200) ?? '',
    };
  });

  const inspectorLogs = consoleLog.filter((l) => l.text.includes('DWPLUS-INSPECTOR')).map((l) => l.text.slice(0, 200));
  const out = { generatedAt: new Date().toISOString(), snapshotSummary, exported, panel, inspectorLogs };
  fs.writeFileSync(path.join(RESULTS_DIR, 'phase2-09-prompt-inspector.json'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ snapshotSummary: Boolean(snapshotSummary), panel }, null, 2));
  console.log('WROTE playwright-results/phase2-09-prompt-inspector.json');
  await ctx.close();
})().catch((err) => { console.error('PROBE-09 FAILED:', err); process.exit(1); });
