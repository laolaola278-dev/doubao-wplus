// core/diagnostics/dev-diagnostics.ts
// Dev-only runtime diagnostics for debugging doubao adapter on real pages.
//
// 暴露 window.__DWPLUS_DIAG__，包含：
//   - host: 当前激活宿主 id
//   - mainWorldReady: main-world 脚本是否完成初始化
//   - fetchHooked: fetch / XHR hook 是否已安装
//   - selectorHealth: selector health check 报告（4 档状态）
//   - lastCapturedRequest: 最近一次命中宿主的请求摘要（脱敏）
//
// 安全设计：
//   - 仅在 DEV / E2E 构建启用（与 runtime-marker 同一门控）
//   - 生产构建完全不写入任何全局变量
//   - 敏感数据脱敏：
//     * Authorization / cookie / signature 等值不暴露
//     * 只记录 header 键名，不记录值
//     * 请求体只记录 hasBody + bodyLength，不记录内容
//   - 所有写入幂等，可多次调用
//
// 与 runtime-marker.ts 的关系：
//   - runtime-marker.ts 暴露 __DOUBAO_WPLUS_DIAGNOSTICS__（E2E 烟雾测试用，字段更保守）
//   - dev-diagnostics.ts 暴露 __DWPLUS_DIAG__（人工调试用，字段更详细）
//   - 两者独立，互不影响

import type { HostId, SelectorHealthReport } from '../hosts/types';
import { getActiveHostId } from '../hosts/registry';

const DEV_GLOBAL_KEY = '__DWPLUS_DIAG__';

declare const __DOUBAO_WPLUS_E2E__: string | undefined;
declare const __DOUBAO_WPLUS_DEV__: boolean | undefined;

/** 最近一次命中宿主的请求摘要（脱敏） */
export interface LastCapturedRequest {
  /** 请求 URL */
  url: string;
  /** HTTP 方法 */
  method: string;
  /** 是否带 body */
  hasBody: boolean;
  /** body 字节数（不含内容） */
  bodyLength: number;
  /** 命中的宿主路径类型 */
  matchedHostPath: 'completion' | 'regenerate' | 'history' | 'other' | null;
  /** header 键名列表（仅键名，不含值） */
  headerKeys: string[];
  /** 是否检测到 Authorization header（不暴露值） */
  hasAuthorization: boolean;
  /** 是否检测到 Cookie header（不暴露值） */
  hasCookie: boolean;
  /** 是否检测到疑似签名的 header（如 x-*sign*, a_bogus 等，不暴露值） */
  hasSignatureLikeHeader: boolean;
  /** 捕获时间戳 */
  timestamp: number;
}

/** 最近一次增强执行摘要（脱敏：不含 prompt 内容，只有长度与结果） */
export interface LastAugmentationOutcome {
  /** 请求 URL 的 pathname（不含 query 中的签名参数） */
  urlPath: string;
  /** 传输通道 */
  transport: 'fetch' | 'xhr';
  /** 增强是否执行并修改了 body（null 结果 = 管线放行未修改） */
  modified: boolean;
  /** 原始 body 字节数 */
  originalBodyLength: number;
  /** 增强后 body 字节数（未修改时与原始相同） */
  augmentedBodyLength: number;
  /** 增强过程抛出的错误消息（成功为 null） */
  error: string | null;
  /** 执行时间戳 */
  timestamp: number;
}

export interface DevDiagnostics {
  /** 扩展版本 */
  version: string;
  /** 当前激活宿主 id */
  host: HostId;
  /** main-world 脚本是否完成初始化 */
  mainWorldReady: boolean;
  /** fetch / XHR hook 是否已安装 */
  fetchHooked: boolean;
  /** selector health check 报告摘要 */
  selectorHealth: {
    status: 'full' | 'partial' | 'fallback' | 'unsupported';
    healthy: boolean;
    missingCritical: string[];
    missingEssential: string[];
    timestamp: number | null;
  };
  /** 最近一次命中宿主的请求摘要 */
  lastCapturedRequest: LastCapturedRequest | null;
  /** 最近一次增强执行摘要（脱敏；从未执行过为 undefined） */
  lastAugmentation?: LastAugmentationOutcome;
  /**
   * 最近一条 Prompt Inspector 快照的脱敏摘要（无 prompt 全文，只有长度/阶段/结果）。
   * 完整快照（含文本）只存在于 content world 的环形缓冲，经面板查看，不进诊断导出。
   */
  lastPromptSnapshot?: {
    seq: number;
    timestamp: number;
    host: string;
    adapterVersion: string;
    originalLength: number;
    finalLength: number;
    stageLengths: Array<{ id: string; length: number; changed: boolean }>;
    memoryHit: boolean;
    usedMemoryCount: number;
    matchedSkills: string[];
    presetInjected: boolean;
    augmentDurationMs: number;
    augmentSucceeded: boolean;
    sendStatus: 'pending' | 'sent' | 'failed';
  };
  /** 启动自检报告（startup-self-check.ts 写入；未跑过为 undefined） */
  selfCheck?: {
    hostId: string;
    pageUrl: string;
    timestamp: number;
    passed: boolean;
    errorCount: number;
    warnCount: number;
    checks: Array<{ id: string; passed: boolean; severity: 'error' | 'warn' | 'info'; detail: string }>;
  };
}

const EMPTY_HEALTH: DevDiagnostics['selectorHealth'] = {
  status: 'unsupported',
  healthy: false,
  missingCritical: [],
  missingEssential: [],
  timestamp: null,
};

function resolveEnabled(): boolean {
  try {
    if (__DOUBAO_WPLUS_DEV__ === true) return true;
    if (__DOUBAO_WPLUS_E2E__ === '1') return true;
  } catch {
    // ReferenceError in test env (no Vite define)
  }
  try {
    const e2eRuntime = (globalThis as Record<string, unknown>)['__DOUBAO_WPLUS_E2E__'];
    if (e2eRuntime === '1') return true;
    const devRuntime = (globalThis as Record<string, unknown>)['__DOUBAO_WPLUS_DEV__'];
    if (devRuntime === true) return true;
  } catch {
    // ignore
  }
  return false;
}

export function isDevDiagnosticsEnabled(): boolean {
  try {
    return resolveEnabled();
  } catch {
    return false;
  }
}

export function readDevDiagnostics(): DevDiagnostics | null {
  if (typeof window === 'undefined') return null;
  const value = (window as unknown as Record<string, unknown>)[DEV_GLOBAL_KEY];
  if (!value || typeof value !== 'object') return null;
  return value as DevDiagnostics;
}

export function writeDevDiagnostics(patch: Partial<DevDiagnostics>, options: { version?: string } = {}): void {
  if (typeof window === 'undefined') return;
  if (!isDevDiagnosticsEnabled()) return;

  const previous = readDevDiagnostics();
  const next: DevDiagnostics = {
    version: options.version ?? previous?.version ?? '0.0.0',
    mainWorldReady: previous?.mainWorldReady ?? false,
    fetchHooked: previous?.fetchHooked ?? false,
    selectorHealth: previous?.selectorHealth ?? EMPTY_HEALTH,
    lastCapturedRequest: previous?.lastCapturedRequest ?? null,
    ...previous,
    ...patch,
    // host 永远从 registry 重新读取（放在最后，避免被 patch / previous 覆盖）
    host: getActiveHostId(),
  };

  (window as unknown as Record<string, unknown>)[DEV_GLOBAL_KEY] = next;
  window.dispatchEvent(new CustomEvent('dwplus:dev-diagnostics', { detail: next }));
}

/** 标记 main-world 已 ready（main-world 脚本调用） */
export function markMainWorldReadyForDev(version?: string): void {
  writeDevDiagnostics({ mainWorldReady: true }, { version });
}

/** 标记 fetch hook 已安装（main-world 脚本调用） */
export function markFetchHooked(): void {
  writeDevDiagnostics({ fetchHooked: true });
}

/** 更新 selector health 报告（content script 调用） */
export function setSelectorHealth(report: SelectorHealthReport): void {
  writeDevDiagnostics({
    selectorHealth: {
      status: report.status,
      healthy: report.healthy,
      missingCritical: report.missingCritical,
      missingEssential: report.missingEssential,
      timestamp: report.timestamp,
    },
  });
}

/**
 * 更新最近一次捕获的请求摘要（fetch hook 调用）。
 *
 * 入参 preMaskedReq 已由调用方脱敏：仅含 header 键名、body 长度等元信息，
 * 不含 Authorization / Cookie / signature 的值。
 */
export function setLastCapturedRequest(preMaskedReq: LastCapturedRequest): void {
  writeDevDiagnostics({ lastCapturedRequest: preMaskedReq });
}

/** 更新最近一次增强执行摘要（fetch hook 调用；已脱敏，不含 prompt 内容） */
export function setLastAugmentationOutcome(outcome: LastAugmentationOutcome): void {
  writeDevDiagnostics({ lastAugmentation: outcome });
}

/** 清理（主要用于热重载场景） */
export function clearDevDiagnostics(): void {
  if (typeof window === 'undefined') return;
  delete (window as unknown as Record<string, unknown>)[DEV_GLOBAL_KEY];
}

/**
 * 从 HeadersInit 中提取脱敏的元信息：
 *   - headerKeys: 仅键名列表
 *   - hasAuthorization: 是否存在 Authorization
 *   - hasCookie: 是否存在 Cookie
 *   - hasSignatureLikeHeader: 是否存在疑似签名的 header
 *
 * 不返回任何 header 值。
 */
export function extractMaskedHeaderMeta(headersInit: HeadersInit | undefined): {
  headerKeys: string[];
  hasAuthorization: boolean;
  hasCookie: boolean;
  hasSignatureLikeHeader: boolean;
} {
  const headerKeys: string[] = [];
  let hasAuthorization = false;
  let hasCookie = false;
  let hasSignatureLikeHeader = false;

  try {
    const headers = new Headers(headersInit);
    headers.forEach((_value, key) => {
      const lower = key.toLowerCase();
      headerKeys.push(key);
      if (lower === 'authorization' || lower === 'x-auth-token' || lower === 'x-access-token') {
        hasAuthorization = true;
      } else if (lower === 'cookie') {
        hasCookie = true;
      } else if (
        lower.includes('sign') ||
        lower.includes('a_bogus') ||
        lower.includes('x-bd') ||
        lower.includes('msToken'.toLowerCase()) ||
        lower.includes('x-tt') ||
        lower.includes('_signature')
      ) {
        hasSignatureLikeHeader = true;
      }
    });
  } catch {
    // ignore invalid headers
  }

  return { headerKeys, hasAuthorization, hasCookie, hasSignatureLikeHeader };
}
