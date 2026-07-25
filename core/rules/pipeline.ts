// core/rules/pipeline.ts
// Rule Engine ↔ Prompt Pipeline 的适配层。
//
// 把引擎的声明式产出翻译成 augmentRequestBody 能消化的输入变换：
//   - prompt 变换：经宿主 mapping（readBodyField/writeBodyField）读写 body 的 prompt 字段
//     —— 与 augmentRequestBody 完全相同的读写通道，宿主无关
//   - inject-memory：把指定记忆以 pinned=true 的副本传入（生产打分 +1000 必选，
//     仍受 token 预算约束，不绕过任何注入逻辑）
//   - set-preset：本轮替换 activePreset（不改全局激活状态）
//   - block/confirm：返回控制信号，由调用方处理
//
// 纯函数：不做 IO，所有数据由调用方传入 —— 保证可测。

import type { Memory, SystemPromptPreset } from '../types';
import { getActiveAdapter } from '../hosts/registry';
import { readBodyField, writeBodyField } from '../hosts/shared/body-fields';
import { selectMemories } from '../memory/selector';
import { runRuleEngine, type RuleEngineOutcome, type RuleEvaluationContext } from './engine';
import type { RuleEngineConfig } from './types';

export interface RulePipelineInput {
  /** 原始请求 body 字符串 */
  bodyStr: string;
  config: RuleEngineConfig;
  memories: Memory[];
  /** 所有 preset（set-preset 动作按 id 查找） */
  presets: SystemPromptPreset[];
  activePreset: SystemPromptPreset | null;
  pageUrl: string;
  /** 测试可注入时间 */
  now?: Date;
}

export interface RulePipelineResult {
  /** 规则应用后的 body 字符串（prompt 字段已改写；无变化时 === 输入） */
  bodyStr: string;
  /** 调整后的记忆列表（inject-memory 的目标已置 pinned 副本） */
  memories: Memory[];
  /** 调整后的 activePreset（set-preset 生效时替换；否则原样） */
  activePreset: SystemPromptPreset | null;
  /** 引擎原始产出（日志/阻断/确认由调用方消费） */
  outcome: RuleEngineOutcome | null;
  /** 是否实际运行了引擎（无启用规则 / body 非聊天结构时 false，全部原样透传） */
  engineRan: boolean;
}

/**
 * 运行规则引擎并把产出应用到增强输入。
 * 快速路径：无启用规则时不解析 body、不建上下文 —— 零开销透传。
 */
export function applyRulesToAugmentationInput(input: RulePipelineInput): RulePipelineResult {
  const passthrough: RulePipelineResult = {
    bodyStr: input.bodyStr,
    memories: input.memories,
    activePreset: input.activePreset,
    outcome: null,
    engineRan: false,
  };

  if (!input.config.rules.some((r) => r.enabled)) return passthrough;

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(input.bodyStr);
  } catch {
    return passthrough;
  }

  const adapter = getActiveAdapter();
  const fields = adapter.getRequestBodyFields();
  const promptValue = readBodyField(body, fields.prompt);
  if (typeof promptValue !== 'string' || !promptValue) return passthrough; // 非聊天 body，与增强判定一致

  const parentValue = readBodyField(body, fields.parentMessageId);
  const refFileIds = readBodyField(body, fields.refFileIds);

  const ctx: RuleEvaluationContext = {
    prompt: promptValue,
    hostId: adapter.id,
    pageUrl: input.pageUrl,
    isFirstMessage: parentValue === null || parentValue === undefined,
    // memory-hit 条件：用生产选取逻辑预计算（与实际注入同一函数）
    memoryHitCount: selectMemories(promptValue, [...input.memories]).length,
    hasAttachments: Array.isArray(refFileIds) && refFileIds.length > 0,
    variables: input.config.variables,
    now: input.now,
  };

  const outcome = runRuleEngine(input.config, ctx);

  // 阻断：不改任何输入，控制权交调用方
  if (outcome.blocked) {
    return { ...passthrough, outcome, engineRan: true };
  }

  // prompt 变换写回（与 augmentRequestBody 同一写通道）
  let bodyStr = input.bodyStr;
  if (outcome.promptChanged) {
    if (writeBodyField(body, fields.prompt, outcome.prompt)) {
      bodyStr = JSON.stringify(body);
    }
  }

  // inject-memory → pinned 副本（拷贝数组，不改调用方状态）
  let memories = input.memories;
  if (outcome.pinnedMemoryIds.length > 0) {
    const targets = new Set(outcome.pinnedMemoryIds);
    memories = input.memories.map((m) =>
      m.id != null && targets.has(m.id) && !m.pinned ? { ...m, pinned: true } : m);
  }

  // set-preset → 本轮替换（undefined = 未设置；null = 显式清除）
  let activePreset = input.activePreset;
  if (outcome.presetOverrideId !== undefined) {
    activePreset = outcome.presetOverrideId === null
      ? null
      : input.presets.find((p) => p.id === outcome.presetOverrideId) ?? input.activePreset;
  }

  return { bodyStr, memories, activePreset, outcome, engineRan: true };
}
