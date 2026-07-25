// scripts/verify-phase2/probe-06-body-structures.cjs
// 任务 1：采集豆包真实聊天请求的数据结构（只采集，不验证增强）
//   场景覆盖：
//     S1 新建会话（首条消息）
//     S2 多轮聊天（同会话第 2、3 条）
//     S3 Skill 命令（/shell ...）
//     S4 长文本（约 3000 字符）
//     S5 深度思考模式（若页面提供开关则尝试，失败不阻断）
//   输出：playwright-results/phase2-06-body-structures.json
//     每个场景记录完整 completion 请求 body + prompt 实际路径探测结果
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

const COMPLETION_PATH = '/chat/completion';

/** 递归寻找 body 中所有等于目标文本（或包含标记子串）的字符串字段路径 */
function findTextPaths(obj, marker, basePath = '') {
  const hits = [];
  const walk = (node, p) => {
    if (node == null) return;
    if (typeof node === 'string') {
      if (node.includes(marker)) hits.push({ path: p, length: node.length, exact: node === marker });
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, `${p}[${i}]`));
      return;
    }
    if (typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) walk(v, p ? `${p}.${k}` : k);
    }
  };
  walk(obj, basePath);
  return hits;
}

/** 提取 body 顶层结构骨架（键名 + 类型，不含具体值），用于对比场景间结构差异 */
function skeleton(node, depth = 0, maxDepth = 6) {
  if (node == null) return String(node);
  if (typeof node !== 'object') return typeof node;
  if (depth >= maxDepth) return Array.isArray(node) ? '[...]' : '{...}';
  if (Array.isArray(node)) {
    return node.length === 0 ? '[]' : [skeleton(node[0], depth + 1, maxDepth), `(len=${node.length})`];
  }
  const out = {};
  for (const [k, v] of Object.entries(node)) out[k] = skeleton(v, depth + 1, maxDepth);
  return out;
}

function snapshotCompletions(wire, sinceTs) {
  return wire
    .filter((r) => r.url.includes(COMPLETION_PATH) && r.ts >= sinceTs)
    .map((r) => ({ url: r.url.slice(0, 120), postData: r.postData, status: r.status, mimeType: r.mimeType, ts: r.ts }));
}

(async () => {
  const { ctx, page } = await launch();
  const consoleMsgs = installConsoleCapture(page);
  const { wire, fillPostData } = await installCdpCapture(ctx, page);

  await page.goto('https://www.doubao.com/chat/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(6000);

  const scenarios = [];

  async function runScenario(name, marker, text, opts = {}) {
    const since = Date.now();
    let sendVia = null;
    let error = null;
    try {
      if (opts.beforeSend) await opts.beforeSend();
      sendVia = await sendMessage(page, text);
      await waitForReplyStable(page, { timeoutMs: 75000 });
    } catch (e) {
      error = String(e.message || e).slice(0, 300);
    }
    await fillPostData();
    const reqs = snapshotCompletions(wire, since);
    const analyzed = reqs.map((r) => {
      let parsed = null;
      let promptPaths = [];
      let skel = null;
      try {
        parsed = JSON.parse(r.postData);
        promptPaths = findTextPaths(parsed, marker);
        skel = skeleton(parsed);
      } catch {}
      return {
        url: r.url,
        status: r.status,
        mimeType: r.mimeType,
        bodyLength: r.postData ? r.postData.length : null,
        promptPaths,
        clientMeta: parsed?.client_meta ?? null,
        optionKeys: parsed?.option ? Object.keys(parsed.option) : null,
        optionSubset: parsed?.option
          ? {
              need_create_conversation: parsed.option.need_create_conversation,
              is_regen: parsed.option.is_regen,
              need_deep_think: parsed.option.need_deep_think,
              agent_mode: parsed.option.agent_mode,
            }
          : null,
        messagesShape: parsed?.messages ? skeleton(parsed.messages) : null,
        fullSkeleton: skel,
        fullBody: r.postData,
      };
    });
    scenarios.push({ name, marker, sendVia, error, completionCount: reqs.length, requests: analyzed });
    console.log(`[S] ${name}: completion=${reqs.length} promptPaths=${analyzed.map((a) => a.promptPaths.map((p) => p.path).join(';')).join(' | ')}`);
  }

  // ===== S1 新建会话（首条消息）=====
  const m1 = 'P6S1标记' + Math.floor(Math.random() * 10000);
  await runScenario('S1-新会话首条', m1, `请只回答一个数字：${m1} 中的数字部分是多少？`);

  // ===== S2 多轮（同会话第 2、3 条）=====
  const m2 = 'P6S2标记' + Math.floor(Math.random() * 10000);
  await runScenario('S2-多轮第2条', m2, `继续：${m2} 的数字加一是多少？只回答数字。`);
  const m3 = 'P6S2b标记' + Math.floor(Math.random() * 10000);
  await runScenario('S2-多轮第3条', m3, `再继续：${m3} 的数字减一是多少？只回答数字。`);

  // ===== S3 Skill 命令 =====
  const m4 = '/shell 列出当前目录P6S3';
  await runScenario('S3-Skill命令', 'P6S3', m4);

  // ===== S4 长文本（~3000 字符）=====
  const m5 = 'P6S4标记' + Math.floor(Math.random() * 10000);
  const longText = `${m5} 以下是一段长文本，请回答"收到"两个字即可。` + '天地玄黄，宇宙洪荒。日月盈昃，辰宿列张。'.repeat(140);
  await runScenario('S4-长文本', m5, longText);

  // ===== S5 深度思考（尝试点击开关，失败不阻断）=====
  const m6 = 'P6S5标记' + Math.floor(Math.random() * 10000);
  await runScenario('S5-深度思考', m6, `${m6}：1+1=?只回答数字。`, {
    beforeSend: async () => {
      const toggle = page
        .locator('button:has-text("深度思考"), [class*="deep-think"], [class*="deepthink"]')
        .first();
      if ((await toggle.count()) > 0 && (await toggle.isVisible())) {
        await toggle.click({ timeout: 2000 }).catch(() => {});
        await page.waitForTimeout(500);
      } else {
        throw new Error('深度思考开关未找到（跳过场景，不算失败）');
      }
    },
  });

  const out = {
    generatedAt: new Date().toISOString(),
    scenarios,
    dwplusLogs: consoleMsgs.filter((m) => m.text.includes('DWPLUS')).slice(0, 40),
  };
  fs.writeFileSync(path.resolve(RESULTS_DIR, 'phase2-06-body-structures.json'), JSON.stringify(out, null, 2));
  console.log('WROTE playwright-results/phase2-06-body-structures.json');
  await ctx.close();
})().catch((e) => {
  console.error('FATAL:', e.stack || e.message);
  process.exit(1);
});
