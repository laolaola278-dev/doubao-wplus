// core/insights/aggregate.ts
// 桶更新与范围聚合 —— 全部纯函数（时间经参数注入，可测）。
//
// 更新路径：applyPromptEvent(state, event) 原地更新当日桶 + total（调用方持有
// state 唯一引用，写透到 storage 由 store.ts 负责）。
// 查询路径：aggregateRange(state, range, now) 把范围内日桶折叠成 InsightsSummary。

import {
  createEmptyDailyBucket,
  createEmptyPerfStat,
  RETENTION_DAYS,
  TOP_KEY_LIMIT,
  type InsightsDailyBucket,
  type InsightsState,
  type PerfStat,
} from './types';
import type { InsightPromptEvent } from './events';

/** 本地时区 YYYY-MM-DD */
export function toDateKey(timestamp: number): string {
  const d = new Date(timestamp);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addPerfSample(stat: PerfStat, ms: number): void {
  if (!Number.isFinite(ms) || ms < 0) return;
  stat.sumMs += ms;
  stat.count += 1;
  if (ms > stat.maxMs) stat.maxMs = ms;
}

/** top 表自增；超过 TOP_KEY_LIMIT 键时淘汰计数最小键（防无界增长） */
export function bumpTopKey(top: Record<string, number>, key: string): void {
  if (key in top) {
    top[key] += 1;
    return;
  }
  const keys = Object.keys(top);
  if (keys.length >= TOP_KEY_LIMIT) {
    let minKey = keys[0];
    for (const k of keys) {
      if (top[k] < top[minKey]) minKey = k;
    }
    // 新键初始计数 1，只有当最小键计数也 >1 时淘汰无意义 —— 但为保上限仍淘汰
    delete top[minKey];
  }
  top[key] = 1;
}

/** 把一次 prompt 事件写入 state（当日桶 + 全历史累计） */
export function applyPromptEvent(state: InsightsState, event: InsightPromptEvent): void {
  const dateKey = toDateKey(event.timestamp);
  const bucket = state.days[dateKey] ?? (state.days[dateKey] = createEmptyDailyBucket(dateKey));
  if (state.firstRecordedAt === null || event.timestamp < state.firstRecordedAt) {
    state.firstRecordedAt = event.timestamp;
  }

  bucket.promptCount += 1;
  bucket.promptOriginalLengthSum += event.originalLength;
  if (event.originalLength > bucket.promptOriginalLengthMax) {
    bucket.promptOriginalLengthMax = event.originalLength;
  }
  bucket.promptFinalLengthSum += event.finalLength;

  if (event.usedMemoryIds.length > 0) {
    bucket.memoryHitPromptCount += 1;
    bucket.memoryUseCount += event.usedMemoryIds.length;
    for (const id of event.usedMemoryIds) bumpTopKey(bucket.memoryTop, String(id));
  }

  if (event.matchedSkills.length > 0) {
    bucket.skillHitPromptCount += 1;
    for (const name of event.matchedSkills) bumpTopKey(bucket.skillTop, name);
  }

  if (event.presetInjected) bucket.presetUseCount += 1;

  bucket.hostCounts[event.host] = (bucket.hostCounts[event.host] ?? 0) + 1;

  const hour = new Date(event.timestamp).getHours();
  if (hour >= 0 && hour < 24) bucket.hourly[hour] += 1;

  addPerfSample(bucket.perf.augment, event.augmentDurationMs);
  addPerfSample(bucket.perf.memory, event.memorySelectDurationMs);
  if (event.ruleDurationMs !== null) addPerfSample(bucket.perf.rules, event.ruleDurationMs);

  // 全历史累计
  const t = state.total;
  t.promptCount += 1;
  if (event.usedMemoryIds.length > 0) {
    t.memoryHitPromptCount += 1;
    t.memoryUseCount += event.usedMemoryIds.length;
  }
  if (event.matchedSkills.length > 0) t.skillHitPromptCount += 1;
  if (event.presetInjected) t.presetUseCount += 1;
  t.hostCounts[event.host] = (t.hostCounts[event.host] ?? 0) + 1;
  if (event.originalLength > t.promptOriginalLengthMax) {
    t.promptOriginalLengthMax = event.originalLength;
  }
}

/** 删除超过 RETENTION_DAYS 的旧日桶；返回删除数量 */
export function pruneOldBuckets(state: InsightsState, now: number): number {
  const cutoff = toDateKey(now - RETENTION_DAYS * 86_400_000);
  let removed = 0;
  for (const key of Object.keys(state.days)) {
    // YYYY-MM-DD 字典序即时间序
    if (key < cutoff) {
      delete state.days[key];
      removed += 1;
    }
  }
  return removed;
}

// ============================================================
// 范围聚合
// ============================================================

export type InsightsRange = 'today' | 'week' | 'month' | 'all';

export interface InsightsSummary {
  range: InsightsRange;
  promptCount: number;
  memoryHitPromptCount: number;
  /** 命中 ≥1 条记忆的 prompt 占比（0-1；无 prompt 时为 0） */
  memoryHitRate: number;
  memoryUseCount: number;
  skillHitPromptCount: number;
  /** 命中 skill 的 prompt 占比（0-1） */
  skillHitRate: number;
  presetUseCount: number;
  hostCounts: Record<string, number>;
  avgOriginalLength: number;
  maxOriginalLength: number;
  avgFinalLength: number;
  /** memoryId(string) -> 次数，按次数降序 */
  topMemories: Array<{ key: string; count: number }>;
  /** skillName -> 次数，按次数降序 */
  topSkills: Array<{ key: string; count: number }>;
  perf: {
    augment: { avgMs: number; maxMs: number; count: number };
    memory: { avgMs: number; maxMs: number; count: number };
    rules: { avgMs: number; maxMs: number; count: number };
  };
  /** 范围内每日 prompt 数（date 升序；趋势图用） */
  dailyTrend: Array<{ date: string; count: number }>;
  /** 7（周一=0）× 24 小时热力矩阵（范围内累计） */
  weekdayHourly: number[][];
}

/** 范围起始日 key（含）；'all' 返回 null（不过滤） */
export function rangeStartKey(range: InsightsRange, now: number): string | null {
  if (range === 'all') return null;
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  if (range === 'week') {
    // 周一为一周起始
    const dow = d.getDay(); // 0=Sun
    const back = dow === 0 ? 6 : dow - 1;
    d.setDate(d.getDate() - back);
  } else if (range === 'month') {
    d.setDate(1);
  }
  return toDateKey(d.getTime());
}

function sortTop(top: Record<string, number>, limit: number): Array<{ key: string; count: number }> {
  return Object.entries(top)
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .slice(0, limit);
}

function finishPerf(stat: PerfStat): { avgMs: number; maxMs: number; count: number } {
  return {
    avgMs: stat.count > 0 ? stat.sumMs / stat.count : 0,
    maxMs: stat.maxMs,
    count: stat.count,
  };
}

/** date key（YYYY-MM-DD，本地时区语义）→ 周一=0 的星期下标 */
function weekdayIndexOfDateKey(dateKey: string): number {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dow = new Date(y, m - 1, d).getDay(); // 0=Sun
  return dow === 0 ? 6 : dow - 1;
}

export function aggregateRange(state: InsightsState, range: InsightsRange, now: number): InsightsSummary {
  const startKey = rangeStartKey(range, now);
  const endKey = toDateKey(now);
  const buckets = Object.values(state.days)
    .filter((b) => (startKey === null || b.date >= startKey) && b.date <= endKey)
    .sort((a, b) => a.date.localeCompare(b.date));

  const mergedMemoryTop: Record<string, number> = {};
  const mergedSkillTop: Record<string, number> = {};
  const hostCounts: Record<string, number> = {};
  const perfAugment = createEmptyPerfStat();
  const perfMemory = createEmptyPerfStat();
  const perfRules = createEmptyPerfStat();
  const weekdayHourly: number[][] = Array.from({ length: 7 }, () => new Array(24).fill(0));

  let promptCount = 0;
  let memoryHitPromptCount = 0;
  let memoryUseCount = 0;
  let skillHitPromptCount = 0;
  let presetUseCount = 0;
  let originalLengthSum = 0;
  let maxOriginalLength = 0;
  let finalLengthSum = 0;

  const mergePerf = (into: PerfStat, from: PerfStat) => {
    into.sumMs += from.sumMs;
    into.count += from.count;
    if (from.maxMs > into.maxMs) into.maxMs = from.maxMs;
  };

  for (const b of buckets) {
    promptCount += b.promptCount;
    memoryHitPromptCount += b.memoryHitPromptCount;
    memoryUseCount += b.memoryUseCount;
    skillHitPromptCount += b.skillHitPromptCount;
    presetUseCount += b.presetUseCount;
    originalLengthSum += b.promptOriginalLengthSum;
    if (b.promptOriginalLengthMax > maxOriginalLength) maxOriginalLength = b.promptOriginalLengthMax;
    finalLengthSum += b.promptFinalLengthSum;
    for (const [k, v] of Object.entries(b.memoryTop)) mergedMemoryTop[k] = (mergedMemoryTop[k] ?? 0) + v;
    for (const [k, v] of Object.entries(b.skillTop)) mergedSkillTop[k] = (mergedSkillTop[k] ?? 0) + v;
    for (const [k, v] of Object.entries(b.hostCounts)) hostCounts[k] = (hostCounts[k] ?? 0) + v;
    mergePerf(perfAugment, b.perf.augment);
    mergePerf(perfMemory, b.perf.memory);
    mergePerf(perfRules, b.perf.rules);
    const weekday = weekdayIndexOfDateKey(b.date);
    for (let h = 0; h < 24; h++) weekdayHourly[weekday][h] += b.hourly[h] ?? 0;
  }

  return {
    range,
    promptCount,
    memoryHitPromptCount,
    memoryHitRate: promptCount > 0 ? memoryHitPromptCount / promptCount : 0,
    memoryUseCount,
    skillHitPromptCount,
    skillHitRate: promptCount > 0 ? skillHitPromptCount / promptCount : 0,
    presetUseCount,
    hostCounts,
    avgOriginalLength: promptCount > 0 ? originalLengthSum / promptCount : 0,
    maxOriginalLength,
    avgFinalLength: promptCount > 0 ? finalLengthSum / promptCount : 0,
    topMemories: sortTop(mergedMemoryTop, 10),
    topSkills: sortTop(mergedSkillTop, 10),
    perf: {
      augment: finishPerf(perfAugment),
      memory: finishPerf(perfMemory),
      rules: finishPerf(perfRules),
    },
    dailyTrend: buckets.map((b) => ({ date: b.date, count: b.promptCount })),
    weekdayHourly,
  };
}

/** 校验持久化数据形状（版本不符/损坏时调用方退回空 state，fail-safe） */
export function isValidInsightsState(value: unknown): value is InsightsState {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.version !== 1) return false;
  if (typeof v.days !== 'object' || v.days === null) return false;
  if (typeof v.total !== 'object' || v.total === null) return false;
  const total = v.total as Record<string, unknown>;
  if (typeof total.promptCount !== 'number') return false;
  for (const bucket of Object.values(v.days as Record<string, unknown>)) {
    if (typeof bucket !== 'object' || bucket === null) return false;
    const b = bucket as Record<string, unknown>;
    if (typeof b.date !== 'string' || typeof b.promptCount !== 'number') return false;
    if (!Array.isArray(b.hourly) || b.hourly.length !== 24) return false;
  }
  return true;
}
