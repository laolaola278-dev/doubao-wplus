// core/rules/types.ts
// Rule Engine — 声明式规则类型与校验。
//
// 设计原则：
//   - 纯声明式 JSON：规则是数据不是代码，可导入导出、可 diff、可校验
//   - 条件/动作均为 tagged union（kind 字段），新增种类只加 union 成员 —— 开放扩展
//   - 校验 fail-fast：非法规则拒绝入库，绝不让坏规则进增强热路径
//   - 规则效果被约束为「对增强输入的变换」：改 prompt / 调 state / 阻断。
//     绝不直接改写最终 body 结构 —— 保证与 Prompt Pipeline（augmentRequestBody）完全兼容

// ============================================================
// 条件（Condition）
// ============================================================

/** 关键词条件：prompt 包含任一关键词（不区分大小写） */
export interface KeywordCondition {
  kind: 'keyword';
  /** 任一命中即为真 */
  keywords: string[];
}

/** 正则条件：pattern 用 RegExp 源字符串存储（JSON 可序列化） */
export interface RegexCondition {
  kind: 'regex';
  pattern: string;
  flags?: string;
}

/** Prompt 长度条件 */
export interface LengthCondition {
  kind: 'length';
  op: 'gt' | 'lt' | 'gte' | 'lte';
  value: number;
}

/** 宿主条件 */
export interface HostCondition {
  kind: 'host';
  hostId: string;
}

/** 页面 URL 条件（子串或正则） */
export interface UrlCondition {
  kind: 'url';
  /** 子串匹配；以 're:' 前缀声明正则（如 're:^https://www\\.doubao\\.com/chat/\\d+$'） */
  match: string;
}

/** 时间条件：本地时间段（跨午夜合法，如 22:00-06:00） */
export interface TimeCondition {
  kind: 'time';
  /** 'HH:MM' 24 小时制 */
  from: string;
  to: string;
}

/** 会话状态条件 */
export interface SessionCondition {
  kind: 'session';
  state: 'first-message' | 'follow-up';
}

/** 记忆命中条件：本轮 prompt 按生产打分会命中至少 minHits 条记忆 */
export interface MemoryHitCondition {
  kind: 'memory-hit';
  minHits: number;
}

/** 附件条件 */
export interface AttachmentCondition {
  kind: 'attachment';
  present: boolean;
}

/** 用户自定义变量条件（变量由用户在规则页维护，键值均为字符串） */
export interface VariableCondition {
  kind: 'variable';
  name: string;
  op: 'eq' | 'neq' | 'contains';
  value: string;
}

export type RuleCondition =
  | KeywordCondition
  | RegexCondition
  | LengthCondition
  | HostCondition
  | UrlCondition
  | TimeCondition
  | SessionCondition
  | MemoryHitCondition
  | AttachmentCondition
  | VariableCondition;

export type RuleConditionKind = RuleCondition['kind'];

// ============================================================
// 动作（Action）
// ============================================================

/** 启用 Skill：等价于用户输入 /skillName <原 prompt> —— 复用既有 skill 展开路径 */
export interface EnableSkillAction {
  kind: 'enable-skill';
  skillName: string;
}

/** 注入 Memory：把指定记忆在本轮按 pinned 处理（生产打分 +1000 必选），不绕过 token 预算 */
export interface InjectMemoryAction {
  kind: 'inject-memory';
  memoryIds: number[];
}

/** 添加 Prompt：在用户输入前/后附加文本 */
export interface AppendPromptAction {
  kind: 'append-prompt';
  position: 'before' | 'after';
  text: string;
}

/** 替换 Prompt：正则替换用户输入（pattern 空串 = 整体替换为 text） */
export interface ReplacePromptAction {
  kind: 'replace-prompt';
  pattern: string;
  flags?: string;
  text: string;
}

/** 切换 Preset：本轮临时改用指定 preset（不改全局激活状态） */
export interface SetPresetAction {
  kind: 'set-preset';
  presetId: string | null;
}

/** 阻止发送：请求被拒绝，页面收到错误 */
export interface BlockSendAction {
  kind: 'block-send';
  reason: string;
}

/** 弹出确认：用户确认后放行，取消则阻断 */
export interface ConfirmSendAction {
  kind: 'confirm-send';
  message: string;
}

/** 写入 Diagnostics：向执行日志/console 输出一条标记（调试用） */
export interface LogDiagnosticsAction {
  kind: 'log-diagnostics';
  message: string;
}

export type RuleAction =
  | EnableSkillAction
  | InjectMemoryAction
  | AppendPromptAction
  | ReplacePromptAction
  | SetPresetAction
  | BlockSendAction
  | ConfirmSendAction
  | LogDiagnosticsAction;

export type RuleActionKind = RuleAction['kind'];

// ============================================================
// 规则
// ============================================================

export interface PromptRule {
  /** 稳定 id（uuid） */
  id: string;
  /** 展示名 */
  name: string;
  /** 是否启用 */
  enabled: boolean;
  /** 优先级：数值小者先执行（同值按 id 字典序，保证确定性） */
  priority: number;
  /** 条件列表的组合方式 */
  match: 'all' | 'any';
  conditions: RuleCondition[];
  actions: RuleAction[];
  /** 命中后是否停止后续规则（默认 false 继续） */
  stopOnMatch?: boolean;
  createdAt: number;
  updatedAt: number;
}

/** 规则集 + 用户自定义变量（variable 条件的数据源） */
export interface RuleEngineConfig {
  version: 1;
  rules: PromptRule[];
  variables: Record<string, string>;
}

export const EMPTY_RULE_ENGINE_CONFIG: RuleEngineConfig = {
  version: 1,
  rules: [],
  variables: {},
};

// ============================================================
// 校验（fail-fast；坏规则不入库）
// ============================================================

const CONDITION_KINDS: ReadonlySet<string> = new Set([
  'keyword', 'regex', 'length', 'host', 'url', 'time', 'session', 'memory-hit', 'attachment', 'variable',
]);
const ACTION_KINDS: ReadonlySet<string> = new Set([
  'enable-skill', 'inject-memory', 'append-prompt', 'replace-prompt', 'set-preset', 'block-send', 'confirm-send', 'log-diagnostics',
]);
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export interface RuleValidationResult {
  ok: boolean;
  errors: string[];
}

export function validateRule(value: unknown): RuleValidationResult {
  const errors: string[] = [];
  if (!value || typeof value !== 'object') return { ok: false, errors: ['规则必须是对象'] };
  const rule = value as Partial<PromptRule>;

  if (typeof rule.id !== 'string' || !rule.id) errors.push('id 必须为非空字符串');
  if (typeof rule.name !== 'string' || !rule.name.trim()) errors.push('name 必须为非空字符串');
  if (typeof rule.enabled !== 'boolean') errors.push('enabled 必须为布尔');
  if (typeof rule.priority !== 'number' || !Number.isFinite(rule.priority)) errors.push('priority 必须为有限数字');
  if (rule.match !== 'all' && rule.match !== 'any') errors.push("match 必须为 'all' 或 'any'");

  if (!Array.isArray(rule.conditions) || rule.conditions.length === 0) {
    errors.push('conditions 必须为非空数组');
  } else {
    rule.conditions.forEach((cond, i) => validateCondition(cond, i, errors));
  }

  if (!Array.isArray(rule.actions) || rule.actions.length === 0) {
    errors.push('actions 必须为非空数组');
  } else {
    rule.actions.forEach((action, i) => validateAction(action, i, errors));
  }

  return { ok: errors.length === 0, errors };
}

function validateCondition(cond: unknown, index: number, errors: string[]): void {
  const path = `conditions[${index}]`;
  if (!cond || typeof cond !== 'object') { errors.push(`${path} 必须是对象`); return; }
  const c = cond as Record<string, unknown>;
  if (typeof c.kind !== 'string' || !CONDITION_KINDS.has(c.kind)) {
    errors.push(`${path}.kind 非法（${String(c.kind)}）`);
    return;
  }
  switch (c.kind) {
    case 'keyword':
      if (!Array.isArray(c.keywords) || c.keywords.length === 0 || !c.keywords.every((k) => typeof k === 'string' && k.length > 0)) {
        errors.push(`${path}.keywords 必须为非空字符串数组`);
      }
      break;
    case 'regex':
      if (typeof c.pattern !== 'string' || !c.pattern) { errors.push(`${path}.pattern 必须为非空字符串`); break; }
      try { new RegExp(c.pattern, typeof c.flags === 'string' ? c.flags : undefined); }
      catch { errors.push(`${path}.pattern 不是合法正则`); }
      break;
    case 'length':
      if (!['gt', 'lt', 'gte', 'lte'].includes(String(c.op))) errors.push(`${path}.op 非法`);
      if (typeof c.value !== 'number' || c.value < 0) errors.push(`${path}.value 必须为非负数字`);
      break;
    case 'host':
      if (typeof c.hostId !== 'string' || !c.hostId) errors.push(`${path}.hostId 必须为非空字符串`);
      break;
    case 'url':
      if (typeof c.match !== 'string' || !c.match) { errors.push(`${path}.match 必须为非空字符串`); break; }
      if (c.match.startsWith('re:')) {
        try { new RegExp(c.match.slice(3)); } catch { errors.push(`${path}.match 的正则不合法`); }
      }
      break;
    case 'time':
      if (typeof c.from !== 'string' || !TIME_RE.test(c.from)) errors.push(`${path}.from 必须为 HH:MM`);
      if (typeof c.to !== 'string' || !TIME_RE.test(c.to)) errors.push(`${path}.to 必须为 HH:MM`);
      break;
    case 'session':
      if (c.state !== 'first-message' && c.state !== 'follow-up') errors.push(`${path}.state 非法`);
      break;
    case 'memory-hit':
      if (typeof c.minHits !== 'number' || c.minHits < 1) errors.push(`${path}.minHits 必须 ≥1`);
      break;
    case 'attachment':
      if (typeof c.present !== 'boolean') errors.push(`${path}.present 必须为布尔`);
      break;
    case 'variable':
      if (typeof c.name !== 'string' || !c.name) errors.push(`${path}.name 必须为非空字符串`);
      if (!['eq', 'neq', 'contains'].includes(String(c.op))) errors.push(`${path}.op 非法`);
      if (typeof c.value !== 'string') errors.push(`${path}.value 必须为字符串`);
      break;
  }
}

function validateAction(action: unknown, index: number, errors: string[]): void {
  const path = `actions[${index}]`;
  if (!action || typeof action !== 'object') { errors.push(`${path} 必须是对象`); return; }
  const a = action as Record<string, unknown>;
  if (typeof a.kind !== 'string' || !ACTION_KINDS.has(a.kind)) {
    errors.push(`${path}.kind 非法（${String(a.kind)}）`);
    return;
  }
  switch (a.kind) {
    case 'enable-skill':
      if (typeof a.skillName !== 'string' || !a.skillName) errors.push(`${path}.skillName 必须为非空字符串`);
      break;
    case 'inject-memory':
      if (!Array.isArray(a.memoryIds) || a.memoryIds.length === 0 || !a.memoryIds.every((id) => Number.isInteger(id))) {
        errors.push(`${path}.memoryIds 必须为非空整数数组`);
      }
      break;
    case 'append-prompt':
      if (a.position !== 'before' && a.position !== 'after') errors.push(`${path}.position 非法`);
      if (typeof a.text !== 'string' || !a.text) errors.push(`${path}.text 必须为非空字符串`);
      break;
    case 'replace-prompt':
      if (typeof a.pattern !== 'string') { errors.push(`${path}.pattern 必须为字符串`); break; }
      if (a.pattern) {
        try { new RegExp(a.pattern, typeof a.flags === 'string' ? a.flags : undefined); }
        catch { errors.push(`${path}.pattern 不是合法正则`); }
      }
      if (typeof a.text !== 'string') errors.push(`${path}.text 必须为字符串`);
      break;
    case 'set-preset':
      if (a.presetId !== null && (typeof a.presetId !== 'string' || !a.presetId)) errors.push(`${path}.presetId 必须为非空字符串或 null`);
      break;
    case 'block-send':
      if (typeof a.reason !== 'string' || !a.reason) errors.push(`${path}.reason 必须为非空字符串`);
      break;
    case 'confirm-send':
      if (typeof a.message !== 'string' || !a.message) errors.push(`${path}.message 必须为非空字符串`);
      break;
    case 'log-diagnostics':
      if (typeof a.message !== 'string' || !a.message) errors.push(`${path}.message 必须为非空字符串`);
      break;
  }
}

/** 校验整个配置（导入用）；返回逐条错误 */
export function validateRuleEngineConfig(value: unknown): RuleValidationResult {
  const errors: string[] = [];
  if (!value || typeof value !== 'object') return { ok: false, errors: ['配置必须是对象'] };
  const config = value as Partial<RuleEngineConfig>;
  if (config.version !== 1) errors.push('version 必须为 1');
  if (!Array.isArray(config.rules)) {
    errors.push('rules 必须为数组');
  } else {
    const seenIds = new Set<string>();
    config.rules.forEach((rule, i) => {
      const result = validateRule(rule);
      if (!result.ok) errors.push(...result.errors.map((e) => `rules[${i}]: ${e}`));
      const id = (rule as PromptRule)?.id;
      if (typeof id === 'string') {
        if (seenIds.has(id)) errors.push(`rules[${i}]: id 重复（${id}）`);
        seenIds.add(id);
      }
    });
  }
  if (config.variables !== undefined && (typeof config.variables !== 'object' || config.variables === null || Array.isArray(config.variables))) {
    errors.push('variables 必须为字符串键值对象');
  }
  return { ok: errors.length === 0, errors };
}
