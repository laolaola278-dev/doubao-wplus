// core/diagnostics/runtime-marker.ts
// Runtime diagnostics marker for E2E smoke tests.
//
// 目的：在不暴露敏感数据的前提下，让 Playwright E2E 可以从页面 JS 上下文
// 读取扩展运行时的基础状态：当前激活宿主、宿主 feature flags、content/main-world
// 初始化标记。
//
// 安全设计：
//   - 数据来源全部是 `core/hosts/registry` 和 `core/messaging` 的现有导出，
//     不引入任何用户数据、cookie、token 或请求体内容。
//   - 标记挂在 `window.__DOUBAO_WPLUS_DIAGNOSTICS__` 单一命名空间下，
//     不暴露扩展 ID、私有 API 路径或构建路径。
//   - 仅在以下情况启用：
//     * process.env.DOUBAO_WPLUS_E2E === '1' (Playwright 烟雾测试显式开启)
//     * import.meta.env.DEV === true (Vite dev server)
//   - 生产模式 完全不写入任何全局变量。
//   - 所有写入操作幂等，可以被多次调用而不会覆盖已设置的更详细状态。
//
// 注意：我们用 `process.env.DOUBAO_WPLUS_E2E` 而非 `import.meta.env.MODE`，
// 因为 WXT 在 `wxt build` 中不把 `--mode` 透传给 Vite 的 `import.meta.env.MODE`。
// 改用 build-time 环境变量 + Vite 的 `define` 配置可被静态替换，避免运行时分支误判。

import type { HostFeatureFlags, HostId } from '../hosts/types';
import { getActiveHostId, getActiveFeatures } from '../hosts/registry';

/** Diagnostics 暴露的对外类型（仅这些字段会被序列化到 window） */
export interface RuntimeDiagnostics {
  /** 扩展版本号（仅声明，不含用户数据） */
  version: string;
  /** 当前激活的宿主 id ('doubao' | 'deepseek') */
  activeHostId: HostId;
  /** 当前激活宿主的 feature flags */
  features: HostFeatureFlags;
  /** Content script 是否已完成初始化 */
  contentReady: boolean;
  /** Main world script 是否已完成初始化 */
  mainWorldReady: boolean;
  /** E2E 诊断信息：content script 暴露的桥接通道 id（可选，nil 表示尚未桥接） */
  bridgeId: string | null;
}

const GLOBAL_KEY = '__DOUBAO_WPLUS_DIAGNOSTICS__';

// Build-time constants: Vite `define` replaces these bare identifier
// references with literal values at build time. After replacement, Rollup
// tree-shakes dead branches based on the constant value.
//
// Unit tests can override the runtime check by setting
// `globalThis.__DOUBAO_WPLUS_E2E__` (the test path inside resolveEnabled
// catches ReferenceError and falls through to the globalThis check).
declare const __DOUBAO_WPLUS_E2E__: string | undefined;
declare const __DOUBAO_WPLUS_DEV__: boolean | undefined;

/** 内部 helper：从 build-time 常量解析是否启用 diagnostics */
function resolveEnabled(): boolean {
  try {
    // 1) Build-time: Vite dev server (wxt dev) sets __DOUBAO_WPLUS_DEV__ === true
    if (__DOUBAO_WPLUS_DEV__ === true) {
      return true;
    }
    // 2) Build-time: 显式 E2E 构建（DOUBAO_WPLUS_E2E=1）
    if (__DOUBAO_WPLUS_E2E__ === '1') {
      return true;
    }
  } catch {
    // ReferenceError in test env (no Vite define). Fall through to runtime check.
  }
  // 3) Runtime override (for unit tests): 读取 globalThis 上的同名属性
  try {
    const e2eRuntime = (globalThis as Record<string, unknown>)['__DOUBAO_WPLUS_E2E__'];
    if (e2eRuntime === '1') return true;
    const devRuntime = (globalThis as Record<string, unknown>)['__DOUBAO_WPLUS_DEV__'];
    if (devRuntime === true) return true;
  } catch {
    // globalThis 不可访问时保持默认 false
  }
  return false;
}

/**
 * 当前构建模式是否应暴露 diagnostics 标记。
 * 暴露条件（任一为真）：
 *   - Vite dev server 运行（import.meta.env.DEV === true）
 *   - 构建时设置了 DOUBAO_WPLUS_E2E=1
 */
export function isDiagnosticsEnabled(): boolean {
  try {
    return resolveEnabled();
  } catch {
    return false;
  }
}

/** 读取已写入的 diagnostics（如果存在） */
export function readDiagnostics(): RuntimeDiagnostics | null {
  if (typeof window === 'undefined') return null;
  const value = (window as unknown as Record<string, unknown>)[GLOBAL_KEY];
  if (!value || typeof value !== 'object') return null;
  return value as RuntimeDiagnostics;
}

/**
 * 将 diagnostics 写入 window.__DOUBAO_WPLUS_DIAGNOSTICS__。
 * 重复调用会浅合并已有值（仅覆盖传入的字段），便于 content / main-world
 * 各自设置自己的 ready 标志而不破坏对方字段。
 */
export function writeDiagnostics(
  patch: Partial<Omit<RuntimeDiagnostics, 'version' | 'activeHostId' | 'features'>> & {
    bridgeId?: string | null;
  },
  options: { version?: string } = {},
): void {
  if (typeof window === 'undefined') return;
  if (!isDiagnosticsEnabled()) return;

  const previous = readDiagnostics();
  const next: RuntimeDiagnostics = {
    version: options.version ?? previous?.version ?? '0.0.0',
    contentReady: previous?.contentReady ?? false,
    mainWorldReady: previous?.mainWorldReady ?? false,
    bridgeId: previous?.bridgeId ?? null,
    ...previous,
    ...patch,
    // activeHostId/features 永远从 registry 重新读取（避免 patch 误覆盖）
    activeHostId: getActiveHostId(),
    features: getActiveFeatures(),
  };

  (window as unknown as Record<string, unknown>)[GLOBAL_KEY] = next;

  // 触发一个可被测试监听的事件
  window.dispatchEvent(new CustomEvent('doubao-wplus:diagnostics', { detail: next }));
}

/** 仅设置 contentReady 标志（content script 调用） */
export function markContentReady(version?: string): void {
  writeDiagnostics({ contentReady: true }, { version });
}

/** 仅设置 mainWorldReady 标志（main-world script 调用） */
export function markMainWorldReady(version?: string): void {
  writeDiagnostics({ mainWorldReady: true }, { version });
}

/** 设置桥接通道 id（content script 与 main-world 握手后） */
export function markBridgeReady(bridgeId: string | null = 'main'): void {
  writeDiagnostics({ bridgeId });
}

/** 移除 diagnostics（清理，主要用于热重载场景） */
export function clearDiagnostics(): void {
  if (typeof window === 'undefined') return;
  delete (window as unknown as Record<string, unknown>)[GLOBAL_KEY];
}
