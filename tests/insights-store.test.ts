import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearInsights,
  getInsightsState,
  recordInsightPromptEvent,
  resetInsightsCacheForTest,
} from '../core/insights/store';
import { INSIGHTS_STORAGE_KEY, RETENTION_DAYS, createEmptyInsightsState } from '../core/insights/types';
import { applyPromptEvent } from '../core/insights/aggregate';
import type { InsightPromptEvent } from '../core/insights/events';

function makeEvent(overrides: Partial<InsightPromptEvent> = {}): InsightPromptEvent {
  return {
    timestamp: Date.now(),
    host: 'doubao',
    originalLength: 10,
    finalLength: 50,
    usedMemoryIds: [],
    matchedSkills: [],
    presetInjected: false,
    augmentDurationMs: 1,
    memorySelectDurationMs: 0.2,
    ruleDurationMs: null,
    ...overrides,
  };
}

let storage: Record<string, unknown>;

beforeEach(() => {
  storage = {};
  resetInsightsCacheForTest();
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: storage[key] })),
        set: vi.fn(async (items: Record<string, unknown>) => { Object.assign(storage, items); }),
        remove: vi.fn(async (key: string) => { delete storage[key]; }),
      },
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('insights store', () => {
  it('记录事件后写透到 chrome.storage.local', async () => {
    const result = await recordInsightPromptEvent(makeEvent());
    expect(result.ok).toBe(true);
    const persisted = storage[INSIGHTS_STORAGE_KEY] as { total: { promptCount: number } };
    expect(persisted.total.promptCount).toBe(1);

    await recordInsightPromptEvent(makeEvent());
    expect((storage[INSIGHTS_STORAGE_KEY] as { total: { promptCount: number } }).total.promptCount).toBe(2);
  });

  it('形状不合法的 payload 被拒绝且不写入', async () => {
    const result = await recordInsightPromptEvent({ bogus: true });
    expect(result.ok).toBe(false);
    expect(storage[INSIGHTS_STORAGE_KEY]).toBeUndefined();
  });

  it('懒加载已持久化的 state', async () => {
    const seeded = createEmptyInsightsState();
    applyPromptEvent(seeded, makeEvent());
    storage[INSIGHTS_STORAGE_KEY] = JSON.parse(JSON.stringify(seeded));
    resetInsightsCacheForTest();

    const state = await getInsightsState();
    expect(state.total.promptCount).toBe(1);
  });

  it('损坏的持久化数据退回空 state（fail-safe）', async () => {
    storage[INSIGHTS_STORAGE_KEY] = { version: 99, garbage: true };
    const state = await getInsightsState();
    expect(state.total.promptCount).toBe(0);
    expect(state.version).toBe(1);
  });

  it('加载时裁剪超过保留期的日桶并回写', async () => {
    const seeded = createEmptyInsightsState();
    applyPromptEvent(seeded, makeEvent());
    applyPromptEvent(seeded, makeEvent({ timestamp: Date.now() - (RETENTION_DAYS + 30) * 86_400_000 }));
    storage[INSIGHTS_STORAGE_KEY] = JSON.parse(JSON.stringify(seeded));
    resetInsightsCacheForTest();

    const state = await getInsightsState();
    expect(Object.keys(state.days)).toHaveLength(1);
    // total 保留全历史
    expect(state.total.promptCount).toBe(2);
    // 裁剪结果已回写
    expect(Object.keys((storage[INSIGHTS_STORAGE_KEY] as { days: object }).days)).toHaveLength(1);
  });

  it('clearInsights 清空内存与存储', async () => {
    await recordInsightPromptEvent(makeEvent());
    const result = await clearInsights();
    expect(result.ok).toBe(true);
    expect(storage[INSIGHTS_STORAGE_KEY]).toBeUndefined();
    const state = await getInsightsState();
    expect(state.total.promptCount).toBe(0);
  });

  it('存储写入失败不抛出（统计降级，不影响主流程）', async () => {
    (chrome.storage.local.set as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('quota'));
    const result = await recordInsightPromptEvent(makeEvent());
    expect(result.ok).toBe(true);
  });
});
