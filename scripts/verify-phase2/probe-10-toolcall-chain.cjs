// scripts/verify-phase2/probe-10-toolcall-chain.cjs
// Tool Calling 链路定位探针（只观测，不改业务逻辑）
//
// 覆盖 4 个场景：
//   T1 请生成 README.md（期望 artifact_create）
//   T2 请生成 test.md（期望 artifact_create）
//   T3 /office 生成 Word 文档（观察 skill 是否命中；office 不是已注册 skill 名）
//   T4 /shell 创建一个文件（期望 shell skill 展开；观察 shell_exec 是否可用）
//
// 每个场景记录：
//   - 原始输入 / 最终发送 body（CDP）/ 最终 prompt 是否含 Tool Descriptor
//   - 响应 SSE 原始数据（CDP Network.streamResourceContent，本仓库首次捕获）
//   - 页面可见回复文本 / 页面是否泄漏原始 XML 工具标签
//   - #dwplus-tool-block 是否出现（TOOL_CALL 是否被识别并渲染）
//   - background 工具历史（deepseek_pp_tool_history，经 service worker 读取）
//   - DWPLUS console 日志
const path = require('path');
const fs = require('fs');
const {
  RESULTS_DIR,
  launch,
  installConsoleCapture,
  sendMessage,
  waitForReplyStable,
} = require('./lib.cjs');

const COMPLETION_PATH = '/chat/completion';
const TOOL_TAG_RE = /<\/?(artifact_create|artifact_bundle_create|shell_exec|shell_status|memory_save|web_search|web_fetch|skill_create|memory_import)[\s>]/;

function extractPromptText(postData) {
  try {
    const parsed = JSON.parse(postData);
    return parsed?.messages?.[0]?.content_block?.[0]?.content?.text_block?.text ?? null;
  } catch {
    return null;
  }
}

function extractRequestMeta(postData) {
  try {
    const parsed = JSON.parse(postData);
    return {
      agentMode: parsed?.option?.agent_mode,
      sceneType: parsed?.option?.scene_type,
      needDeepThink: parsed?.option?.need_deep_think,
    };
  } catch {
    return null;
  }
}

function extractResponseTextFromParsed(parsed) {
  if (parsed?.o === 'BATCH' && Array.isArray(parsed.v)) {
    return parsed.v.map(extractResponseTextFromParsed).filter((part) => part != null).join('') || null;
  }
  if (!parsed?.p && typeof parsed?.v === 'string') return parsed.v;
  const path = typeof parsed?.p === 'string' ? parsed.p : '';
  const last = path.split('/').pop();
  const isResponseText = (path === 'response' || path.startsWith('response/')) &&
    ['content', 'text', 'markdown', 'delta'].includes(last);
  if (isResponseText && typeof parsed?.v === 'string' && (parsed.o === 'APPEND' || !parsed.o)) {
    return parsed.v;
  }
  if (path === 'response/fragments' && parsed?.o === 'APPEND' && Array.isArray(parsed.v)) {
    return parsed.v.map((frag) => typeof frag?.content === 'string' ? frag.content : typeof frag?.text === 'string' ? frag.text : '').join('') || null;
  }
  return null;
}

function decodeSseResponse(responseText) {
  const textParts = [];
  const events = [];
  for (const block of String(responseText || '').split('\n\n')) {
    if (!block.trim()) continue;
    const eventName = block.split('\n').find((line) => line.startsWith('event:'))?.slice(6).trim() || 'message';
    const dataLine = block.split('\n').find((line) => line.startsWith('data:'));
    if (!dataLine) continue;
    let parsed;
    try { parsed = JSON.parse(dataLine.slice(5).trim()); } catch { continue; }
    const responseTextPart = extractResponseTextFromParsed(parsed);
    if (responseTextPart) textParts.push(responseTextPart);
    const raw = JSON.stringify(parsed);
    if (/tool|function|write|skill|artifact|shell|docx|文件/i.test(raw)) {
      events.push({ event: eventName, data: raw.slice(0, 3000) });
    }
  }
  return { modelResponse: textParts.join(''), relevantEvents: events.slice(0, 200) };
}

/** CDP 抓包 + 响应流内容捕获（streamResourceContent） */
async function installCdpCaptureWithBody(ctx, page) {
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  if (process.env.DWPLUS_FINAL_PROMPT_MODE === 'minimal-artifact' ||
      process.env.DWPLUS_FINAL_PROMPT_MODE === 'single-artifact' ||
      process.env.DWPLUS_FINAL_PROMPT_MODE === 'single-office') {
    await cdp.send('Fetch.enable', {
      patterns: [{ urlPattern: '*://*.doubao.com/chat/completion*', requestStage: 'Request' }],
    });
    cdp.on('Fetch.requestPaused', async (event) => {
      try {
        const body = JSON.parse(event.request.postData || '{}');
        const target = body?.messages?.[0]?.content_block?.[0]?.content?.text_block;
        if (target && typeof target === 'object') {
          target.text = process.env.DWPLUS_FINAL_PROMPT_MODE === 'single-office'
            ? [
                '你是 WPlus 客户端命令规划器。不要调用豆包内置 Agent、Word、文档、代码或文件工具，不要在远端生成文档。',
                '唯一可用工具是 shell_exec，调用格式：<shell_exec>{"command":"...","timeout_ms":120000}</shell_exec>。',
                '用户任务：生成一个 2026 年七月工作总结模板 DOCX。',
                '命令必须在一次调用中依次执行 officecli create、向 /body 添加 Heading1 标题和至少两个 paragraph、officecli validate --json、officecli view text。使用安全的相对文件名 2026-07-work-summary.docx，多条命令用分号连接。',
                '本轮最终回复必须只包含一个原始 shell_exec XML 工具块。不要解释，不要使用 Markdown 代码块。',
              ].join('\n')
            : process.env.DWPLUS_FINAL_PROMPT_MODE === 'minimal-artifact'
            ? [
                '不要调用豆包内置 Agent、文档工具、代码工具或文件工具。',
                '这是一个客户端文本协议测试。你的最终回复必须且只能是下面这段纯文本 XML；不要解释，不要使用 Markdown 代码块：',
                '<artifact_create>{"filename":"test.md","content":"# Test\\n\\nTool calling verification."}</artifact_create>',
              ].join('\n')
            : [
                '你是 WPlus 客户端工具规划器。不要调用豆包内置 Agent、文档、代码或文件工具，也不要在远端工作区创建文件。',
                '唯一可用工具：artifact_create。参数 JSON Schema：{"type":"object","properties":{"filename":{"type":"string"},"content":{"type":"string"},"mimeType":{"type":"string"}},"required":["filename","content"],"additionalProperties":false}',
                '用户任务：请生成 test.md，内容由你自行编写，包含一个标题和一句测试说明。',
                '本轮最终回复必须只包含一个原始 XML 工具块，格式为 <artifact_create>{合法 JSON}</artifact_create>。不要解释，不要使用 Markdown 代码块。',
              ].join('\n');
        }
        await cdp.send('Fetch.continueRequest', {
          requestId: event.requestId,
          postData: Buffer.from(JSON.stringify(body), 'utf8').toString('base64'),
        });
      } catch {
        await cdp.send('Fetch.continueRequest', { requestId: event.requestId }).catch(() => {});
      }
    });
  }
  const wire = [];
  const byId = new Map();
  cdp.on('Network.requestWillBeSent', (e) => {
    const { request, requestId } = e;
    if (!request.url.includes('doubao.com') || request.method !== 'POST') return;
    const rec = {
      requestId,
      url: request.url,
      postData: request.postData ?? null,
      hasPostData: !!request.hasPostData,
      status: null,
      mimeType: null,
      responseChunks: [],
      responseText: null,
      streamCaptureError: null,
      finished: false,
      failed: null,
      ts: Date.now(),
    };
    byId.set(requestId, rec);
    wire.push(rec);
    // 对 completion 请求开启响应流捕获
    if (request.url.includes(COMPLETION_PATH)) {
      cdp.send('Network.streamResourceContent', { requestId }).then((r) => {
        if (r?.bufferedData) rec.responseChunks.push(r.bufferedData);
      }).catch((err) => {
        rec.streamCaptureError = String(err?.message || err).slice(0, 200);
      });
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
    if (e.data) rec.responseChunks.push(e.data);
  });
  cdp.on('Network.loadingFinished', (e) => {
    const rec = byId.get(e.requestId);
    if (!rec) return;
    rec.finished = true;
    try {
      rec.responseText = Buffer.concat(
        rec.responseChunks.map((b) => Buffer.from(b, 'base64')),
      ).toString('utf8');
    } catch (err) {
      rec.streamCaptureError = rec.streamCaptureError || String(err?.message || err).slice(0, 200);
    }
    rec.responseChunks = [];
  });
  cdp.on('Network.loadingFailed', (e) => {
    const rec = byId.get(e.requestId);
    if (rec) rec.failed = e.errorText;
  });
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

async function readToolHistory(ctx) {
  try {
    let sw = ctx.serviceWorkers()[0];
    if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 5000 }).catch(() => null);
    if (!sw) return { error: 'no service worker' };
    return await sw.evaluate(async () => {
      const data = await chrome.storage.local.get([
        'deepseek_pp_tool_history',
        'deepseek_pp_mcp_servers',
        'deepseek_pp_artifacts',
      ]);
      const history = data.deepseek_pp_tool_history || [];
      const mcpState = data.deepseek_pp_mcp_servers || {};
      const artifacts = data.deepseek_pp_artifacts || [];
      let descriptors = [];
      try {
        descriptors = await chrome.runtime.sendMessage({ type: 'GET_TOOL_DESCRIPTORS' }) || [];
      } catch {}
      return {
        historyCount: Array.isArray(history) ? history.length : -1,
        recent: (Array.isArray(history) ? history : []).slice(0, 10).map((h) => ({
          createdAt: h?.createdAt,
          source: h?.source,
          call: h?.call,
          result: h?.result,
        })),
        artifacts: (Array.isArray(artifacts) ? artifacts : []).slice(0, 10).map((a) => ({
          id: a?.id,
          filename: a?.filename,
          mimeType: a?.mimeType,
          sizeBytes: a?.sizeBytes,
          createdAt: a?.createdAt,
          content: typeof a?.content === 'string' ? a.content.slice(0, 4000) : null,
        })),
        mcpServers: (Array.isArray(mcpState?.servers) ? mcpState.servers : []).map((s) => ({
          id: s?.id,
          displayName: s?.displayName,
          enabled: s?.enabled,
          status: s?.status,
          lastError: s?.lastError,
          execEnabled: s?.execution?.enabled,
          mode: s?.execution?.mode,
          nativeHost: s?.transport?.nativeHost,
        })),
        mcpToolCaches: (Array.isArray(mcpState?.toolCaches) ? mcpState.toolCaches : []).map((c) => ({
          serverId: c?.serverId,
          refreshedAt: c?.refreshedAt,
          health: c?.health,
          tools: (Array.isArray(c?.tools) ? c.tools : []).map((t) => t?.name),
        })),
        descriptorNames: (Array.isArray(descriptors) ? descriptors : []).map((d) => d?.name),
      };
    });
  } catch (err) {
    return { error: String(err?.message || err).slice(0, 200) };
  }
}

async function enableShellForVerification(ctx) {
  if (process.env.DWPLUS_ENABLE_SHELL !== '1') return null;
  let sw = ctx.serviceWorkers()[0];
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 10000 });
  const extensionId = new URL(sw.url()).host;
  let extensionPage = await ctx.newPage();
  try {
    await extensionPage.goto(`chrome-extension://${extensionId}/sidepanel.html`, { waitUntil: 'domcontentloaded' });
    await extensionPage.evaluate(() => chrome.runtime.reload());
    await new Promise((resolve) => setTimeout(resolve, 2500));
    await extensionPage.close().catch(() => {});
    extensionPage = await ctx.newPage();
    await extensionPage.goto(`chrome-extension://${extensionId}/sidepanel.html`, { waitUntil: 'domcontentloaded' });
    return await extensionPage.evaluate(async () => {
      const key = 'deepseek_pp_mcp_servers';
      const data = await chrome.storage.local.get(key);
      const state = data[key] || { version: 1, servers: [], toolCaches: [] };
      const servers = Array.isArray(state.servers) ? state.servers : [];
      const shell = servers.find((server) => server?.displayName === 'Shell Local' || server?.transport?.nativeHost === 'com.deepseek_pp.shell');
      if (!shell) throw new Error('Shell Local preset not found');
      shell.enabled = true;
      shell.status = 'unknown';
      shell.execution = { ...(shell.execution || {}), enabled: true, mode: 'auto' };
      shell.allowlist = { mode: 'all', toolNames: [] };
      shell.updatedAt = Date.now();
      await chrome.storage.local.set({ [key]: { ...state, servers } });
      const descriptors = await chrome.runtime.sendMessage({ type: 'REFRESH_TOOL_DESCRIPTORS' });
      await new Promise((resolve) => setTimeout(resolve, 500));
      const refreshed = await chrome.storage.local.get(key);
      const refreshedState = refreshed[key] || {};
      const refreshedShell = (Array.isArray(refreshedState.servers) ? refreshedState.servers : [])
        .find((server) => server?.displayName === 'Shell Local' || server?.transport?.nativeHost === 'com.deepseek_pp.shell');
      const skills = await chrome.runtime.sendMessage({ type: 'GET_SKILLS' });
      return {
        extensionId: chrome.runtime.id,
        descriptorNames: Array.isArray(descriptors) ? descriptors.map((item) => item?.name) : [],
        skillNames: Array.isArray(skills) ? skills.map((item) => item?.name) : [],
        shellStatus: refreshedShell?.status,
        shellLastError: refreshedShell?.lastError,
      };
    });
  } finally {
    await extensionPage.close();
  }
}

async function snapshotPage(page) {
  return page.evaluate((toolTagSource) => {
    const toolTagRe = new RegExp(toolTagSource);
    const bodyText = document.body.innerText || '';
    const m = bodyText.match(toolTagRe);
    let rawXmlSample = null;
    if (m && typeof m.index === 'number') {
      rawXmlSample = bodyText.slice(Math.max(0, m.index - 80), m.index + 200);
    }
    const assistantSelectors = [
      'div[data-testid="assistant-message"]',
      'div[class*="assistant-message"]',
      'div.my-0.w-full.mx-auto div.whitespace-pre-wrap:not(.bg-g-send)',
    ];
    const assistantMessages = [];
    const seen = new Set();
    for (const selector of assistantSelectors) {
      for (const node of document.querySelectorAll(selector)) {
        const text = (node.innerText || '').trim();
        if (!text || seen.has(text)) continue;
        seen.add(text);
        assistantMessages.push(text);
      }
    }
    const toolCards = [...document.querySelectorAll('.dwplus-tool-card')].map((card) => ({
      state: card.getAttribute('data-state'),
      name: card.querySelector('.dwplus-tc-name')?.textContent?.trim() || null,
      status: card.querySelector('.dwplus-tc-status-text')?.textContent?.trim() || null,
      payload: card.querySelector('.dwplus-tc-payload')?.textContent?.trim() || null,
      result: card.querySelector('.dwplus-tc-result')?.textContent?.trim() || null,
      artifact: card.querySelector('.dwplus-artifact-meta')?.textContent?.trim() || null,
    }));
    return {
      bodyLen: bodyText.length,
      pageShowsRawToolXml: toolTagRe.test(bodyText),
      rawXmlSample,
      toolBlockCount: document.querySelectorAll('#dwplus-tool-block, [data-dwplus-tool-block="true"], .dwplus-tool-card').length,
      toolCards,
      assistantMessages,
      lastReplyTail: bodyText.slice(-600),
    };
  }, TOOL_TAG_RE.source);
}

async function installAgentModeOverride(page) {
  const rawMode = process.env.DWPLUS_AGENT_MODE;
  if (rawMode == null || rawMode === '') return;
  await page.evaluate((mode) => {
    const previous = window.fetch;
    window.fetch = function (input, init) {
      try {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (url.includes('/chat/completion') && init && typeof init.body === 'string') {
          const body = JSON.parse(init.body);
          if (body?.option && typeof body.option === 'object') {
            if (mode === 'delete') delete body.option.agent_mode;
            else body.option.agent_mode = Number(mode);
            init = { ...init, body: JSON.stringify(body) };
          }
        }
      } catch {}
      return previous.call(this, input, init);
    };
  }, rawMode);
}

function summarize(wire, sinceTs, marker) {
  return wire
    .filter((r) => r.url.includes(COMPLETION_PATH) && r.ts >= sinceTs)
    .map((r) => {
      const prompt = extractPromptText(r.postData);
      const requestMeta = extractRequestMeta(r.postData);
      const resp = r.responseText || '';
      const decoded = decodeSseResponse(resp);
      const respMatch = resp.match(TOOL_TAG_RE);
      const responseToolXmlSample = respMatch && typeof respMatch.index === 'number'
        ? resp.slice(Math.max(0, respMatch.index - 100), respMatch.index + 400)
        : null;
      return {
        status: r.status,
        mimeType: r.mimeType,
        finished: r.finished,
        failed: r.failed,
        streamCaptureError: r.streamCaptureError,
        requestMeta,
        promptLength: prompt ? prompt.length : null,
        promptContainsMarker: prompt ? prompt.includes(marker) : false,
        promptHasToolsSection: prompt ? /## Tools|### Tool /.test(prompt) : false,
        promptToolNames: prompt
          ? ['artifact_create', 'shell_exec', 'web_search', 'memory_save', 'skill_create']
              .filter((n) => prompt.includes(`### Tool ${n}`) || prompt.includes(`<${n}>`))
          : [],
        promptToolSchemas: prompt ? [...prompt.matchAll(/^### Tool ([^\r\n]+)/gm)].map((m) => m[1]) : [],
        promptHead: prompt ? prompt.slice(0, 200) : null,
        promptTail: prompt ? prompt.slice(-300) : null,
        finalPrompt: prompt,
        responseBytes: resp.length,
        responseHead: resp.slice(0, 1500),
        responseContainsToolXml: TOOL_TAG_RE.test(resp),
        responseToolXmlSample,
        modelResponse: decoded.modelResponse,
        relevantResponseEvents: decoded.relevantEvents,
        responseTail: resp.slice(-3000),
        responseText: resp,
      };
    });
}

(async () => {
  const { ctx, page } = await launch();
  const consoleMsgs = installConsoleCapture(page);
  const { wire, fillPostData } = await installCdpCaptureWithBody(ctx, page);

  await page.goto('https://www.doubao.com/chat/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(6000);

  const results = { generatedAt: new Date().toISOString(), tests: {} };
  results.shellSetup = await enableShellForVerification(ctx);
  if (results.shellSetup) await page.waitForTimeout(2500);
  results.preflight = await readToolHistory(ctx);

  const scenarios = [
    { id: 'T1_readme', marker: 'README.md', text: '请使用 artifact_create 工具生成一个 README.md 文件，内容是一段项目简介，不超过100字。' },
    { id: 'T2_testmd', marker: 'test.md', text: '请生成 test.md' },
    { id: 'T3_office', marker: 'Word', text: '/office 生成一个 Word 文档，内容是2026年七月工作总结模板' },
    { id: 'T4_shell', marker: '创建一个文件', text: '/shell 在当前目录创建一个文件 hello.txt，内容为 hello' },
  ].filter((scenario) => {
    const requested = String(process.env.DWPLUS_SCENARIOS || '').split(',').map((item) => item.trim()).filter(Boolean);
    return requested.length === 0 || requested.includes(scenario.id);
  });

  async function waitForCompletionFinished(sinceTs, timeoutMs = 300000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const matching = wire.filter((r) => r.url.includes(COMPLETION_PATH) && r.ts >= sinceTs);
      if (matching.length > 0 && matching.every((r) => r.finished || r.failed)) return true;
      await page.waitForTimeout(1000);
    }
    return false;
  }

  for (const sc of scenarios) {
    await page.goto('https://www.doubao.com/chat/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(5000);
    await installAgentModeOverride(page);
    const sinceTs = Date.now();
    const consoleSince = consoleMsgs.length;
    const pageBefore = await snapshotPage(page);
    const stateBefore = await readToolHistory(ctx);
    let sendError = null;
    try {
      await sendMessage(page, sc.text);
      await waitForReplyStable(page, { timeoutMs: 150000, stableMs: 5000 });
      await waitForCompletionFinished(sinceTs);
    } catch (err) {
      sendError = String(err?.message || err).slice(0, 300);
    }
    await page.waitForTimeout(2500);
    await fillPostData();
    const pageAfter = await snapshotPage(page);
    const stateAfter = await readToolHistory(ctx);
    results.tests[sc.id] = {
      input: sc.text,
      sendError,
      completions: summarize(wire, sinceTs, sc.marker),
      pageBefore,
      page: pageAfter,
      newAssistantMessages: pageAfter.assistantMessages.slice(pageBefore.assistantMessages.length),
      newToolCards: pageAfter.toolCards.slice(pageBefore.toolCards.length),
      stateBefore,
      toolHistory: stateAfter,
      newHistory: stateAfter.recent.filter((h) => Number(h.createdAt) >= sinceTs),
      newArtifacts: stateAfter.artifacts.filter((a) => Number(a.createdAt) >= sinceTs),
      dwplusLogs: consoleMsgs.slice(consoleSince)
        .filter((m) => m.text.includes('DWPLUS') || m.text.includes('TOOL'))
        .map((m) => m.text).slice(0, 40),
      consoleErrors: consoleMsgs.slice(consoleSince)
        .filter((m) => m.type === 'error' || m.type === 'pageerror')
        .map((m) => m.text).slice(0, 10),
    };
    await page.screenshot({ path: path.resolve(RESULTS_DIR, `phase2-10-${sc.id}.png`) }).catch(() => {});
  }

  fs.writeFileSync(
    path.resolve(RESULTS_DIR, 'phase2-10-toolcall-chain.json'),
    JSON.stringify(results, null, 2),
    'utf8',
  );
  console.log('RESULT_WRITTEN: playwright-results/phase2-10-toolcall-chain.json');
  await ctx.close();
})().catch((err) => {
  console.error('PROBE10_FATAL:', err);
  process.exit(1);
});
