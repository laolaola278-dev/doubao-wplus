import { describe, expect, it } from 'vitest';
import { applyPromptEvent } from '../core/insights/aggregate';
import { buildInsightsCsvExport, buildInsightsJsonExport } from '../core/insights/export';
import type { InsightPromptEvent } from '../core/insights/events';
import { createEmptyInsightsState } from '../core/insights/types';

const BASE = new Date(2026, 6, 15, 12, 0, 0).getTime();

function makeEvent(overrides: Partial<InsightPromptEvent> = {}): InsightPromptEvent {
  return {
    timestamp: BASE,
    host: 'doubao',
    originalLength: 100,
    finalLength: 500,
    usedMemoryIds: [1],
    matchedSkills: ['python'],
    presetInjected: true,
    augmentDurationMs: 2,
    memorySelectDurationMs: 0.5,
    ruleDurationMs: 1,
    ...overrides,
  };
}

describe('buildInsightsJsonExport', () => {
  it('导出含 exportedAt / 全量日桶 / all 聚合摘要', () => {
    const state = createEmptyInsightsState();
    applyPromptEvent(state, makeEvent());
    applyPromptEvent(state, makeEvent({ timestamp: BASE - 86_400_000, host: 'deepseek' }));

    const exported = buildInsightsJsonExport(state, BASE);
    expect(exported.exportedAt).toBe(new Date(BASE).toISOString());
    expect(Object.keys(exported.days)).toHaveLength(2);
    expect(exported.summaryAll.promptCount).toBe(2);
    expect(exported.summaryAll.hostCounts).toEqual({ doubao: 1, deepseek: 1 });
    expect(exported.total.promptCount).toBe(2);
    // 隐私：导出 JSON 序列化后不含任何 prompt 文本字段
    const raw = JSON.stringify(exported);
    expect(raw).not.toContain('originalPrompt');
    expect(raw).not.toContain('finalPrompt');
  });

  it('空 state 可导出', () => {
    const exported = buildInsightsJsonExport(createEmptyInsightsState(), BASE);
    expect(exported.summaryAll.promptCount).toBe(0);
    expect(Object.keys(exported.days)).toHaveLength(0);
  });
});

describe('buildInsightsCsvExport', () => {
  it('一行一日、date 升序、表头齐全', () => {
    const state = createEmptyInsightsState();
    applyPromptEvent(state, makeEvent());
    applyPromptEvent(state, makeEvent({ timestamp: BASE - 86_400_000 }));

    const csv = buildInsightsCsvExport(state);
    const lines = csv.split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe(
      'date,prompts,memoryHitPrompts,memoryHitRate,memoryUses,skillHitPrompts,presetUses,hosts,avgOriginalLength,maxOriginalLength,avgFinalLength,avgAugmentMs,avgMemoryMs,avgRulesMs',
    );
    // date 升序
    expect(lines[1].split(',')[0] < lines[2].split(',')[0]).toBe(true);
    // 数值列
    const cols = lines[2].split(',');
    expect(cols[1]).toBe('1');           // prompts
    expect(cols[3]).toBe('1.000');       // memoryHitRate
    expect(cols[7]).toBe('doubao:1');    // hosts
    expect(cols[11]).toBe('2.00');       // avgAugmentMs
  });

  it('含逗号/引号的字段被转义（RFC4180）', () => {
    const state = createEmptyInsightsState();
    applyPromptEvent(state, makeEvent({ host: 'weird,"host"' }));
    const csv = buildInsightsCsvExport(state);
    expect(csv).toContain('"weird,""host"":1"');
  });

  it('空 state 只有表头', () => {
    const csv = buildInsightsCsvExport(createEmptyInsightsState());
    expect(csv.split('\n')).toHaveLength(1);
  });
});
