import { SHELL_TOOL_NAMES } from '../shell/contracts';
import type { Memory, ToolDescriptor } from '../types';
import { DEFAULT_LOCALE, translate, type SupportedLocale } from '../i18n';
import {
  DEFAULT_TOOL_DESCRIPTORS,
  createDefaultToolDescriptors,
  createToolInvocationCatalog,
  getPreferredToolInvocationName,
  getToolInvocationNames,
  type ToolInvocationCatalog,
} from '../tool';
import { estimateTokens, formatMemoriesBlock, getMemoryBudget, selectMemories } from '../memory/selector';
import { markVisibleUserPrompt } from './visibility';

export interface PromptAugmentationOptions {
  memories?: readonly Memory[];
  thinkingEnabled?: boolean;
  identityOnly?: boolean;
  presetContent?: string | null;
  projectContext?: string | null;
  toolDescriptors?: readonly ToolDescriptor[];
  locale?: SupportedLocale;
  memoryEnabled?: boolean;
  systemPromptEnabled?: boolean;
  forceResponseLanguage?: SupportedLocale | null;
  hasFileAttachments?: boolean;
  /** 宿主专用的工具协议尾部约束；为空时不改变现有 Prompt。 */
  toolProtocolReminderSuffix?: string;
  /**
   * Prompt Inspector（dev 工具）：为 true 时在结果上附加 stagePieces —— 拼接
   * 最终 prompt 用的各中间字符串的引用。零重算：这些字符串本来就会被计算，
   * 此选项只决定是否把引用暴露出去。默认 false，结果形状与旧版完全一致。
   */
  captureStages?: boolean;
}

/**
 * 最终 prompt 的拼接件（Prompt Inspector 采集用）。
 * 不变量：presetPrefix + systemPrefix + markedUserPrompt + toolReminder === augmented
 * （由 tests/prompt-inspector.test.ts 锁定）。
 */
export interface PromptStagePieces {
  /** Preset 前缀（含分隔线；无 preset 为空串） */
  presetPrefix: string;
  /** 系统脚手架前缀（角色/记忆/工具/项目上下文/搜索规则；含尾随空行） */
  systemPrefix: string;
  /** 带可见性标记的用户输入段 */
  markedUserPrompt: string;
  /** 工具格式提醒尾缀 */
  toolReminder: string;
  /** 记忆块单独引用（systemPrefix 的组成部分，便于 Inspector 单独展示） */
  memoriesBlock: string;
  /** Project Context 单独引用（同上） */
  projectContextBlock: string;
}

export interface PromptAugmentationResult {
  augmented: string;
  usedMemoryIds: number[];
  renderedToolCount: number;
  /** Memory 查询（selectMemories）耗时（ms；memoryEnabled=false 时为 0）。AI Insights 采集用 */
  memorySelectDurationMs: number;
  /** 仅 captureStages=true 时存在（Prompt Inspector 采集） */
  stagePieces?: PromptStagePieces;
}

/** performance.now() 安全封装（非浏览器环境退回 Date.now()） */
function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export function buildPromptAugmentation(
  originalPrompt: string,
  options?: PromptAugmentationOptions,
): PromptAugmentationResult {
  const {
    memories = [],
    thinkingEnabled = false,
    identityOnly = false,
    presetContent = null,
    projectContext = null,
    locale = DEFAULT_LOCALE,
    memoryEnabled = true,
    systemPromptEnabled = true,
    forceResponseLanguage = null,
    hasFileAttachments = false,
    toolProtocolReminderSuffix = '',
    captureStages = false,
  } = options ?? {};
  const toolDescriptors = options?.toolDescriptors ?? createDefaultToolDescriptors(locale);

  const promptTokens = estimateTokens(originalPrompt);
  const budget = getMemoryBudget(promptTokens);
  // Memory 查询计时（AI Insights）：只包 selectMemories 本身，微秒级开销
  const memorySelectStart = memoryEnabled ? nowMs() : 0;
  const selected = memoryEnabled
    ? selectMemories(originalPrompt, [...memories], { budget, identityOnly })
    : [];
  const memorySelectDurationMs = memoryEnabled
    ? Math.round((nowMs() - memorySelectStart) * 100) / 100
    : 0;
  const memBlock = memoryEnabled
    ? formatMemoriesBlock(selected, locale)
    : translate(locale, 'prompt.memoryDisabled');
  const toolsBlock = systemPromptEnabled ? renderToolSchemas(toolDescriptors, locale) : '';
  const baseSystem = systemPromptEnabled
    ? translate(
      locale,
      thinkingEnabled ? 'prompt.systemThinking' : 'prompt.systemChat',
      { memories: memBlock, tools: toolsBlock },
    )
    : '';
  const standaloneMemories = !systemPromptEnabled && memoryEnabled
    ? translate(locale, 'prompt.standaloneMemories', { memories: memBlock })
    : '';
  const system = [
    baseSystem,
    standaloneMemories,
    renderProjectContext(projectContext),
    systemPromptEnabled ? renderWebSearchGuidance(toolDescriptors, locale) : '',
    systemPromptEnabled && hasFileAttachments ? translate(locale, 'prompt.imageAttachmentHint') : '',
    renderForcedResponseLanguage(forceResponseLanguage, locale),
  ].filter(Boolean).join('\n\n');
  const presetPrefix = presetContent ? `${presetContent}\n\n---\n\n` : '';
  const toolReminder = systemPromptEnabled
    ? renderToolFormatReminder(toolDescriptors, locale) +
      (toolProtocolReminderSuffix ? `\n\n${toolProtocolReminderSuffix}` : '')
    : '';
  const systemPrefix = system ? `${system}\n\n` : '';
  const markedUserPrompt = markVisibleUserPrompt(originalPrompt);

  const result: PromptAugmentationResult = {
    augmented: presetPrefix + systemPrefix + markedUserPrompt + toolReminder,
    usedMemoryIds: selected.map((memory) => memory.id!).filter(Boolean),
    renderedToolCount: systemPromptEnabled ? toolDescriptors.length : 0,
    memorySelectDurationMs,
  };
  if (captureStages) {
    // 零重算：仅暴露既有中间字符串的引用（Prompt Inspector 采集点）
    result.stagePieces = {
      presetPrefix,
      systemPrefix,
      markedUserPrompt,
      toolReminder,
      memoriesBlock: memBlock,
      projectContextBlock: renderProjectContext(projectContext),
    };
  }
  return result;
}

function renderProjectContext(projectContext?: string | null): string {
  const trimmed = typeof projectContext === 'string' ? projectContext.trim() : '';
  return trimmed;
}

function renderForcedResponseLanguage(
  forceResponseLanguage: SupportedLocale | null,
  locale: SupportedLocale,
): string {
  if (!forceResponseLanguage) return '';
  const language = forceResponseLanguage === 'en'
    ? translate(locale, 'prompt.responseLanguageEnglish')
    : translate(locale, 'prompt.responseLanguageChinese');
  return translate(locale, 'prompt.forceResponseLanguage', { language });
}

export function renderToolSchemas(
  descriptors?: readonly ToolDescriptor[],
  locale: SupportedLocale = DEFAULT_LOCALE,
): string {
  const resolvedDescriptors = descriptors ?? createDefaultToolDescriptors(locale);
  const catalog = createToolInvocationCatalog(resolvedDescriptors);
  const shellHint = renderShellMcpHint(resolvedDescriptors, catalog, locale);
  const pythonHint = renderPythonMcpHint(resolvedDescriptors, catalog, locale);
  const schemas = resolvedDescriptors
    .map((descriptor) => renderToolSchema(descriptor, catalog))
    .join('\n\n');
  return [shellHint, pythonHint, schemas].filter(Boolean).join('\n\n');
}

function renderWebSearchGuidance(
  descriptors: readonly ToolDescriptor[],
  locale: SupportedLocale,
): string {
  const hasWebSearch = descriptors.some((descriptor) => descriptor.name === 'web_search');
  if (!hasWebSearch) return '';

  return translate(locale, 'prompt.webSearchGuidance');
}

function renderPythonMcpHint(
  descriptors: readonly ToolDescriptor[],
  catalog: ToolInvocationCatalog,
  locale: SupportedLocale,
): string {
  const pythonExec = descriptors.find((descriptor) => descriptor.name === 'python_exec');
  const pythonStatus = descriptors.find((descriptor) => descriptor.name === 'python_status');
  if (!pythonExec && !pythonStatus) return '';

  const execName = pythonExec ? getPreferredToolInvocationName(pythonExec, catalog) : null;
  const statusName = pythonStatus ? getPreferredToolInvocationName(pythonStatus, catalog) : null;

  return [
    translate(locale, 'prompt.pythonHintTitle'),
    execName
      ? translate(locale, 'prompt.pythonHintExec', { execName })
      : '',
    statusName
      ? translate(locale, 'prompt.pythonHintStatus', { statusName })
      : '',
    translate(locale, 'prompt.pythonHintAvailability'),
    translate(locale, 'prompt.pythonHintSafety'),
  ].filter(Boolean).join('\n');
}

function renderToolSchema(descriptor: ToolDescriptor, catalog: ToolInvocationCatalog): string {
  const examplePayload = createExamplePayload(descriptor);
  const preferredName = getPreferredToolInvocationName(descriptor, catalog);
  const acceptedNames = getToolInvocationNames(descriptor, catalog);
  const lines = [
    `### Tool ${preferredName}`,
    `Title: ${descriptor.title}`,
    `Description: ${descriptor.description}`,
    acceptedNames.length > 1 ? `Accepted tag names: ${acceptedNames.join(', ')}` : '',
    `Valid call format for ${preferredName}:`,
    `<${preferredName}>`,
    JSON.stringify(examplePayload, null, 2),
    `</${preferredName}>`,
    `Invalid formats: <invoke name="${preferredName}">...</invoke>, <tool_call>...</tool_call>`,
    `Parameters JSON Schema: ${JSON.stringify(descriptor.inputSchema)}`,
  ];
  return lines.filter(Boolean).join('\n');
}

function renderShellMcpHint(
  descriptors: readonly ToolDescriptor[],
  catalog: ToolInvocationCatalog,
  locale: SupportedLocale,
): string {
  const shellExec = descriptors.find((descriptor) => descriptor.name === 'shell_exec');
  if (!shellExec) return '';

  const shellStatus = descriptors.find((descriptor) => descriptor.name === 'shell_status');
  const execName = getPreferredToolInvocationName(shellExec, catalog);
  const statusName = shellStatus ? getPreferredToolInvocationName(shellStatus, catalog) : null;

  return [
    translate(locale, 'prompt.shellHintTitle'),
    translate(locale, 'prompt.shellHintConnected'),
    translate(locale, 'prompt.shellHintExec', { execName }),
    statusName
      ? translate(locale, 'prompt.shellHintStatus', { statusName })
      : '',
    translate(locale, 'prompt.shellHintWindows'),
    translate(locale, 'prompt.shellHintNames', { names: SHELL_TOOL_NAMES.join(', ') }),
  ].filter(Boolean).join('\n');
}

export function renderToolFormatReminder(
  descriptors?: readonly ToolDescriptor[],
  locale: SupportedLocale = DEFAULT_LOCALE,
): string {
  const catalog = createToolInvocationCatalog(descriptors ?? createDefaultToolDescriptors(locale));
  const names = catalog.invocationNames;
  if (names.length === 0) return '';
  return `\n\n${translate(locale, 'prompt.toolFormatReminder', { names: names.join(', ') })}`;
}

function createExamplePayload(descriptor: ToolDescriptor): Record<string, unknown> {
  const properties = descriptor.inputSchema.properties ?? {};
  const required = descriptor.inputSchema.required ?? Object.keys(properties);
  const payload: Record<string, unknown> = {};

  for (const key of required) {
    payload[key] = exampleValue(properties[key]);
  }

  return payload;
}

function exampleValue(schema: unknown): unknown {
  if (!schema || typeof schema !== 'object') return 'value';
  const value = schema as Record<string, unknown>;
  const type = value.type;
  if (Array.isArray(type)) return exampleValue({ ...value, type: type[0] });
  if (value.enum && Array.isArray(value.enum) && value.enum.length > 0) return value.enum[0];
  switch (type) {
    case 'number':
    case 'integer':
      return 0;
    case 'boolean':
      return false;
    case 'array':
      return [];
    case 'object':
      return {};
    case 'string':
    default: {
      const desc = typeof value.description === 'string' ? value.description.toLowerCase() : '';
      if (type === 'string' && (desc.includes('file path') || desc.includes('file_path') || desc.includes('filepath'))) {
        if (desc.includes('.pptx')) return './example.pptx';
        if (desc.includes('.docx')) return './example.docx';
        if (desc.includes('.xlsx')) return './example.xlsx';
        return './example.txt';
      }
      return 'value';
    }
  }
}
