// core/insights/export.ts
// AI Insights 导出（JSON / CSV）。纯函数（时间注入），下载动作在页面侧。
// 导出内容与存储一致：只有行为标量，无 prompt 文本 / memory 内容。

import { aggregateRange } from './aggregate';
import type { InsightsState } from './types';

export interface InsightsJsonExport {
  exportedAt: string;
  firstRecordedAt: number | null;
  summaryAll: ReturnType<typeof aggregateRange>;
  days: InsightsState['days'];
  total: InsightsState['total'];
}

export function buildInsightsJsonExport(state: InsightsState, now: number): InsightsJsonExport {
  return {
    exportedAt: new Date(now).toISOString(),
    firstRecordedAt: state.firstRecordedAt,
    summaryAll: aggregateRange(state, 'all', now),
    days: state.days,
    total: state.total,
  };
}

function csvEscape(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const CSV_HEADER = [
  'date',
  'prompts',
  'memoryHitPrompts',
  'memoryHitRate',
  'memoryUses',
  'skillHitPrompts',
  'presetUses',
  'hosts',
  'avgOriginalLength',
  'maxOriginalLength',
  'avgFinalLength',
  'avgAugmentMs',
  'avgMemoryMs',
  'avgRulesMs',
];

/** 一行一日，date 升序；比率保留 3 位小数，耗时 2 位 */
export function buildInsightsCsvExport(state: InsightsState): string {
  const rows = [CSV_HEADER.join(',')];
  const buckets = Object.values(state.days).sort((a, b) => a.date.localeCompare(b.date));
  for (const b of buckets) {
    const hosts = Object.entries(b.hostCounts).map(([k, v]) => `${k}:${v}`).join(';');
    const avg = (sum: number, count: number, digits: number) =>
      count > 0 ? (sum / count).toFixed(digits) : '0';
    rows.push([
      b.date,
      b.promptCount,
      b.memoryHitPromptCount,
      b.promptCount > 0 ? (b.memoryHitPromptCount / b.promptCount).toFixed(3) : '0',
      b.memoryUseCount,
      b.skillHitPromptCount,
      b.presetUseCount,
      hosts,
      avg(b.promptOriginalLengthSum, b.promptCount, 1),
      b.promptOriginalLengthMax,
      avg(b.promptFinalLengthSum, b.promptCount, 1),
      avg(b.perf.augment.sumMs, b.perf.augment.count, 2),
      avg(b.perf.memory.sumMs, b.perf.memory.count, 2),
      avg(b.perf.rules.sumMs, b.perf.rules.count, 2),
    ].map(csvEscape).join(','));
  }
  return rows.join('\n');
}
