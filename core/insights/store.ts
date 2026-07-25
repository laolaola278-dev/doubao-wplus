// core/insights/store.ts
// AI Insights 持久化（background 持有）。
//
// 策略：
//   - 懒加载：首个事件/查询时从 chrome.storage.local 读入内存，之后内存为准。
//   - 写透：每个事件更新内存后立即 set —— 发送频率是人类打字级，写透最简单，
//     且对 MV3 service worker 随时休眠最稳（无 debounce 定时器，不丢数据）。
//   - fail-safe：损坏/版本不符的持久化数据 → 退回空 state（同 rules/store 风格）。
//   - 裁剪：加载时删除超过 366 天的日桶。
//
// 隐私：数据只进 chrome.storage.local，无上传路径；内容见 types.ts 红线注释。

import {
  applyPromptEvent,
  isValidInsightsState,
  pruneOldBuckets,
} from './aggregate';
import { isInsightPromptEvent, type InsightPromptEvent } from './events';
import {
  createEmptyInsightsState,
  INSIGHTS_STORAGE_KEY,
  type InsightsState,
} from './types';

let cached: InsightsState | null = null;

async function loadState(): Promise<InsightsState> {
  if (cached) return cached;
  try {
    const stored = await chrome.storage.local.get(INSIGHTS_STORAGE_KEY);
    const value = stored[INSIGHTS_STORAGE_KEY];
    if (isValidInsightsState(value)) {
      cached = value;
      const removed = pruneOldBuckets(cached, Date.now());
      if (removed > 0) await persist(cached);
    } else {
      if (value !== undefined) {
        console.warn('[DWPLUS-INSIGHTS] 持久化数据无效，重置为空统计');
      }
      cached = createEmptyInsightsState();
    }
  } catch {
    cached = createEmptyInsightsState();
  }
  return cached;
}

async function persist(state: InsightsState): Promise<void> {
  try {
    await chrome.storage.local.set({ [INSIGHTS_STORAGE_KEY]: state });
  } catch (error) {
    // 存储失败不抛出 —— 统计丢一条不影响主功能
    console.warn('[DWPLUS-INSIGHTS] 写入失败', error);
  }
}

/** 记录一次 prompt 事件（payload 来自 runtime message，先校验形状） */
export async function recordInsightPromptEvent(payload: unknown): Promise<{ ok: boolean }> {
  if (!isInsightPromptEvent(payload)) return { ok: false };
  const state = await loadState();
  applyPromptEvent(state, payload as InsightPromptEvent);
  await persist(state);
  return { ok: true };
}

/** Dashboard 拉取全量 state（聚合在 sidepanel 侧做，纯函数） */
export async function getInsightsState(): Promise<InsightsState> {
  return loadState();
}

/** 一键清空 */
export async function clearInsights(): Promise<{ ok: boolean }> {
  cached = createEmptyInsightsState();
  try {
    await chrome.storage.local.remove(INSIGHTS_STORAGE_KEY);
  } catch {
    // remove 失败时内存已清空，下次写透会覆盖
  }
  return { ok: true };
}

/** 测试用：重置内存缓存 */
export function resetInsightsCacheForTest(): void {
  cached = null;
}
