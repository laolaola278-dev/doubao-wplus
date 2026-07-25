import { DEFAULT_LOCALE, translate, type SupportedLocale } from '../i18n';
import { buildPromptAugmentation, markVisibleUserPrompt, type PromptStagePieces } from '../prompt';
import {
  DEFAULT_PROMPT_INJECTION_SETTINGS,
  normalizePromptInjectionSettings,
  shouldInjectPresetForTurn,
  type PromptInjectionSettings,
} from '../prompt/settings';
import { parseSkillCommand } from '../skill/parser';
import type { Memory, ModelType, Skill, SystemPromptPreset, ToolDescriptor } from '../types';
import { filterMemoriesByProjectScope } from '../memory/scope';
import { getActiveAdapter } from '../hosts/registry';
import { isFlagEnabled, readBodyField, writeBodyField } from '../hosts/shared/body-fields';

export interface RequestAugmentationState {
  memories: Memory[];
  skills: Array<Pick<Skill, 'name' | 'instructions' | 'memoryEnabled'>>;
  activePreset: SystemPromptPreset | null;
  projectContext?: string | null;
  projectId?: string | null;
  modelType: ModelType;
  toolDescriptors: readonly ToolDescriptor[];
  messageCount: number;
  locale?: SupportedLocale;
  promptSettings?: Partial<PromptInjectionSettings>;
  /**
   * Prompt Inspector（dev 工具）：为 true 时结果附带 inspection 采集数据。
   * 零重算 —— 只透传管线内既有的中间值引用。默认 false，行为与旧版一致。
   */
  captureInspection?: boolean;
}

/** Prompt Inspector 采集数据（captureInspection=true 时返回；均为既有中间值的引用） */
export interface RequestAugmentationInspection {
  /** 原始用户输入（写回前的 prompt 字段值） */
  originalPrompt: string;
  /** Skill 展开后的用户任务（未命中 skill 时与 originalPrompt 相同） */
  agentTaskPrompt: string;
  /** 命中的 skill 名（未命中为空数组；双 skill 链式命中时含两个） */
  matchedSkills: string[];
  /** 最终 prompt 的拼接件（见 PromptStagePieces 不变量） */
  stagePieces: PromptStagePieces;
  /** 增强后的完整 prompt */
  augmentedPrompt: string;
  /** 本轮是否首条消息 */
  isFirstMessage: boolean;
  /** 思考模式是否开启 */
  thinkingEnabled: boolean;
  /** 本轮是否注入了 preset */
  presetInjected: boolean;
}

/** AI Insights 采集标量（始终返回；均为管线既有中间值，零重算、不含 prompt 文本） */
export interface RequestAugmentationStats {
  /** 原始用户输入长度 */
  originalLength: number;
  /** 增强后 prompt 长度 */
  finalLength: number;
  /** 命中的 skill 名（未命中为空数组） */
  matchedSkills: string[];
  /** 本轮是否注入 preset */
  presetInjected: boolean;
  /** Memory 查询（selectMemories）耗时（ms） */
  memorySelectDurationMs: number;
}

export interface RequestBodyAugmentationResult {
  body: string;
  agentTaskPrompt: string;
  usedMemoryIds: number[];
  messageCount: number;
  /** AI Insights 统计标量（隐私安全：只有长度/名称/布尔/耗时） */
  stats: RequestAugmentationStats;
  /** 仅 captureInspection=true 时存在 */
  inspection?: RequestAugmentationInspection;
}

interface ResolvedSkills {
  combinedPrompt: string;
  memoryEnabled: boolean;
  /** 命中的 skill 名（主 skill 在前） */
  matchedSkills: string[];
}

const DOUBAO_TOOL_PROTOCOL_GUARD_ZH = [
  '豆包兼容要求：上述工具是 WPlus 客户端 XML 文本协议，不是豆包内置 Agent、文档、代码或文件工具。',
  '需要调用工具时，禁止在豆包远端工作区代执行，也禁止调用豆包内置工具。',
  '当用户请求创建文件、生成文档或运行命令时，本轮最终回答必须只包含对应的原始 XML 工具块，等待 WPlus 本地执行并返回结果。',
  '在收到 WPlus 工具返回值之前，不得声称文件、文档或命令已经完成。',
].join('\n');

const DOUBAO_TOOL_PROTOCOL_GUARD_EN = [
  'Doubao compatibility: the tools above use the WPlus client-side XML text protocol; they are not Doubao built-in agent, document, code, or file tools.',
  'When a tool is needed, do not execute the task in Doubao remote workspace and do not call a Doubao built-in tool.',
  'For file creation, document generation, or shell commands, the final answer for this turn must contain only the raw XML tool block(s), then wait for WPlus to execute locally and return the result.',
  'Do not claim completion before receiving a WPlus tool result.',
].join('\n');

const DOUBAO_ARTIFACT_FILE_TASK_RE = /\b[^\s/\\]+\.(?:md|txt|json|html?|css|jsx?|tsx?|py|csv|xml|ya?ml)\b/i;

function selectToolDescriptorsForRequest(
  hostId: string,
  taskPrompt: string,
  descriptors: readonly ToolDescriptor[],
  skillName?: string,
): readonly ToolDescriptor[] {
  if (hostId !== 'doubao' || descriptors.length <= 1) return descriptors;

  if (skillName === 'office') {
    const shellExec = descriptors.find((descriptor) => descriptor.name === 'shell_exec');
    return shellExec ? [shellExec] : descriptors;
  }
  if (skillName === 'shell') {
    const requestedNames = /\b(status|environment|platform|shell|path)\b|环境|平台|状态|路径/i.test(taskPrompt)
      ? new Set(['shell_exec', 'shell_status'])
      : new Set(['shell_exec']);
    const shellDescriptors = descriptors.filter((descriptor) => requestedNames.has(descriptor.name));
    return shellDescriptors.length > 0 ? shellDescriptors : descriptors;
  }

  const selected = descriptors.filter((descriptor) =>
    taskPrompt.includes(descriptor.name) ||
    (descriptor.invocationName ? taskPrompt.includes(descriptor.invocationName) : false),
  );
  if (DOUBAO_ARTIFACT_FILE_TASK_RE.test(taskPrompt)) {
    const artifactCreate = descriptors.find((descriptor) => descriptor.name === 'artifact_create');
    if (artifactCreate && !selected.includes(artifactCreate)) selected.push(artifactCreate);
  }
  return selected.length > 0 ? selected : descriptors;
}

function buildDoubaoOfficeCompactPrompt(
  task: string,
  locale: SupportedLocale,
): { augmented: string; stagePieces: PromptStagePieces } {
  const system = locale === 'en'
    ? [
        'You are the WPlus client-side OfficeCLI command planner. Do not call Doubao built-in agents, Word/document tools, code tools, or remote file tools.',
        'The only available tool is shell_exec. Its executable text protocol is <shell_exec>{"command":"...","timeout_ms":120000}</shell_exec>.',
        'Return exactly one raw shell_exec XML block and no other text.',
        'The command must use the safe relative filename 2026-07-work-summary.docx and run, in one call: officecli create; officecli add to /body with a Heading1 paragraph and at least two normal paragraphs; officecli validate --json; officecli view text.',
        'Use the real syntax: officecli add FILE /body --type paragraph --prop style=Heading1 --prop text=TITLE. Use --type paragraph --prop text=CONTENT for body paragraphs.',
        'Keep the JSON valid. Avoid quotes, backslashes, or line breaks inside the command value; use semicolons between commands and content tokens without spaces.',
      ].join('\n')
    : [
        '你是 WPlus 客户端 OfficeCLI 命令规划器。不要调用豆包内置 Agent、Word/文档、代码或远端文件工具。',
        '唯一可用工具是 shell_exec；可执行文本协议为 <shell_exec>{"command":"...","timeout_ms":120000}</shell_exec>。',
        '本轮最终回答必须只包含一个原始 shell_exec XML 工具块，不要输出其他文字。',
        '必须使用安全相对文件名 2026-07-work-summary.docx，并在一次命令中依次执行：officecli create；向 /body 添加一个 Heading1 段落和至少两个普通 paragraph；officecli validate --json；officecli view text。',
        '使用真实语法：officecli add 文件 /body --type paragraph --prop style=Heading1 --prop text=标题；正文使用 --type paragraph --prop text=内容。',
        '确保 JSON 合法。command 值内部不要使用引号、反斜杠或换行；多条命令用分号连接，段落内容用不含空格的中文短句。',
      ].join('\n');
  const systemPrefix = `${system}\n\n`;
  const markedUserPrompt = markVisibleUserPrompt(task);
  const toolReminder = `\n\n${locale === 'en' ? DOUBAO_TOOL_PROTOCOL_GUARD_EN : DOUBAO_TOOL_PROTOCOL_GUARD_ZH}`;
  return {
    augmented: systemPrefix + markedUserPrompt + toolReminder,
    stagePieces: {
      presetPrefix: '',
      systemPrefix,
      markedUserPrompt,
      toolReminder,
      memoriesBlock: '',
      projectContextBlock: '',
    },
  };
}

export function augmentRequestBody(
  bodyStr: string,
  state: RequestAugmentationState,
): RequestBodyAugmentationResult | null {
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(bodyStr);
  } catch {
    return null;
  }

  const adapter = getActiveAdapter();
  const fields = adapter.getRequestBodyFields();
  const promptValue = readBodyField(body, fields.prompt);
  const originalPrompt = typeof promptValue === 'string' ? promptValue : '';
  if (!originalPrompt) return null;
  const locale = state.locale ?? DEFAULT_LOCALE;
  const toolProtocolReminderSuffix = adapter.id === 'doubao'
    ? locale === 'en' ? DOUBAO_TOOL_PROTOCOL_GUARD_EN : DOUBAO_TOOL_PROTOCOL_GUARD_ZH
    : '';

  const thinkingEnabled = isFlagEnabled(readBodyField(body, fields.thinkingEnabled));
  const parentMessageValue = readBodyField(body, fields.parentMessageId);
  const isFirstMessage = parentMessageValue === null || parentMessageValue === undefined;
  const messageCount = isFirstMessage ? 1 : state.messageCount + 1;
  const promptSettings = normalizePromptInjectionSettings(state.promptSettings ?? DEFAULT_PROMPT_INJECTION_SETTINGS);
  const shouldInjectPreset = shouldInjectPresetForTurn({
    hasActivePreset: Boolean(state.activePreset),
    isFirstMessage,
    messageCount,
    cadence: promptSettings.presetCadence,
  });
  const presetContent = shouldInjectPreset ? state.activePreset!.content : null;
  const forceResponseLanguage = promptSettings.forceResponseLanguage === 'auto'
    ? null
    : promptSettings.forceResponseLanguage;

  // B-01 fix: respect the user's manual choice and skip injection when files are attached.
  // DeepSeek's R1 (expert mode) renders file attachments unreliably — when the
  // user uploads a file in the page UI we must not force the page into "深度思考"
  // mode. Likewise, if the user already picked a model in the web UI, the
  // extension should not override it.
  // When images/files are attached, force the vision model so DeepSeek uses
  // its native visual analysis capability instead of R1 (which cannot see images).
  // Hosts without these fields (empty path, e.g. doubao) read undefined and
  // writeBodyField is a no-op, so this block degrades safely.
  const refFileIdsValue = readBodyField(body, fields.refFileIds);
  const hasUserFileAttachments = Array.isArray(refFileIdsValue) && refFileIdsValue.length > 0;
  const modelTypeValue = readBodyField(body, fields.modelType);
  const userSelectedModel = typeof modelTypeValue === 'string' && modelTypeValue.length > 0;
  if (hasUserFileAttachments) {
    writeBodyField(body, fields.modelType, 'vision');
  } else if (state.modelType && !userSelectedModel) {
    writeBodyField(body, fields.modelType, state.modelType);
  }

  const invocation = parseSkillCommand(originalPrompt);
  if (invocation) {
    const resolved = resolveSkills(state.skills, invocation.skillName, invocation.args, locale);
    if (resolved) {
      const requestToolDescriptors = selectToolDescriptorsForRequest(
        adapter.id,
        invocation.args,
        state.toolDescriptors,
        invocation.skillName,
      );
      if (
        adapter.id === 'doubao' &&
        invocation.skillName === 'office' &&
        requestToolDescriptors.some((descriptor) => descriptor.name === 'shell_exec')
      ) {
        const compact = buildDoubaoOfficeCompactPrompt(invocation.args, locale);
        if (!writeBodyField(body, fields.prompt, compact.augmented)) return null;
        const result: RequestBodyAugmentationResult = {
          body: JSON.stringify(body),
          agentTaskPrompt: resolved.combinedPrompt,
          usedMemoryIds: [],
          messageCount,
          stats: {
            originalLength: originalPrompt.length,
            finalLength: compact.augmented.length,
            matchedSkills: resolved.matchedSkills,
            presetInjected: false,
            memorySelectDurationMs: 0,
          },
        };
        if (state.captureInspection === true) {
          result.inspection = {
            originalPrompt,
            agentTaskPrompt: resolved.combinedPrompt,
            matchedSkills: resolved.matchedSkills,
            stagePieces: compact.stagePieces,
            augmentedPrompt: compact.augmented,
            isFirstMessage,
            thinkingEnabled,
            presetInjected: false,
          };
        }
        return result;
      }
      const scopedMemories = filterMemoriesByProjectScope(state.memories, state.projectId);
      const { augmented, usedMemoryIds, memorySelectDurationMs, stagePieces } = buildPromptAugmentation(resolved.combinedPrompt, {
        memories: scopedMemories,
        thinkingEnabled,
        identityOnly: !resolved.memoryEnabled,
        presetContent,
        projectContext: state.projectContext,
        toolDescriptors: requestToolDescriptors,
        locale,
        memoryEnabled: promptSettings.memoryEnabled,
        systemPromptEnabled: promptSettings.systemPromptEnabled,
        forceResponseLanguage,
        hasFileAttachments: hasUserFileAttachments,
        toolProtocolReminderSuffix,
        captureStages: state.captureInspection === true,
      });

      if (!writeBodyField(body, fields.prompt, augmented)) return null;
      const result: RequestBodyAugmentationResult = {
        body: JSON.stringify(body),
        agentTaskPrompt: resolved.combinedPrompt,
        usedMemoryIds,
        messageCount,
        stats: {
          originalLength: originalPrompt.length,
          finalLength: augmented.length,
          matchedSkills: resolved.matchedSkills,
          presetInjected: Boolean(presetContent),
          memorySelectDurationMs,
        },
      };
      if (state.captureInspection === true && stagePieces) {
        result.inspection = {
          originalPrompt,
          agentTaskPrompt: resolved.combinedPrompt,
          matchedSkills: resolved.matchedSkills,
          stagePieces,
          augmentedPrompt: augmented,
          isFirstMessage,
          thinkingEnabled,
          presetInjected: Boolean(presetContent),
        };
      }
      return result;
    }
  }

  const requestToolDescriptors = selectToolDescriptorsForRequest(
    adapter.id,
    originalPrompt,
    state.toolDescriptors,
  );
  const { augmented, usedMemoryIds, memorySelectDurationMs, stagePieces } = buildPromptAugmentation(originalPrompt, {
    memories: filterMemoriesByProjectScope(state.memories, state.projectId),
    thinkingEnabled,
    presetContent,
    projectContext: state.projectContext,
    toolDescriptors: requestToolDescriptors,
    locale,
    memoryEnabled: promptSettings.memoryEnabled,
    systemPromptEnabled: promptSettings.systemPromptEnabled,
    forceResponseLanguage,
    hasFileAttachments: hasUserFileAttachments,
    toolProtocolReminderSuffix,
    captureStages: state.captureInspection === true,
  });
  if (!writeBodyField(body, fields.prompt, augmented)) return null;

  const result: RequestBodyAugmentationResult = {
    body: JSON.stringify(body),
    agentTaskPrompt: originalPrompt,
    usedMemoryIds,
    messageCount,
    stats: {
      originalLength: originalPrompt.length,
      finalLength: augmented.length,
      matchedSkills: [],
      presetInjected: Boolean(presetContent),
      memorySelectDurationMs,
    },
  };
  if (state.captureInspection === true && stagePieces) {
    result.inspection = {
      originalPrompt,
      agentTaskPrompt: originalPrompt,
      matchedSkills: [],
      stagePieces,
      augmentedPrompt: augmented,
      isFirstMessage,
      thinkingEnabled,
      presetInjected: Boolean(presetContent),
    };
  }
  return result;
}

function resolveSkills(
  skills: RequestAugmentationState['skills'],
  skillName: string,
  args: string,
  locale: SupportedLocale,
): ResolvedSkills | null {
  const primarySkill = skills.find((s) => s.name === skillName);
  if (!primarySkill) return null;

  const secondInvocation = parseSkillCommand('/' + args);
  if (secondInvocation) {
    const secondSkill = skills.find((s) => s.name === secondInvocation.skillName);
    if (secondSkill) {
      const userArgs = secondInvocation.args;
      const combinedInstructions = primarySkill.instructions + '\n\n---\n\n' + secondSkill.instructions;
      return {
        combinedPrompt: userArgs
          ? wrapUserInput(combinedInstructions, userArgs, locale)
          : combinedInstructions,
        memoryEnabled: primarySkill.memoryEnabled || secondSkill.memoryEnabled,
        matchedSkills: [primarySkill.name, secondSkill.name],
      };
    }
  }

  return {
    combinedPrompt: args
      ? wrapUserInput(primarySkill.instructions, args, locale)
      : primarySkill.instructions,
    memoryEnabled: primarySkill.memoryEnabled,
    matchedSkills: [primarySkill.name],
  };
}

function wrapUserInput(
  instructions: string,
  userInput: string,
  locale: SupportedLocale,
): string {
  return translate(locale, 'prompt.skillUserInputWrapper', { instructions, userInput });
}
