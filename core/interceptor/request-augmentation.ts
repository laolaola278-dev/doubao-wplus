import { DEFAULT_LOCALE, translate, type SupportedLocale } from '../i18n';
import { buildPromptAugmentation } from '../prompt';
import {
  DEFAULT_PROMPT_INJECTION_SETTINGS,
  normalizePromptInjectionSettings,
  shouldInjectPresetForTurn,
  type PromptInjectionSettings,
} from '../prompt/settings';
import { parseSkillCommand } from '../skill/parser';
import type { Memory, ModelType, Skill, SystemPromptPreset, ToolDescriptor } from '../types';
import { filterMemoriesByProjectScope } from '../memory/scope';

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
}

export interface RequestBodyAugmentationResult {
  body: string;
  agentTaskPrompt: string;
  usedMemoryIds: number[];
  messageCount: number;
}

interface ResolvedSkills {
  combinedPrompt: string;
  memoryEnabled: boolean;
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

  const originalPrompt = (body.prompt as string) || '';
  if (!originalPrompt) return null;
  const locale = state.locale ?? DEFAULT_LOCALE;

  const thinkingEnabled = body.thinking_enabled === true;
  const isFirstMessage = body.parent_message_id === null || body.parent_message_id === undefined;
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
  const hasUserFileAttachments = Array.isArray(body.ref_file_ids) && (body.ref_file_ids as unknown[]).length > 0;
  const userSelectedModel = typeof body.model_type === 'string' && body.model_type.length > 0;
  if (hasUserFileAttachments) {
    body.model_type = 'vision';
  } else if (state.modelType && !userSelectedModel) {
    body.model_type = state.modelType;
  }

  const invocation = parseSkillCommand(originalPrompt);
  if (invocation) {
    const resolved = resolveSkills(state.skills, invocation.skillName, invocation.args, locale);
    if (resolved) {
      const scopedMemories = filterMemoriesByProjectScope(state.memories, state.projectId);
      const { augmented, usedMemoryIds } = buildPromptAugmentation(resolved.combinedPrompt, {
        memories: scopedMemories,
        thinkingEnabled,
        identityOnly: !resolved.memoryEnabled,
        presetContent,
        projectContext: state.projectContext,
        toolDescriptors: state.toolDescriptors,
        locale,
        memoryEnabled: promptSettings.memoryEnabled,
        systemPromptEnabled: promptSettings.systemPromptEnabled,
        forceResponseLanguage,
        hasFileAttachments: hasUserFileAttachments,
      });

      body.prompt = augmented;
      return {
        body: JSON.stringify(body),
        agentTaskPrompt: resolved.combinedPrompt,
        usedMemoryIds,
        messageCount,
      };
    }
  }

  const { augmented, usedMemoryIds } = buildPromptAugmentation(originalPrompt, {
    memories: filterMemoriesByProjectScope(state.memories, state.projectId),
    thinkingEnabled,
    presetContent,
    projectContext: state.projectContext,
    toolDescriptors: state.toolDescriptors,
    locale,
    memoryEnabled: promptSettings.memoryEnabled,
    systemPromptEnabled: promptSettings.systemPromptEnabled,
    forceResponseLanguage,
    hasFileAttachments: hasUserFileAttachments,
  });
  body.prompt = augmented;

  return {
    body: JSON.stringify(body),
    agentTaskPrompt: originalPrompt,
    usedMemoryIds,
    messageCount,
  };
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
      };
    }
  }

  return {
    combinedPrompt: args
      ? wrapUserInput(primarySkill.instructions, args, locale)
      : primarySkill.instructions,
    memoryEnabled: primarySkill.memoryEnabled,
  };
}

function wrapUserInput(
  instructions: string,
  userInput: string,
  locale: SupportedLocale,
): string {
  return translate(locale, 'prompt.skillUserInputWrapper', { instructions, userInput });
}
