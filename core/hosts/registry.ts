// core/hosts/registry.ts
// HostRegistry — 宿主注册表 + 自动检测
// 业务模块只从这里获取当前宿主 adapter，不直接判断 doubao / deepseek

import type { HostAdapter, HostFeatureFlags, HostId } from './types';
import { DoubaoAdapter } from './doubao/adapter';
import { DeepSeekAdapter } from './deepseek/adapter';

// ============================================================
// 注册表（单例）
// ============================================================

const adapters: Map<HostId, HostAdapter> = new Map();

/** 注册所有宿主 adapter */
export function registerAdapters(): void {
  if (adapters.size > 0) return;
  adapters.set('doubao', new DoubaoAdapter());
  adapters.set('deepseek', new DeepSeekAdapter());
}

/** 根据 host id 获取 adapter */
export function getAdapter(id: HostId): HostAdapter | undefined {
  return adapters.get(id);
}

/** 获取所有已注册的 adapter */
export function getAllAdapters(): HostAdapter[] {
  return Array.from(adapters.values());
}

/** 根据当前 URL 自动检测宿主 */
export function detectHost(url: string): HostAdapter | null {
  for (const adapter of adapters.values()) {
    if (adapter.matchUrl(url)) return adapter;
  }
  return null;
}

/** 当前激活的宿主（运行时可切换） */
let activeHostId: HostId = 'doubao';

export function getActiveHostId(): HostId {
  return activeHostId;
}

export function setActiveHostId(id: HostId): void {
  activeHostId = id;
}

/** 获取当前激活的 adapter（fallback 到自动检测） */
export function getActiveAdapter(url?: string): HostAdapter {
  // 优先走 URL 匹配：保证从其他宿主页面跳转后能自动切换
  if (url) {
    const detected = detectHost(url);
    if (detected) return detected;
  }

  // 没有 URL 上下文时，返回当前手动设置的 active host
  const active = adapters.get(activeHostId);
  if (active) return active;

  // 缺省：doubao
  return adapters.get('doubao')!;
}

/**
 * 获取当前激活宿主的 feature flags。
 * 业务层不需要直接调用 `getActiveAdapter().getFeatures()`，
 * 在 server-side guard / feature module 启动点使用此函数。
 */
export function getActiveFeatures(url?: string): HostFeatureFlags {
  return getActiveAdapter(url).getFeatures();
}

// 启动时自动注册
registerAdapters();
