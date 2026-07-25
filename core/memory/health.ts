// core/memory/health.ts
// Memory 健康检查 — Memory Studio 的维护建议引擎。
//
// 纯只读分析：不修改任何 memory；所有建议由用户在 UI 里确认后走既有
// UPDATE_MEMORY / DELETE_MEMORY(IES) 消息执行。
//
// 检查项：
//   duplicate      内容高度相似（词集 Jaccard ≥ 0.8）→ 建议合并
//   stale          长期未使用（>90 天未访问且命中 <3 次，未 pin）— 与
//                  store.archiveStaleMemories 的清理阈值一致，提前预警
//   oversized      内容过长（token 估算 > 400，单条即占预算 1500 的 1/4+）
//   conflict       同名/同 tag 但内容不同 → 可能语义冲突，建议人工审阅

import type { Memory } from '../types';
import { estimateTokens, segmentText } from './selector';

export type MemoryHealthIssueKind = 'duplicate' | 'stale' | 'oversized' | 'conflict';

export interface MemoryHealthIssue {
  kind: MemoryHealthIssueKind;
  /** 涉及的 memory id（duplicate/conflict 为一组，stale/oversized 为单条） */
  memoryIds: number[];
  /** 涉及的 memory 名（展示用） */
  memoryNames: string[];
  /** 问题说明 */
  detail: string;
  /** 建议动作 */
  suggestion: 'merge' | 'review' | 'delete-or-pin' | 'shorten';
}

export interface MemoryHealthReport {
  checkedCount: number;
  issues: MemoryHealthIssue[];
  /** 按类型统计 */
  counts: Record<MemoryHealthIssueKind, number>;
}

// 与 store.archiveStaleMemories 的清理阈值保持一致（提前预警而非等自动清理）
const STALE_THRESHOLD_DAYS = 90;
const MIN_ACCESS_FOR_RETENTION = 3;
const OVERSIZED_TOKEN_THRESHOLD = 400;
const DUPLICATE_JACCARD_THRESHOLD = 0.8;

export function runMemoryHealthCheck(memories: Memory[], now: number = Date.now()): MemoryHealthReport {
  const issues: MemoryHealthIssue[] = [];

  // 词集缓存（duplicate 与 conflict 共用）
  const wordSets = new Map<Memory, Set<string>>();
  const wordsOf = (m: Memory): Set<string> => {
    let set = wordSets.get(m);
    if (!set) {
      set = new Set(segmentText(m.content));
      wordSets.set(m, set);
    }
    return set;
  };

  // ---- duplicate：两两 Jaccard（n 为用户记忆量级，几十到几百，O(n²) 可接受）----
  const reported = new Set<string>();
  for (let i = 0; i < memories.length; i++) {
    for (let j = i + 1; j < memories.length; j++) {
      const a = memories[i], b = memories[j];
      const key = `${a.syncId}|${b.syncId}`;
      if (reported.has(key)) continue;
      const similarity = jaccard(wordsOf(a), wordsOf(b));
      if (similarity >= DUPLICATE_JACCARD_THRESHOLD) {
        reported.add(key);
        issues.push({
          kind: 'duplicate',
          memoryIds: [a.id, b.id].filter((id): id is number => id != null),
          memoryNames: [a.name, b.name],
          detail: `内容相似度 ${(similarity * 100).toFixed(0)}%（词集 Jaccard）`,
          suggestion: 'merge',
        });
      }
    }
  }

  // ---- stale ----
  const staleThreshold = now - STALE_THRESHOLD_DAYS * 86_400_000;
  for (const m of memories) {
    if (!m.pinned && m.lastAccessedAt < staleThreshold && m.accessCount < MIN_ACCESS_FOR_RETENTION) {
      const days = Math.floor((now - m.lastAccessedAt) / 86_400_000);
      issues.push({
        kind: 'stale',
        memoryIds: m.id != null ? [m.id] : [],
        memoryNames: [m.name],
        detail: `${days} 天未使用且命中仅 ${m.accessCount} 次 — 自动清理（${STALE_THRESHOLD_DAYS} 天阈值）即将回收`,
        suggestion: 'delete-or-pin',
      });
    }
  }

  // ---- oversized ----
  for (const m of memories) {
    const tokens = estimateTokens(m.content);
    if (tokens > OVERSIZED_TOKEN_THRESHOLD) {
      issues.push({
        kind: 'oversized',
        memoryIds: m.id != null ? [m.id] : [],
        memoryNames: [m.name],
        detail: `约 ${tokens} tokens，单条即占注入预算的 ${Math.round((tokens / 1500) * 100)}%，会挤掉其他记忆`,
        suggestion: 'shorten',
      });
    }
  }

  // ---- conflict：同名（或全部 tag 相同且非空）但内容差异大 ----
  const byName = new Map<string, Memory[]>();
  for (const m of memories) {
    const key = m.name.trim().toLowerCase();
    if (!key) continue;
    const group = byName.get(key) ?? [];
    group.push(m);
    byName.set(key, group);
  }
  for (const group of byName.values()) {
    if (group.length < 2) continue;
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i], b = group[j];
        const similarity = jaccard(wordsOf(a), wordsOf(b));
        // 相似度高的已由 duplicate 覆盖；同名且内容明显不同才算冲突
        if (similarity < DUPLICATE_JACCARD_THRESHOLD) {
          issues.push({
            kind: 'conflict',
            memoryIds: [a.id, b.id].filter((id): id is number => id != null),
            memoryNames: [a.name, b.name],
            detail: `同名但内容差异大（相似度 ${(similarity * 100).toFixed(0)}%）— 注入时两条都会以同一名字出现，可能互相矛盾`,
            suggestion: 'review',
          });
        }
      }
    }
  }

  const counts: Record<MemoryHealthIssueKind, number> = { duplicate: 0, stale: 0, oversized: 0, conflict: 0 };
  for (const issue of issues) counts[issue.kind]++;

  return { checkedCount: memories.length, issues, counts };
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const w of small) if (large.has(w)) intersection++;
  return intersection / (a.size + b.size - intersection);
}
