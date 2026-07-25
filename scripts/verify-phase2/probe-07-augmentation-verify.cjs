// scripts/verify-phase2/probe-07-augmentation-verify.cjs
// 任务 5：修复后真机回归验证
//   V1 普通聊天：hook 命中 + 最终发送 body 含增强 prompt + 响应 200（签名兼容性 P0-3）
//   V2 Skill 注入：/shell 命令在最终 body 中展开为 Skill 指令
//   V3 Prompt 增强：增强文本包含系统 prompt 脚手架标记
//   V4 页面回显清洗：用户气泡是否只显示原始输入（sanitize 链路，观察项）
//   V5 多轮对话：第 2 条消息同样被增强且服务端接受
// 对比来源：页面层包装器抓「原始 body」，CDP 抓「最终发送 body」
const path = require('path');
const fs = require('fs');
const {
  RESULTS_DIR,
  launch,
  installOriginalBodyCapture,
  installCdpCapture,
  installConsoleCapture,
  sendMessage,
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

function summarizeCompletion(wire, sinceTs, marker) {
  const reqs = wire.filter((r) => r.url.includes(COMPLETION_PATH) && r.ts >= sinceTs);
  return reqs.map((r) => {
    const text = extractText(r.postData);
    return {
      status: r.status,
      mimeType: r.mimeType,
      finished: r.finished,
      failed: r.failed,
      dataBytes: r.dataBytes,
      bodyLength: r.postData ? r.postData.length : null,
      textLength: text ? text.length : null,
      containsMarker: text ? text.includes(marker) : false,
      // 增强标记：系统 prompt 脚手架的标题（中英文任一）
      augmented: text ? (text.includes('## 角色') || text.includes('## Role')) : false,
      textPreview: text ? text.slice(0, 300) : null,
      textTail: text ? text.slice(-200) : null,
    };
  });
}

(async () => {
  const { ctx, page } = await launch();
  const consoleMsgs = installConsoleCapture(page);
  const { wire, fillPostData } = await installCdpCapture(ctx, page);

  await page.goto('https://www.doubao.com/chat/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(6000);
  await installOriginalBodyCapture(page);

  const verdicts = {};

  // ===== V1+V3 普通聊天（新会话首条）=====
  const m1 = 'V7普通' + Math.floor(Math.random() * 10000);
  let since = Date.now();
  await sendMessage(page, `请用一句话回答：${m1} 是什么？`);
  const v1Reply = await waitForReplyStable(page, { timeoutMs: 90000 });
  await fillPostData();
  const origBodies1 = await page.evaluate(() => (window.__P2_ORIG_REQUESTS__ || []).map((r) => ({ url: r.url, body: r.body })));
  const v1 = summarizeCompletion(wire, since, m1);
  const orig1 = origBodies1.filter((r) => r.url.includes(COMPLETION_PATH)).map((r) => extractText(r.body)).filter(Boolean);
  verdicts.V1_normal_chat = {
    replyStable: v1Reply,
    completions: v1,
    originalTextLengths: orig1.map((t) => t.length),
    hookModifiedBody: v1.some((r) => r.augmented) && orig1.every((t) => !t.includes('## 角色') && !t.includes('## Role')),
    serverAccepted: v1.some((r) => r.status === 200 && r.mimeType === 'text/event-stream' && !r.failed),
  };
  console.log('V1:', JSON.stringify({ ...verdicts.V1_normal_chat, completions: v1.map((r) => ({ status: r.status, augmented: r.augmented, containsMarker: r.containsMarker, textLength: r.textLength })) }));

  // ===== V5 多轮（同会话第 2 条）=====
  const m2 = 'V7多轮' + Math.floor(Math.random() * 10000);
  since = Date.now();
  await sendMessage(page, `继续回答：${m2} 加一等于几？`);
  const v5Reply = await waitForReplyStable(page, { timeoutMs: 90000 });
  await fillPostData();
  const v5 = summarizeCompletion(wire, since, m2);
  verdicts.V5_multi_turn = {
    replyStable: v5Reply,
    completions: v5.map((r) => ({ status: r.status, augmented: r.augmented, containsMarker: r.containsMarker, textLength: r.textLength })),
    serverAccepted: v5.some((r) => r.status === 200 && !r.failed),
    augmented: v5.some((r) => r.augmented),
  };
  console.log('V5:', JSON.stringify(verdicts.V5_multi_turn));

  // ===== V2 Skill 注入 =====
  since = Date.now();
  await sendMessage(page, '/shell 列出当前目录V7SKILL');
  const v2Reply = await waitForReplyStable(page, { timeoutMs: 90000 });
  await fillPostData();
  const v2 = summarizeCompletion(wire, since, 'V7SKILL');
  // Skill 展开判定：最终 body 不再以 /shell 开头，且包含 Skill instructions 的特征
  const v2Analysis = v2.map((r) => ({
    status: r.status,
    textLength: r.textLength,
    startsWithSlash: r.textPreview ? r.textPreview.trimStart().startsWith('/shell') : null,
    augmented: r.augmented,
    containsMarker: r.containsMarker,
  }));
  verdicts.V2_skill_injection = {
    replyStable: v2Reply,
    completions: v2Analysis,
    skillExpanded: v2.some((r) => r.augmented && r.textLength > 500 && !(r.textPreview || '').trimStart().startsWith('/shell')),
    serverAccepted: v2.some((r) => r.status === 200 && !r.failed),
  };
  console.log('V2:', JSON.stringify(verdicts.V2_skill_injection));

  // ===== V4 页面回显（观察项）=====
  const echo = await page.evaluate((marker) => {
    const bodyText = document.body.innerText || '';
    return {
      pageShowsMarker: bodyText.includes(marker),
      pageLeaksScaffold: bodyText.includes('## 角色') || bodyText.includes('## Role'),
    };
  }, m1);
  verdicts.V4_page_echo = echo;
  console.log('V4:', JSON.stringify(echo));

  const out = {
    generatedAt: new Date().toISOString(),
    verdicts,
    dwplusLogs: consoleMsgs.filter((m) => m.text.includes('DWPLUS')).map((m) => m.text).slice(0, 50),
    consoleErrors: consoleMsgs.filter((m) => m.type === 'error' || m.type === 'pageerror').map((m) => m.text).slice(0, 20),
  };
  fs.writeFileSync(path.resolve(RESULTS_DIR, 'phase2-07-augmentation-verify.json'), JSON.stringify(out, null, 2));
  console.log('WROTE playwright-results/phase2-07-augmentation-verify.json');
  await page.screenshot({ path: path.resolve(RESULTS_DIR, 'phase2-07-verify.png') });
  await ctx.close();
})().catch((e) => {
  console.error('FATAL:', e.stack || e.message);
  process.exit(1);
});
