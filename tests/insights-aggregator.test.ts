import { describe, expect, it } from 'vitest';
import {
  aggregateRange,
  applyPromptEvent,
  bumpTopKey,
  pruneOldBuckets,
  rangeStartKey,
  toDateKey,
  isValidInsightsState,
} from '../core/insights/aggregate';
import type { InsightPromptEvent } from '../core/insights/events';
import {
  createEmptyInsightsState,
  RETENTION_DAYS,
  TOP_KEY_LIMIT,
  type InsightsState,
} from '../core/insights/types';

// 固定基准时间：2026-07-15（周三）12:30 本地时区
const BASE = new Date(2026, 6, 15, 12, 30, 0).getTime();

function makeEvent(overrides: Partial<InsightPromptEvent> = {}): InsightPromptEvent {
  return {
    timestamp: BASE,
    host: 'doubao',
    originalLength: 100,
    finalLength: 500,
    usedMemoryIds: [],
    matchedSkills: [],
    presetInjected: false,
    augmentDurationMs: 2,
    memorySelectDurationMs: 0.5,
    ruleDurationMs: null,
    ...overrides,
  };
}

describe('applyPromptEvent', () => {
  it('创建当日桶并累加计数/长度/hourly 落位', () => {
    const state = createEmptyInsightsState();
    applyPromptEvent(state, makeEvent({ originalLength: 100 }));
    applyPromptEvent(state, makeEvent({ originalLength: 300 }));

    const key = toDateKey(BASE);
    const bucket = state.days[key];
    expect(bucket).toBeTruthy();
    expect(bucket.promptCount).toBe(2);
    expect(bucket.promptOriginalLengthSum).toBe(400);
    expect(bucket.promptOriginalLengthMax).toBe(300);
    expect(bucket.hourly[12]).toBe(2);
    expect(bucket.hourly.reduce((a, b) => a + b, 0)).toBe(2);
    expect(state.total.promptCount).toBe(2);
    expect(state.total.promptOriginalLengthMax).toBe(300);
    expect(state.firstRecordedAt).toBe(BASE);
  });

  it('memory / skill / preset / host 维度正确累加', () => {
    const state = createEmptyInsightsState();
    applyPromptEvent(state, makeEvent({
      usedMemoryIds: [1, 2],
      matchedSkills: ['python', 'review'],
      presetInjected: true,
      host: 'deepseek',
    }));
    applyPromptEvent(state, makeEvent()); // 全未命中

    const bucket = state.days[toDateKey(BASE)];
    expect(bucket.memoryHitPromptCount).toBe(1);
    expect(bucket.memoryUseCount).toBe(2);
    expect(bucket.memoryTop['1']).toBe(1);
    expect(bucket.skillHitPromptCount).toBe(1);
    expect(bucket.skillTop['python']).toBe(1);
    expect(bucket.presetUseCount).toBe(1);
    expect(bucket.hostCounts['deepseek']).toBe(1);
    expect(bucket.hostCounts['doubao']).toBe(1);
    expect(state.total.memoryUseCount).toBe(2);
    expect(state.total.hostCounts['deepseek']).toBe(1);
  });

  it('跨天事件落入不同日桶', () => {
    const state = createEmptyInsightsState();
    applyPromptEvent(state, makeEvent({ timestamp: BASE }));
    applyPromptEvent(state, makeEvent({ timestamp: BASE + 86_400_000 }));
    expect(Object.keys(state.days)).toHaveLength(2);
  });

  it('耗时统计：rules 为 null 时不计数', () => {
    const state = createEmptyInsightsState();
    applyPromptEvent(state, makeEvent({ augmentDurationMs: 4, ruleDurationMs: null }));
    applyPromptEvent(state, makeEvent({ augmentDurationMs: 2, ruleDurationMs: 1.5 }));

    const perf = state.days[toDateKey(BASE)].perf;
    expect(perf.augment.count).toBe(2);
    expect(perf.augment.sumMs).toBe(6);
    expect(perf.augment.maxMs).toBe(4);
    expect(perf.rules.count).toBe(1);
    expect(perf.rules.sumMs).toBe(1.5);
  });

  it('负数/非法耗时不入统计', () => {
    const state = createEmptyInsightsState();
    applyPromptEvent(state, makeEvent({ augmentDurationMs: -1, memorySelectDurationMs: NaN }));
    const perf = state.days[toDateKey(BASE)].perf;
    expect(perf.augment.count).toBe(0);
    expect(perf.memory.count).toBe(0);
  });
});

describe('bumpTopKey', () => {
  it('超过上限时淘汰计数最小键', () => {
    const top: Record<string, number> = {};
    for (let i = 0; i < TOP_KEY_LIMIT; i++) {
      top[`k${i}`] = i + 2; // k0 计数最小 = 2
    }
    bumpTopKey(top, 'new-key');
    expect(Object.keys(top)).toHaveLength(TOP_KEY_LIMIT);
    expect(top['new-key']).toBe(1);
    expect(top['k0']).toBeUndefined();
  });

  it('已有键直接自增，不触发淘汰', () => {
    const top: Record<string, number> = { a: 1 };
    bumpTopKey(top, 'a');
    expect(top.a).toBe(2);
  });
});

describe('rangeStartKey / aggregateRange', () => {
  function stateWithDays(): InsightsState {
    const state = createEmptyInsightsState();
    // BASE = 周三；周一 = 7-13，月初 = 7-1
    const day = (y: number, m: number, d: number, hour = 10) =>
      new Date(y, m - 1, d, hour).getTime();
    applyPromptEvent(state, makeEvent({ timestamp: day(2026, 7, 15) }));           // 今日
    applyPromptEvent(state, makeEvent({ timestamp: day(2026, 7, 13) }));           // 本周一
    applyPromptEvent(state, makeEvent({ timestamp: day(2026, 7, 12) }));           // 上周日（本周外，本月内）
    applyPromptEvent(state, makeEvent({ timestamp: day(2026, 7, 1) }));            // 月初
    applyPromptEvent(state, makeEvent({ timestamp: day(2026, 6, 30) }));           // 上月（仅 all）
    return state;
  }

  it('today / week / month / all 边界正确', () => {
    const state = stateWithDays();
    expect(aggregateRange(state, 'today', BASE).promptCount).toBe(1);
    expect(aggregateRange(state, 'week', BASE).promptCount).toBe(2);
    expect(aggregateRange(state, 'month', BASE).promptCount).toBe(4);
    expect(aggregateRange(state, 'all', BASE).promptCount).toBe(5);
  });

  it('周日归属本周（周一起始）', () => {
    // 2026-07-19 是周日：本周起始应为 7-13
    const sunday = new Date(2026, 6, 19, 12, 0).getTime();
    expect(rangeStartKey('week', sunday)).toBe('2026-07-13');
  });

  it('命中率含 0 除保护，空范围返回全零 summary', () => {
    const empty = aggregateRange(createEmptyInsightsState(), 'today', BASE);
    expect(empty.promptCount).toBe(0);
    expect(empty.memoryHitRate).toBe(0);
    expect(empty.skillHitRate).toBe(0);
    expect(empty.avgOriginalLength).toBe(0);
    expect(empty.perf.augment.avgMs).toBe(0);
  });

  it('聚合 top 表、耗时与热力矩阵', () => {
    const state = createEmptyInsightsState();
    applyPromptEvent(state, makeEvent({
      usedMemoryIds: [7],
      matchedSkills: ['python'],
      augmentDurationMs: 3,
      ruleDurationMs: 2,
    }));
    applyPromptEvent(state, makeEvent({ matchedSkills: ['python'] }));

    const summary = aggregateRange(state, 'all', BASE);
    expect(summary.topSkills[0]).toEqual({ key: 'python', count: 2 });
    expect(summary.topMemories[0]).toEqual({ key: '7', count: 1 });
    expect(summary.memoryHitRate).toBe(0.5);
    expect(summary.skillHitRate).toBe(1);
    expect(summary.perf.rules.count).toBe(1);
    // BASE 是周三（下标 2），12 点
    expect(summary.weekdayHourly[2][12]).toBe(2);
  });
});

describe('pruneOldBuckets', () => {
  it('删除超过保留期的日桶，total 不受影响', () => {
    const state = createEmptyInsightsState();
    applyPromptEvent(state, makeEvent({ timestamp: BASE }));
    applyPromptEvent(state, makeEvent({ timestamp: BASE - (RETENTION_DAYS + 10) * 86_400_000 }));
    expect(Object.keys(state.days)).toHaveLength(2);
    expect(state.total.promptCount).toBe(2);

    const removed = pruneOldBuckets(state, BASE);
    expect(removed).toBe(1);
    expect(Object.keys(state.days)).toHaveLength(1);
    expect(state.total.promptCount).toBe(2);
  });
});

describe('isValidInsightsState', () => {
  it('接受空 state 与含事件的 state', () => {
    const state = createEmptyInsightsState();
    expect(isValidInsightsState(state)).toBe(true);
    applyPromptEvent(state, makeEvent());
    expect(isValidInsightsState(JSON.parse(JSON.stringify(state)))).toBe(true);
  });

  it('拒绝版本不符 / 缺字段 / 坏 hourly', () => {
    expect(isValidInsightsState(null)).toBe(false);
    expect(isValidInsightsState({ version: 2, days: {}, total: { promptCount: 0 } })).toBe(false);
    expect(isValidInsightsState({ version: 1, days: {} })).toBe(false);
    expect(isValidInsightsState({
      version: 1,
      days: { '2026-07-15': { date: '2026-07-15', promptCount: 1, hourly: [0, 1] } },
      total: { promptCount: 1 },
    })).toBe(false);
  });
});
