// core/rules/engine.ts
// Rule Engine — 求值与执行。
//
// 管线契约（与 Prompt Pipeline 的兼容边界）：
//   runRuleEngine(context) 是 augmentRequestBody 的**前置预处理**，产出：
//     - prompt 变换（enable-skill / append / replace → 改写后的 prompt 字符串）
//     - state 调整（inject-memory → pinnedMemoryIds；set-preset → presetOverrideId）
//     - 控制信号（block / confirm）
//   由调用方（content.ts）把变换应用到 body 的 prompt 字段与 RequestAugmentationState，
//   augmentRequestBody 本身零改动 —— 规则效果走的全是既有注入通道。
//
// 求值语义：
//   - 只处理 enabled 规则，按 priority 升序（同值按 id 字典序，确定性）
//   - 每条规则 match: 'all'|'any' 组合其条件
//   - 动作按声明顺序应用；prompt 变换链式（后一条看到前一条的结果）
//   - stopOnMatch 中止后续规则
//   - block-send 立即短路（不再执行后续动作/规则）
//   - 单条规则求值抛异常 → 该规则记 error 跳过，绝不让坏规则阻塞发送

import type {
  PromptRule,
  RuleAction,
  RuleCondition,
  RuleEngineConfig,
} from './types';

/** 求值上下文 —— 由调用方（content.ts）从既有运行时状态组装，引擎不自己取数 */
export interface RuleEvaluationContext {
  prompt: string;
  hostId: string;
  pageUrl: string;
  isFirstMessage: boolean;
  /** 本轮 prompt 按生产打分命中的记忆条数（调用方用 selectMemories 预计算） */
  memoryHitCount: number;
  hasAttachments: boolean;
  variables: Record<string, string>;
  /** 时间条件的求值时刻（默认当前时间；测试可注入） */
  now?: Date;
}

/** 单条规则的执行记录（执行日志用） */
export interface RuleExecutionRecord {
  ruleId: string;
  ruleName: string;
  matched: boolean;
  /** 应用的动作 kind 列表（未命中为空） */
  appliedActions: string[];
  /** 求值异常（无异常为 null） */
  error: string | null;
}

/** 引擎产出 —— 对增强输入的声明式变换 */
export interface RuleEngineOutcome {
  /** 变换后的 prompt（无规则命中时 === 输入 prompt） */
  prompt: string;
  /** 是否有任何变换发生 */
  promptChanged: boolean;
  /** inject-memory 累积的记忆 id（调用方将这些记忆按 pinned 处理） */
  pinnedMemoryIds: number[];
  /** set-preset 的最终值（undefined = 无规则设置；null = 显式清除本轮 preset） */
  presetOverrideId: string | null | undefined;
  /** 阻止发送（含原因）；null = 放行 */
  blocked: { ruleId: string; reason: string } | null;
  /** 需要用户确认的消息（可多条，按序弹出）；确认动作由调用方执行 */
  confirmations: Array<{ ruleId: string; message: string }>;
  /** log-diagnostics 消息 */
  diagnosticsLogs: string[];
  /** 逐规则执行记录 */
  records: RuleExecutionRecord[];
}

// ============================================================
// 条件求值
// ============================================================

export function evaluateCondition(cond: RuleCondition, ctx: RuleEvaluationContext): boolean {
  switch (cond.kind) {
    case 'keyword': {
      const lower = ctx.prompt.toLowerCase();
      return cond.keywords.some((k) => lower.includes(k.toLowerCase()));
    }
    case 'regex':
      return new RegExp(cond.pattern, cond.flags).test(ctx.prompt);
    case 'length': {
      const len = ctx.prompt.length;
      switch (cond.op) {
        case 'gt': return len > cond.value;
        case 'lt': return len < cond.value;
        case 'gte': return len >= cond.value;
        case 'lte': return len <= cond.value;
      }
      return false;
    }
    case 'host':
      return ctx.hostId === cond.hostId;
    case 'url':
      return cond.match.startsWith('re:')
        ? new RegExp(cond.match.slice(3)).test(ctx.pageUrl)
        : ctx.pageUrl.includes(cond.match);
    case 'time': {
      const now = ctx.now ?? new Date();
      const minutes = now.getHours() * 60 + now.getMinutes();
      const from = parseHHMM(cond.from);
      const to = parseHHMM(cond.to);
      // 跨午夜区间（如 22:00-06:00）
      return from <= to ? (minutes >= from && minutes <= to) : (minutes >= from || minutes <= to);
    }
    case 'session':
      return cond.state === 'first-message' ? ctx.isFirstMessage : !ctx.isFirstMessage;
    case 'memory-hit':
      return ctx.memoryHitCount >= cond.minHits;
    case 'attachment':
      return ctx.hasAttachments === cond.present;
    case 'variable': {
      const actual = ctx.variables[cond.name] ?? '';
      switch (cond.op) {
        case 'eq': return actual === cond.value;
        case 'neq': return actual !== cond.value;
        case 'contains': return actual.includes(cond.value);
      }
      return false;
    }
  }
}

function parseHHMM(s: string): number {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
}

export function evaluateRuleConditions(rule: PromptRule, ctx: RuleEvaluationContext): boolean {
  return rule.match === 'all'
    ? rule.conditions.every((c) => evaluateCondition(c, ctx))
    : rule.conditions.some((c) => evaluateCondition(c, ctx));
}

// ============================================================
// 动作应用
// ============================================================

interface MutableOutcome {
  prompt: string;
  pinnedMemoryIds: number[];
  presetOverrideId: string | null | undefined;
  blocked: RuleEngineOutcome['blocked'];
  confirmations: RuleEngineOutcome['confirmations'];
  diagnosticsLogs: string[];
}

/** 应用单个动作；返回 false 表示发送被阻断（短路） */
function applyAction(action: RuleAction, ruleId: string, out: MutableOutcome): boolean {
  switch (action.kind) {
    case 'enable-skill':
      // 复用既有 skill 展开路径：改写为 /skill 命令，augmentRequestBody 的
      // parseSkillCommand 会像用户手输一样展开（含指令包装与 memoryEnabled 语义）
      if (!out.prompt.startsWith(`/${action.skillName} `) && out.prompt !== `/${action.skillName}`) {
        out.prompt = `/${action.skillName} ${out.prompt}`;
      }
      return true;
    case 'inject-memory':
      for (const id of action.memoryIds) {
        if (!out.pinnedMemoryIds.includes(id)) out.pinnedMemoryIds.push(id);
      }
      return true;
    case 'append-prompt':
      out.prompt = action.position === 'before'
        ? `${action.text}\n\n${out.prompt}`
        : `${out.prompt}\n\n${action.text}`;
      return true;
    case 'replace-prompt':
      out.prompt = action.pattern
        ? out.prompt.replace(new RegExp(action.pattern, action.flags ?? 'g'), action.text)
        : action.text;
      return true;
    case 'set-preset':
      out.presetOverrideId = action.presetId; // 后写覆盖前写（优先级高的规则先执行会被后续覆盖 —— 见冲突检测）
      return true;
    case 'block-send':
      out.blocked = { ruleId, reason: action.reason };
      return false;
    case 'confirm-send':
      out.confirmations.push({ ruleId, message: action.message });
      return true;
    case 'log-diagnostics':
      out.diagnosticsLogs.push(action.message);
      return true;
  }
}

// ============================================================
// 引擎主入口
// ============================================================

export function runRuleEngine(config: RuleEngineConfig, ctx: RuleEvaluationContext): RuleEngineOutcome {
  const out: MutableOutcome = {
    prompt: ctx.prompt,
    pinnedMemoryIds: [],
    presetOverrideId: undefined,
    blocked: null,
    confirmations: [],
    diagnosticsLogs: [],
  };
  const records: RuleExecutionRecord[] = [];

  const active = config.rules
    .filter((rule) => rule.enabled)
    .sort((a, b) => (a.priority - b.priority) || a.id.localeCompare(b.id));

  for (const rule of active) {
    let matched = false;
    const applied: string[] = [];
    let error: string | null = null;
    try {
      // 条件对「当前变换后的 prompt」求值：规则链上后面的规则看到前面的效果
      matched = evaluateRuleConditions(rule, { ...ctx, prompt: out.prompt });
      if (matched) {
        for (const action of rule.actions) {
          applied.push(action.kind);
          const keepGoing = applyAction(action, rule.id, out);
          if (!keepGoing) break;
        }
      }
    } catch (err) {
      // 坏规则绝不阻塞发送：记录后跳过
      error = err instanceof Error ? err.message : String(err);
    }
    records.push({ ruleId: rule.id, ruleName: rule.name, matched, appliedActions: applied, error });
    if (out.blocked) break;
    if (matched && rule.stopOnMatch) break;
  }

  return {
    prompt: out.prompt,
    promptChanged: out.prompt !== ctx.prompt,
    pinnedMemoryIds: out.pinnedMemoryIds,
    presetOverrideId: out.presetOverrideId,
    blocked: out.blocked,
    confirmations: out.confirmations,
    diagnosticsLogs: out.diagnosticsLogs,
    records,
  };
}
