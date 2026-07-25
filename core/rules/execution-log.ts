// core/rules/execution-log.ts
// 规则执行日志 — 环形缓冲（background 内存持有；容量 100）。
// content 每次跑完引擎把 outcome 摘要发给 background，规则编辑器页拉取展示。
// 只记录摘要（规则名/命中/动作/prompt 长度变化），不记录 prompt 全文 —— 与
// Prompt Inspector 的脱敏分层一致：全文调试用 Inspector，日志只看行为。

import type { RuleExecutionRecord } from './engine';

export interface RuleExecutionLogEntry {
  timestamp: number;
  hostId: string;
  /** prompt 长度变化（变换前 → 后） */
  promptLengthBefore: number;
  promptLengthAfter: number;
  blocked: boolean;
  blockedReason: string | null;
  confirmationCount: number;
  pinnedMemoryCount: number;
  presetOverridden: boolean;
  records: RuleExecutionRecord[];
  /** 引擎运行耗时（ms）；旧日志条目无此字段（可选，向后兼容） */
  durationMs?: number;
}

const LOG_CAPACITY = 100;

let ring: RuleExecutionLogEntry[] = [];

export function appendRuleExecutionLog(entry: RuleExecutionLogEntry): void {
  ring.push(entry);
  if (ring.length > LOG_CAPACITY) ring.shift();
}

/** 新→旧 */
export function getRuleExecutionLog(): RuleExecutionLogEntry[] {
  return [...ring].reverse();
}

export function clearRuleExecutionLog(): void {
  ring = [];
}
