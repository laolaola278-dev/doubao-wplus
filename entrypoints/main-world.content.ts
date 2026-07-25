import {
  installFetchHook,
  updateHookState,
  type RequestBodyModification,
  type ResponseCompletePayload,
  type ResponseTokenSpeedPayload,
} from '../core/interceptor/fetch-hook';
import { initSkillPopup } from '../core/ui/skill-popup';
import type {
  ToolCall,
  ToolCallRestoreRecord,
  ToolDescriptor,
} from '../core/types';
import type { SkillPopupCopy, SkillPopupItem } from '../core/ui/skill-popup';
import { validateBridgeMessage } from '../core/messaging/schema';
import { detectHost, setActiveHostId } from '../core/hosts/registry';
import { isDiagnosticsEnabled, markMainWorldReady, writeDiagnostics } from '../core/diagnostics/runtime-marker';
import {
  isDevDiagnosticsEnabled,
  markFetchHooked,
  markMainWorldReadyForDev,
  setSelectorHealth,
  writeDevDiagnostics,
} from '../core/diagnostics/dev-diagnostics';
import { installDiagnosticsExport } from '../core/diagnostics/diagnostics-export';
import { getActiveAdapter } from '../core/hosts/registry';

// ---- Bridge protocol constants ----
// 桥接协议：main-world content ↔ isolated-world content
// 新值使用 DWPLUS_* 前缀

const DEPRECATED_MAIN_WORLD_SOURCE = 'deepseek-pp-main';
const MAIN_WORLD_SOURCE = 'dwplus-main';
const DEPRECATED_CONTENT_SOURCE = 'deepseek-pp-content';
const CONTENT_SOURCE = 'dwplus-content';
const DEPRECATED_BRIDGE_REQUEST_TYPE = 'DPP_BRIDGE_REQUEST';
const BRIDGE_REQUEST_TYPE = 'DWPLUS_BRIDGE_REQUEST';
const DEPRECATED_BRIDGE_INIT_TYPE = 'DPP_BRIDGE_INIT';
const BRIDGE_INIT_TYPE = 'DWPLUS_BRIDGE_INIT';
const DEPRECATED_BRIDGE_READY_TYPE = 'DPP_BRIDGE_READY';
const BRIDGE_READY_TYPE = 'DWPLUS_BRIDGE_READY';
const REQUEST_TIMEOUT_MS = 8_000;
const BRIDGE_REQUEST_INTERVAL_MS = 50;
const BRIDGE_REQUEST_MAX_ATTEMPTS = 100;

type PendingRequest<T> = {
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

type AugmentResultMessage = {
  source?: string;
  type?: string;
  id?: string;
  ok?: boolean;
  result?: RequestBodyModification | null;
  error?: string;
};

let contentPort: MessagePort | null = null;
let bridgeRequestAttempts = 0;
let bridgeRequestTimer: ReturnType<typeof setInterval> | null = null;
const pendingAugmentRequests = new Map<string, PendingRequest<RequestBodyModification | null>>();

export default defineContentScript({
  matches: [
    '*://chat.deepseek.com/*',
    '*://www.doubao.com/*',
    '*://*.doubao.com/*',
  ],
  world: 'MAIN',
  runAt: 'document_start',
  main() {
    // 根据当前 URL 自动检测宿主
    const detectedHost = detectHost(window.location.href);
    if (detectedHost) {
      setActiveHostId(detectedHost.id);
    }

    // Diagnostics: 初始化运行时 marker（仅 dev/test/e2e 模式）
    if (isDiagnosticsEnabled()) {
      writeDiagnostics({
        // host detection 结果即时可读，便于 E2E 立即断言
      });
    }
    if (isDevDiagnosticsEnabled()) {
      writeDevDiagnostics({});
    }

    installContentBridge();
    installFetchHook();
    // dev-only diagnostics: 标记 fetch hook 已安装
    if (isDevDiagnosticsEnabled()) {
      markFetchHooked();
      scheduleDevSelectorHealthCheck();
      // dev-only: window.__DWPLUS_EXPORT_DIAG__() 一键导出诊断快照
      installDiagnosticsExport();
    }

    updateHookState({
      onRequestBody: requestAugmentedBody,
      onHeadersCaptured(headers: Record<string, string> | null) {
        postToContent({ type: 'HEADERS_CAPTURED', headers });
      },
      onToolCallStarted(call: ToolCall) {
        postToContent({ type: 'TOOL_CALL_STARTED', data: call });
      },
      onToolCall(call: ToolCall) {
        postToContent({ type: 'TOOL_CALL', data: call });
      },
      onToolCallsRestored(records: ToolCallRestoreRecord[]) {
        postToContent({ type: 'RESTORE_TOOL_CALLS', records });
      },
      onResponseComplete(complete: ResponseCompletePayload) {
        postToContent({ type: 'RESPONSE_COMPLETE', payload: complete });
      },
      onResponseTokenSpeed(progress: ResponseTokenSpeedPayload) {
        postToContent({ type: 'RESPONSE_TOKEN_SPEED', payload: progress });
      },
      onMemoriesUsed(ids: number[]) {
        postToContent({ type: 'MEMORIES_USED', ids });
      },
    });
  },
});

function installContentBridge(): void {
  if (typeof console !== 'undefined' && console.info) {
    console.info('[DWPLUS-BRIDGE] main-world: installContentBridge() called, starting BRIDGE_REQUEST interval');
  }
  window.addEventListener('message', (event) => {
    if (event.origin !== window.location.origin) return;
    if ((event.data?.source !== CONTENT_SOURCE && event.data?.source !== DEPRECATED_CONTENT_SOURCE) ||
        (event.data.type !== BRIDGE_INIT_TYPE && event.data.type !== DEPRECATED_BRIDGE_INIT_TYPE)) return;
    if (contentPort) return;

    const [port] = event.ports;
    if (!port) return;

    contentPort = port;
    contentPort.onmessage = (message) => handlePortMessage(message.data);
    contentPort.start();
    stopBridgeRequests();
    if (typeof console !== 'undefined' && console.info) {
      console.info('[DWPLUS-BRIDGE] main-world: Received BRIDGE_INIT from content, sending BRIDGE_READY');
    }
    postToContent({ type: BRIDGE_READY_TYPE });
    // diagnostics: main-world 成功握手 content 脚本后标记 ready
    if (isDiagnosticsEnabled()) {
      markMainWorldReady();
    }
    if (isDevDiagnosticsEnabled()) {
      markMainWorldReadyForDev();
    }
  });

  bridgeRequestTimer = setInterval(() => {
    if (contentPort || bridgeRequestAttempts >= BRIDGE_REQUEST_MAX_ATTEMPTS) {
      stopBridgeRequests();
      if (!contentPort && typeof console !== 'undefined' && console.warn) {
        console.warn(`[DWPLUS-BRIDGE] main-world: Gave up after ${bridgeRequestAttempts} BRIDGE_REQUEST attempts (no content script responded)`);
      }
      return;
    }
    bridgeRequestAttempts++;
    window.postMessage({ source: MAIN_WORLD_SOURCE, type: BRIDGE_REQUEST_TYPE }, window.location.origin);
  }, BRIDGE_REQUEST_INTERVAL_MS);
}

function stopBridgeRequests(): void {
  if (!bridgeRequestTimer) return;
  clearInterval(bridgeRequestTimer);
  bridgeRequestTimer = null;
}

function handlePortMessage(data: unknown): void {
  const validated = validateBridgeMessage(data, CONTENT_SOURCE);
  if (!validated) return;
  const message = validated as AugmentResultMessage;
  if (message.source !== CONTENT_SOURCE && message.source !== DEPRECATED_CONTENT_SOURCE) return;

  switch (message.type) {
    case 'SYNC_HOOK_STATE': {
      const value = message as { toolDescriptors?: unknown; skillSummaries?: unknown; skillPopupCopy?: unknown };
      updateHookState({
        toolDescriptors: normalizeToolDescriptors(value.toolDescriptors),
      });
      initSkillPopup(normalizeSkillSummaries(value.skillSummaries), normalizeSkillPopupCopy(value.skillPopupCopy));
      break;
    }
    case 'AUGMENT_REQUEST_BODY_RESULT': {
      settleAugmentRequest(message);
      break;
    }
    case 'SELF_CHECK_REPORT': {
      // dev-only：content world 跑完启动自检后，把报告写入 __DWPLUS_DIAG__.selfCheck
      const report = (message as { report?: unknown }).report;
      if (isDevDiagnosticsEnabled() && report && typeof report === 'object') {
        writeDevDiagnostics({ selfCheck: report as never });
      }
      break;
    }
    case 'PROMPT_SNAPSHOT_SUMMARY': {
      // dev-only：Prompt Inspector 快照的脱敏摘要 → __DWPLUS_DIAG__.lastPromptSnapshot
      const summary = (message as { summary?: unknown }).summary;
      if (isDevDiagnosticsEnabled() && summary && typeof summary === 'object') {
        writeDevDiagnostics({ lastPromptSnapshot: summary as never });
      }
      break;
    }
  }
}

function requestAugmentedBody(body: string): Promise<RequestBodyModification | null> {
  if (!contentPort) {
    throw new Error('WPlus main/content bridge is not connected.');
  }

  const id = crypto.randomUUID();
  return new Promise<RequestBodyModification | null>((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingAugmentRequests.delete(id);
      reject(new Error('WPlus request augmentation timed out.'));
    }, REQUEST_TIMEOUT_MS);

    pendingAugmentRequests.set(id, { resolve, reject, timeout });
    postToContent({ type: 'AUGMENT_REQUEST_BODY', id, body });
  });
}

function settleAugmentRequest(message: AugmentResultMessage): void {
  if (!message.id) return;
  const pending = pendingAugmentRequests.get(message.id);
  if (!pending) return;

  pendingAugmentRequests.delete(message.id);
  clearTimeout(pending.timeout);

  if (message.ok === false) {
    pending.reject(new Error(message.error || 'WPlus request augmentation failed.'));
    return;
  }

  pending.resolve(message.result ?? null);
}

function postToContent(message: Record<string, unknown>): void {
  if (!contentPort) return;
  contentPort.postMessage({ source: MAIN_WORLD_SOURCE, ...message });
}

function normalizeToolDescriptors(value: unknown): ToolDescriptor[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is ToolDescriptor => Boolean(item && typeof item === 'object'));
}

function normalizeSkillSummaries(value: unknown): SkillPopupItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is { name: string; description: string } =>
      Boolean(item && typeof item === 'object') &&
      typeof (item as { name?: unknown }).name === 'string' &&
      typeof (item as { description?: unknown }).description === 'string',
    )
    .map((item) => ({ name: item.name, description: item.description }));
}

function normalizeSkillPopupCopy(value: unknown): Partial<SkillPopupCopy> {
  if (!value || typeof value !== 'object') return {};
  const hint = (value as { hint?: unknown }).hint;
  return typeof hint === 'string' && hint.trim() ? { hint } : {};
}

// ============================================================
// dev-only selector health check scheduler
// ============================================================

const DEV_HEALTH_CHECK_INITIAL_DELAY_MS = 2_000;
const DEV_HEALTH_CHECK_RETRY_INTERVAL_MS = 5_000;
const DEV_HEALTH_CHECK_MAX_ATTEMPTS = 6;

let devHealthCheckAttempts = 0;
let devHealthCheckTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * 调度 dev-only selector health check：
 *   - DOMContentLoaded + 2s 后首次探测（等待 React/Semi 渲染）
 *   - 若 status=partial/fallback/unsupported，最多重试 6 次（每次间隔 5s）
 *   - 用户可在 console 调用 window.__DWPLUS_RUN_HEALTH_CHECK__() 立即重跑
 */
function scheduleDevSelectorHealthCheck(): void {
  if (typeof document === 'undefined') return;

  const run = () => {
    runDevSelectorHealthCheck();
    devHealthCheckAttempts++;
    if (devHealthCheckAttempts >= DEV_HEALTH_CHECK_MAX_ATTEMPTS) return;
    // 若已 full 则停止重试
    const w = (typeof window !== 'undefined' ? window : null) as unknown as { __DWPLUS_DIAG__?: { selectorHealth?: { status?: string } } } | null;
    const status = w?.__DWPLUS_DIAG__?.selectorHealth?.status;
    if (status === 'full') return;
    devHealthCheckTimer = setTimeout(run, DEV_HEALTH_CHECK_RETRY_INTERVAL_MS);
  };

  const start = () => setTimeout(run, DEV_HEALTH_CHECK_INITIAL_DELAY_MS);
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    start();
  } else {
    document.addEventListener('DOMContentLoaded', () => start(), { once: true });
  }

  // 允许用户在 DevTools console 手动触发：window.__DWPLUS_RUN_HEALTH_CHECK__()
  try {
    (window as unknown as Record<string, unknown>).__DWPLUS_RUN_HEALTH_CHECK__ = runDevSelectorHealthCheck;
  } catch {
    // 某些环境下 window 不可写，忽略
  }
}

function runDevSelectorHealthCheck(): void {
  try {
    const adapter = getActiveAdapter();
    const report = adapter.detectSelectors(document);
    setSelectorHealth(report);
    if (typeof console !== 'undefined' && console.info) {
      console.info(
        `[DWPLUS] selector health: status=${report.status} ` +
        `missingCritical=[${report.missingCritical.join(',')}] ` +
        `missingEssential=[${report.missingEssential.join(',')}]`,
      );
    }
  } catch (err) {
    if (typeof console !== 'undefined' && console.error) {
      console.error('[DWPLUS] dev selector health check failed', err);
    }
  }
}
