// core/diagnostics/prompt-inspector.ts
// Prompt Inspector — dev-only Prompt 处理管线快照。
//
// 定位：开发者调试工具。展示 Prompt 从原始输入到最终发送的每个阶段，
// 不改变任何增强逻辑，只观测。
//
// 数据流（全部复用既有链路，零重算）：
//   augmentRequestBody(captureInspection=true)
//     └─ buildPromptAugmentation(captureStages=true) 暴露拼接件引用
//   → buildPromptSnapshot()（本模块，纯函数组装）
//   → recordPromptSnapshot() 写入环形缓冲（默认容量 20）
//   → markSnapshotSendResult() 在 RESPONSE_COMPLETE / 增强失败时回填发送结果
//   → diagnostics-export 的 lastPromptSnapshot / UI 面板读取
//
// 门控：与 dev-diagnostics 同一开关（DEV / E2E 构建）。生产构建：
//   - isPromptInspectorEnabled() 恒 false
//   - augmentRequestBody 不带 captureInspection，管线零额外分配
//   - record/mark 均为 no-op
//
// 脱敏：快照含 prompt 文本（这是 Inspector 的目的 —— 本地 DevTools 查看），
// 但绝不含 Cookie / Token / Authorization / header 值。
// 注意：诊断导出（diagnostics-export）只带脱敏摘要（长度/阶段/结果），不带全文。

import type { RequestAugmentationInspection } from '../interceptor/request-augmentation';
import { getActiveAdapter, getActiveHostId } from '../hosts/registry';
import { isDevDiagnosticsEnabled } from './dev-diagnostics';

/** Timeline 阶段 id（顺序即展示顺序） */
export type PromptStageId = 'raw-input' | 'skill' | 'memory-system' | 'preset' | 'final';

export interface PromptStageNode {
  id: PromptStageId;
  /** 本阶段结束时的完整 prompt 文本 */
  prompt: string;
  /** 本阶段文本长度 */
  length: number;
  /** 本阶段是否实际发生（如未命中 skill 时 skill 阶段 changed=false） */
  changed: boolean;
  /** 阶段说明（如命中的 skill 名、注入的记忆条数） */
  note: string;
}

export interface PromptSnapshot {
  /** 快照 id（递增序号，会话内唯一） */
  seq: number;
  /** 生成时间戳 */
  timestamp: number;
  /** 当前宿主 */
  host: string;
  /** adapter 版本（getMeta().adapterVersion） */
  adapterVersion: string;
  /** 原始用户输入 */
  originalPrompt: string;
  /** 最终 prompt */
  finalPrompt: string;
  /** 最终 prompt 长度 */
  finalLength: number;
  /** Timeline 阶段节点（raw-input → skill → memory-system → preset → final） */
  stages: PromptStageNode[];
  /** 是否命中记忆（usedMemoryIds 非空） */
  memoryHit: boolean;
  /** 命中的记忆 id */
  usedMemoryIds: number[];
  /** 命中的 skill 名 */
  matchedSkills: string[];
  /** 是否注入 preset */
  presetInjected: boolean;
  /** 是否首条消息 */
  isFirstMessage: boolean;
  /** 思考模式 */
  thinkingEnabled: boolean;
  /** 增强耗时（ms，由调用方计时传入） */
  augmentDurationMs: number;
  /** 增强是否成功（false = augmentRequestBody 返回 null 或抛异常） */
  augmentSucceeded: boolean;
  /** 发送结果：pending（尚未回填）/ sent（流完成）/ failed */
  sendStatus: 'pending' | 'sent' | 'failed';
}

/** 诊断导出用的脱敏摘要（无 prompt 全文） */
export interface PromptSnapshotSummary {
  seq: number;
  timestamp: number;
  host: string;
  adapterVersion: string;
  originalLength: number;
  finalLength: number;
  stageLengths: Array<{ id: PromptStageId; length: number; changed: boolean }>;
  memoryHit: boolean;
  usedMemoryCount: number;
  matchedSkills: string[];
  presetInjected: boolean;
  augmentDurationMs: number;
  augmentSucceeded: boolean;
  sendStatus: PromptSnapshot['sendStatus'];
}

// ============================================================
// 门控与环形缓冲
// ============================================================

/** 用户主动开启标志（DevTools: window.__DWPLUS_PROMPT_INSPECTOR__ = true） */
const USER_TOGGLE_KEY = '__DWPLUS_PROMPT_INSPECTOR__';
const RING_CAPACITY = 20;

let ring: PromptSnapshot[] = [];
let seqCounter = 0;

/**
 * Inspector 是否启用：DEV/E2E 构建，或用户在 DevTools 主动置位。
 * 生产构建且未主动开启时恒 false —— augmentRequestBody 不会带 captureInspection。
 */
export function isPromptInspectorEnabled(): boolean {
  if (isDevDiagnosticsEnabled()) return true;
  try {
    return (globalThis as Record<string, unknown>)[USER_TOGGLE_KEY] === true;
  } catch {
    return false;
  }
}

// ============================================================
// Snapshot 组装（纯函数，可测）
// ============================================================

/**
 * 从 inspection 数据组装 Timeline 阶段。
 * 阶段语义（与 buildPromptAugmentation 的真实拼接顺序对应）：
 *   raw-input     用户敲进输入框的原文
 *   skill         Skill 展开后的任务文本（未命中时与 raw 相同，changed=false）
 *   memory-system 系统脚手架（角色+记忆+工具+项目上下文+规则）+ 任务文本
 *   preset        preset 前缀加入（未注入时 changed=false）
 *   final         + 工具格式提醒尾缀 = 实际写回请求体的文本
 *
 * 不变量：final.prompt === inspection.augmentedPrompt
 * （即 presetPrefix + systemPrefix + markedUserPrompt + toolReminder）
 */
export function buildStageNodes(inspection: RequestAugmentationInspection): PromptStageNode[] {
  const { stagePieces: p } = inspection;
  const skillChanged = inspection.agentTaskPrompt !== inspection.originalPrompt;
  const memorySystemPrompt = p.systemPrefix + p.markedUserPrompt;
  const presetPrompt = p.presetPrefix + memorySystemPrompt;
  const finalPrompt = presetPrompt + p.toolReminder;

  return [
    {
      id: 'raw-input',
      prompt: inspection.originalPrompt,
      length: inspection.originalPrompt.length,
      changed: true,
      note: '用户原始输入',
    },
    {
      id: 'skill',
      prompt: inspection.agentTaskPrompt,
      length: inspection.agentTaskPrompt.length,
      changed: skillChanged,
      note: skillChanged
        ? `命中 skill: ${inspection.matchedSkills.join(' + ')}`
        : '未命中 skill 命令',
    },
    {
      id: 'memory-system',
      prompt: memorySystemPrompt,
      length: memorySystemPrompt.length,
      changed: p.systemPrefix.length > 0,
      note: p.systemPrefix.length > 0
        ? `系统脚手架 +${p.systemPrefix.length} 字符（记忆块 ${p.memoriesBlock.length} 字符${p.projectContextBlock ? `，项目上下文 ${p.projectContextBlock.length} 字符` : ''}）`
        : '系统提示已关闭',
    },
    {
      id: 'preset',
      prompt: presetPrompt,
      length: presetPrompt.length,
      changed: p.presetPrefix.length > 0,
      note: p.presetPrefix.length > 0 ? `preset 前缀 +${p.presetPrefix.length} 字符` : '本轮未注入 preset',
    },
    {
      id: 'final',
      prompt: finalPrompt,
      length: finalPrompt.length,
      changed: p.toolReminder.length > 0,
      note: p.toolReminder.length > 0 ? `工具格式提醒 +${p.toolReminder.length} 字符` : '无工具提醒尾缀',
    },
  ];
}

export interface BuildSnapshotInput {
  inspection: RequestAugmentationInspection;
  usedMemoryIds: number[];
  augmentDurationMs: number;
}

/** 组装完整快照（纯函数；host/adapter 版本从 registry 读取） */
export function buildPromptSnapshot(input: BuildSnapshotInput): PromptSnapshot {
  const { inspection } = input;
  let adapterVersion = 'unknown';
  try {
    adapterVersion = getActiveAdapter().getMeta().adapterVersion;
  } catch {
    // getMeta 异常不阻断快照
  }
  const stages = buildStageNodes(inspection);
  return {
    seq: ++seqCounter,
    timestamp: Date.now(),
    host: getActiveHostId(),
    adapterVersion,
    originalPrompt: inspection.originalPrompt,
    finalPrompt: inspection.augmentedPrompt,
    finalLength: inspection.augmentedPrompt.length,
    stages,
    memoryHit: input.usedMemoryIds.length > 0,
    usedMemoryIds: input.usedMemoryIds,
    matchedSkills: inspection.matchedSkills,
    presetInjected: inspection.presetInjected,
    isFirstMessage: inspection.isFirstMessage,
    thinkingEnabled: inspection.thinkingEnabled,
    augmentDurationMs: input.augmentDurationMs,
    augmentSucceeded: true,
    sendStatus: 'pending',
  };
}

// ============================================================
// 记录与回填
// ============================================================

/** 记录快照到环形缓冲（门控关闭时 no-op）；返回快照 seq（未记录返回 null） */
export function recordPromptSnapshot(snapshot: PromptSnapshot): number | null {
  if (!isPromptInspectorEnabled()) return null;
  ring.push(snapshot);
  if (ring.length > RING_CAPACITY) ring.shift();
  return snapshot.seq;
}

/** 记录一次失败的增强（augmentRequestBody 返回 null / 抛异常时） */
export function recordFailedAugmentation(originalPrompt: string, durationMs: number, reason: string): void {
  if (!isPromptInspectorEnabled()) return;
  let adapterVersion = 'unknown';
  try {
    adapterVersion = getActiveAdapter().getMeta().adapterVersion;
  } catch { /* ignore */ }
  ring.push({
    seq: ++seqCounter,
    timestamp: Date.now(),
    host: getActiveHostId(),
    adapterVersion,
    originalPrompt,
    finalPrompt: '',
    finalLength: 0,
    stages: [],
    memoryHit: false,
    usedMemoryIds: [],
    matchedSkills: [],
    presetInjected: false,
    isFirstMessage: false,
    thinkingEnabled: false,
    augmentDurationMs: durationMs,
    augmentSucceeded: false,
    sendStatus: 'failed',
  });
  if (ring.length > RING_CAPACITY) ring.shift();
  if (typeof console !== 'undefined' && console.warn) {
    console.warn(`[DWPLUS-INSPECTOR] 增强未执行（${reason}），已记录失败快照 seq=${seqCounter}`);
  }
}

/** 回填最近一条 pending 快照的发送结果（RESPONSE_COMPLETE → sent；流失败 → failed） */
export function markSnapshotSendResult(status: 'sent' | 'failed'): void {
  if (!isPromptInspectorEnabled()) return;
  for (let i = ring.length - 1; i >= 0; i--) {
    if (ring[i].sendStatus === 'pending') {
      ring[i] = { ...ring[i], sendStatus: status };
      return;
    }
  }
}

/** 读取全部快照（新→旧） */
export function getPromptSnapshots(): PromptSnapshot[] {
  return [...ring].reverse();
}

/** 最近一条快照 */
export function getLastPromptSnapshot(): PromptSnapshot | null {
  return ring.length > 0 ? ring[ring.length - 1] : null;
}

/** 脱敏摘要（诊断导出用；无 prompt 全文） */
export function summarizeSnapshot(snapshot: PromptSnapshot): PromptSnapshotSummary {
  return {
    seq: snapshot.seq,
    timestamp: snapshot.timestamp,
    host: snapshot.host,
    adapterVersion: snapshot.adapterVersion,
    originalLength: snapshot.originalPrompt.length,
    finalLength: snapshot.finalLength,
    stageLengths: snapshot.stages.map((s) => ({ id: s.id, length: s.length, changed: s.changed })),
    memoryHit: snapshot.memoryHit,
    usedMemoryCount: snapshot.usedMemoryIds.length,
    matchedSkills: snapshot.matchedSkills,
    presetInjected: snapshot.presetInjected,
    augmentDurationMs: snapshot.augmentDurationMs,
    augmentSucceeded: snapshot.augmentSucceeded,
    sendStatus: snapshot.sendStatus,
  };
}

/** 清空（测试/热重载用） */
export function clearPromptSnapshots(): void {
  ring = [];
  seqCounter = 0;
}
