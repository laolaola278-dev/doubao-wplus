// core/insights/events.ts
// content → background 的统计事件形状。
//
// 隐私：payload 只含标量/id/skill 名，不含 prompt 全文、memory 内容、URL。
// 采集全部来自增强管线既有中间值（零重算）——见 request-augmentation 的 stats 上浮。

export interface InsightPromptEvent {
  timestamp: number;
  /** 宿主 id（getActiveHostId()） */
  host: string;
  /** 原始用户输入长度 */
  originalLength: number;
  /** 增强后 prompt 长度 */
  finalLength: number;
  /** 本次注入的 memory id（既有 usedMemoryIds） */
  usedMemoryIds: number[];
  /** 命中的 skill 名（既有 matchedSkills；未命中为空数组） */
  matchedSkills: string[];
  /** 本轮是否注入 preset */
  presetInjected: boolean;
  /** Prompt 增强耗时（ms） */
  augmentDurationMs: number;
  /** Memory 查询（selectMemories）耗时（ms） */
  memorySelectDurationMs: number;
  /** Rule Engine 耗时（ms）；引擎未运行（无启用规则）= null，不计入耗时统计 */
  ruleDurationMs: number | null;
}

/** 运行时校验（background 收到的 message payload 是 unknown） */
export function isInsightPromptEvent(value: unknown): value is InsightPromptEvent {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.timestamp === 'number' &&
    typeof v.host === 'string' &&
    typeof v.originalLength === 'number' &&
    typeof v.finalLength === 'number' &&
    Array.isArray(v.usedMemoryIds) &&
    Array.isArray(v.matchedSkills) &&
    typeof v.presetInjected === 'boolean' &&
    typeof v.augmentDurationMs === 'number' &&
    typeof v.memorySelectDurationMs === 'number' &&
    (v.ruleDurationMs === null || typeof v.ruleDurationMs === 'number')
  );
}
