// core/diagnostics/diagnostics-export.ts
// 开发者诊断信息导出 — 汇总当前会话的诊断快照为一个可复制的 JSON 对象。
//
// 导出内容：
//   - host / adapter：当前宿主 id、名称、adapter 元数据（版本/最近验证日期/已验证结构）
//   - debug：DEBUG 门控状态 + __DWPLUS_DIAG__ 运行时标志（mainWorldReady / fetchHooked / selectorHealth）
//   - selfCheck：启动自检报告（含 severity 分级）
//   - lastAugmentation：最近一次增强执行摘要（脱敏）
//   - lastCapturedRequest：最近一次命中宿主的请求摘要（脱敏）
//
// 安全设计：
//   - 数据源全部是已脱敏的 dev-diagnostics 字段 + 声明式 adapter 元数据，
//     不新增任何敏感信息通道（无 header 值、无 prompt 内容、无 cookie）
//   - 仅 DEV / E2E 构建可用（与 dev-diagnostics 同一门控），生产构建返回 null
//
// 使用方式（DEV 构建，页面 DevTools console）：
//   copy(window.__DWPLUS_EXPORT_DIAG__())   // 复制 JSON 到剪贴板
//   window.__DWPLUS_EXPORT_DIAG__()          // 直接查看

import { getActiveAdapter, getActiveHostId } from '../hosts/registry';
import type { HostAdapterMeta } from '../hosts/types';
import {
  isDevDiagnosticsEnabled,
  readDevDiagnostics,
  type DevDiagnostics,
  type LastAugmentationOutcome,
  type LastCapturedRequest,
} from './dev-diagnostics';

export interface DiagnosticsExport {
  /** 导出格式版本（结构变更时递增，便于工具解析） */
  exportVersion: 1;
  /** 导出时间戳（ISO） */
  exportedAt: string;
  /** 当前宿主 id */
  host: string;
  /** adapter 元数据（名称 / 版本 / 最近验证日期 / 已验证页面与结构） */
  adapter: HostAdapterMeta & { id: string };
  /** DEBUG 状态 */
  debug: {
    devDiagnosticsEnabled: boolean;
    extensionVersion: string | null;
    mainWorldReady: boolean | null;
    fetchHooked: boolean | null;
    selectorHealth: DevDiagnostics['selectorHealth'] | null;
  };
  /** 启动自检报告（未跑过为 null） */
  selfCheck: DevDiagnostics['selfCheck'] | null;
  /** 最近一次增强执行摘要（从未执行为 null） */
  lastAugmentation: LastAugmentationOutcome | null;
  /** 最近一条 Prompt Inspector 快照的脱敏摘要（无 prompt 全文；未生成为 null） */
  lastPromptSnapshot: DevDiagnostics['lastPromptSnapshot'] | null;
  /** 最近一次命中宿主的请求摘要 */
  lastCapturedRequest: LastCapturedRequest | null;
  /** 页面信息 */
  page: { url: string; userAgent: string };
}

/**
 * 汇总诊断快照。生产构建（门控关闭）返回 null。
 * 所有取数都做防御处理 —— 导出本身绝不抛异常。
 */
export function buildDiagnosticsExport(): DiagnosticsExport | null {
  if (!isDevDiagnosticsEnabled()) return null;

  let meta: HostAdapterMeta & { id: string };
  try {
    const adapter = getActiveAdapter();
    meta = { id: adapter.id, ...adapter.getMeta() };
  } catch {
    meta = {
      id: getActiveHostId(),
      hostName: 'unknown',
      adapterVersion: 'unknown',
      lastVerifiedAt: 'unknown',
      verifiedPages: [],
      verifiedBodyStructures: [],
      evidence: [],
    };
  }

  const diag = readDevDiagnostics();

  return {
    exportVersion: 1,
    exportedAt: new Date().toISOString(),
    host: getActiveHostId(),
    adapter: meta,
    debug: {
      devDiagnosticsEnabled: true,
      extensionVersion: diag?.version ?? null,
      mainWorldReady: diag?.mainWorldReady ?? null,
      fetchHooked: diag?.fetchHooked ?? null,
      selectorHealth: diag?.selectorHealth ?? null,
    },
    selfCheck: diag?.selfCheck ?? null,
    lastAugmentation: diag?.lastAugmentation ?? null,
    lastPromptSnapshot: diag?.lastPromptSnapshot ?? null,
    lastCapturedRequest: diag?.lastCapturedRequest ?? null,
    page: {
      url: typeof location !== 'undefined' ? location.href : '',
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    },
  };
}

const EXPORT_GLOBAL_KEY = '__DWPLUS_EXPORT_DIAG__';

/**
 * 在 window 上安装导出函数（DEV 构建；生产为 no-op）。
 * DevTools console 中 `copy(window.__DWPLUS_EXPORT_DIAG__())` 即可带走完整快照。
 */
export function installDiagnosticsExport(): void {
  if (typeof window === 'undefined') return;
  if (!isDevDiagnosticsEnabled()) return;
  try {
    (window as unknown as Record<string, unknown>)[EXPORT_GLOBAL_KEY] = buildDiagnosticsExport;
  } catch {
    // window 不可写时忽略
  }
}
