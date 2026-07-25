// scripts/verify-phase2/probe-08-exploratory.cjs
// RC 阶段探索性测试（Exploratory Testing）
// 不按固定断言脚本走，而是模拟真实用户的多样化行为，记录观察到的一切异常：
//   E1 冷启动观察：自检报告 / 诊断导出 / selector health
//   E2 特殊字符消息：emoji + 引号 + 反斜杠 + <标签>（JSON 转义与页面回显）
//   E3 多行消息（Shift+Enter）
//   E4 Skill 弹窗取消路径：输入 / 后 Esc 再发普通消息
//   E5 快速连发两条（第一条未回完就发第二条）
//   E6 空输入发送尝试
//   E7 " / " 开头但不是 skill 的文本（/notaskill xyz）
//   E8 结束快照：诊断导出 + console error 清点
// 输出 playwright-results/phase2-08-exploratory.json，观察项人工归档到 RC 报告。
const path = require('path');
const fs = require('fs');
const {
  RESULTS_DIR,
  launch,
  installCdpCapture,
  installConsoleCapture,
  waitForReplyStable,
} = require('./lib.cjs');

const COMPLETION_PATH = '/chat/completion';

function extractText(postData) {
  try {
    const parsed = JSON.parse(postData);
    return parsed?.messages?.[0]?.content_block?.[0]?.content?.text_block?.text ?? null;
  } catch {
    return null;
  }
}

function summarize(wire, sinceTs, marker) {
  return wire
    .filter((r) => r.url.includes(COMPLETION_PATH) && r.ts >= sinceTs)
    .map((r) => {
      const text = extractText(r.postData);
      return {
        status: r.status,
        finished: r.finished,
        failed: r.failed,
        textLength: text ? text.length : null,
        containsMarker: marker && text ? text.includes(marker) : null,
        augmented: text ? text.includes('## 角色') || text.includes('## Role') : false,
        userTextEcho: text ? text.slice(-160) : null,
      };
    });
}

async function typeAndSend(page, text, { multiline = false } = {}) {
  const ta = page.locator('textarea').first();
  await ta.click();
  if (multiline) {
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      await ta.pressSequentially(lines[i], { delay: 8 });
      if (i < lines.length - 1) await ta.press('Shift+Enter');
    }
  } else {
    await ta.pressSequentially(text, { delay: 8 });
  }
  await ta.press('Enter');
}

(async () => {
  const { ctx, page } = await launch();
  const consoleLog = installConsoleCapture(page);
  const { wire } = await installCdpCapture(ctx, page);
  const findings = [];
  const note = (id, observation, data = null) => {
    findings.push({ id, observation, data });
    console.log(`[${id}] ${observation}`);
  };

  await page.goto('https://www.doubao.com/chat/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);

  // E1 冷启动观察
  const startup = await page.evaluate(() => ({
    diag: window.__DWPLUS_DIAG__ ?? null,
    exportFn: typeof window.__DWPLUS_EXPORT_DIAG__,
    exported: typeof window.__DWPLUS_EXPORT_DIAG__ === 'function' ? window.__DWPLUS_EXPORT_DIAG__() : null,
  }));
  note('E1', `selfCheck passed=${startup.diag?.selfCheck?.passed} errors=${startup.diag?.selfCheck?.errorCount} warns=${startup.diag?.selfCheck?.warnCount}; export=${startup.exportFn}`, {
    selfCheck: startup.diag?.selfCheck ?? null,
    selectorHealth: startup.diag?.selectorHealth ?? null,
    adapterVersion: startup.exported?.adapter?.adapterVersion ?? null,
  });

  // E2 特殊字符
  let t0 = Date.now();
  const special = 'E2标记4407：emoji😀 "双引号" \\反斜杠\\ <b>标签</b> {"json":1} 只回答标记数字';
  await typeAndSend(page, special);
  await waitForReplyStable(page, { timeoutMs: 60000 });
  note('E2', 'special chars sent', summarize(wire, t0, 'E2标记4407'));

  // E3 多行消息
  t0 = Date.now();
  await typeAndSend(page, 'E3标记8823 第一行\n第二行\n第三行——只回答标记数字', { multiline: true });
  await waitForReplyStable(page, { timeoutMs: 60000 });
  note('E3', 'multiline sent', summarize(wire, t0, 'E3标记8823'));

  // E4 Skill 弹窗取消：输入 / 触发弹窗 → Esc → 清空 → 发普通消息
  t0 = Date.now();
  {
    const ta = page.locator('textarea').first();
    await ta.click();
    await ta.pressSequentially('/she', { delay: 40 });
    await page.waitForTimeout(600);
    const popupVisible = await page.evaluate(() =>
      Boolean(document.querySelector('.dwplus-skill-popup')?.offsetParent));
    await ta.press('Escape');
    await page.waitForTimeout(300);
    const popupAfterEsc = await page.evaluate(() =>
      Boolean(document.querySelector('.dwplus-skill-popup')?.offsetParent));
    // 清空输入框再发普通消息
    await ta.press('Control+a');
    await ta.press('Delete');
    await ta.pressSequentially('E4标记6650 弹窗取消后普通消息，只回答标记数字', { delay: 8 });
    await ta.press('Enter');
    await waitForReplyStable(page, { timeoutMs: 60000 });
    note('E4', `popup visible=${popupVisible} afterEsc=${popupAfterEsc}`, summarize(wire, t0, 'E4标记6650'));
  }

  // E5 快速连发：第一条发出后 1.2s 立即发第二条（不等回复完成）
  t0 = Date.now();
  await typeAndSend(page, 'E5a标记1199 请慢慢用200字介绍豆包');
  await page.waitForTimeout(1200);
  try {
    await typeAndSend(page, 'E5b标记2288 只回答这个标记数字');
  } catch (err) {
    note('E5-send2', `second rapid send blocked: ${String(err).slice(0, 160)}`);
  }
  await waitForReplyStable(page, { timeoutMs: 90000 });
  note('E5', 'rapid double-send', summarize(wire, t0, null));

  // E6 空输入发送
  t0 = Date.now();
  {
    const ta = page.locator('textarea').first();
    await ta.click();
    await ta.press('Enter');
    await page.waitForTimeout(1500);
    const sent = wire.filter((r) => r.url.includes(COMPLETION_PATH) && r.ts >= t0);
    note('E6', `empty enter produced ${sent.length} completion requests (expect 0)`);
  }

  // E7 非注册 skill 的斜杠文本
  t0 = Date.now();
  await typeAndSend(page, '/notaskill E7标记3377 只回答标记数字');
  await waitForReplyStable(page, { timeoutMs: 60000 });
  const e7 = summarize(wire, t0, 'E7标记3377');
  note('E7', `unregistered /command: sent-as-is=${e7[0]?.userTextEcho?.includes('/notaskill') ?? 'n/a'}`, e7);

  // E8 结束快照
  const final = await page.evaluate(() =>
    typeof window.__DWPLUS_EXPORT_DIAG__ === 'function' ? window.__DWPLUS_EXPORT_DIAG__() : null);
  const dwplusErrors = consoleLog.filter((l) => l.type === 'error' && l.text.includes('DWPLUS'));
  const pageErrors = consoleLog.filter((l) => l.type === 'error' && !l.text.includes('DWPLUS'));
  note('E8', `final lastAugmentation modified=${final?.lastAugmentation?.modified} err=${final?.lastAugmentation?.error}; dwplus errors=${dwplusErrors.length}, page errors=${pageErrors.length}`, {
    lastAugmentation: final?.lastAugmentation ?? null,
    selfCheck: final?.selfCheck ?? null,
    dwplusErrors: dwplusErrors.map((l) => l.text.slice(0, 300)),
  });

  const out = {
    generatedAt: new Date().toISOString(),
    findings,
    dwplusLogs: consoleLog.filter((l) => l.text.includes('DWPLUS')).map((l) => `${l.type}: ${l.text.slice(0, 220)}`),
    consoleErrors: pageErrors.map((l) => l.text.slice(0, 300)),
  };
  fs.writeFileSync(path.join(RESULTS_DIR, 'phase2-08-exploratory.json'), JSON.stringify(out, null, 2));
  console.log('WROTE playwright-results/phase2-08-exploratory.json');
  await ctx.close();
})().catch((err) => {
  console.error('EXPLORATORY FAILED:', err);
  process.exit(1);
});
