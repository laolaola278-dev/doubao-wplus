export const OFFICIAL_API_CHAT_CONFIG_STORAGE_KEY = 'doubao_wplus_official_api_chat_config';

export const OFFICIAL_DOUBAO_MODELS = ['doubao-pro-32k', 'doubao-lite-32k'] as const;
export type OfficialDoubaoModel = typeof OFFICIAL_DOUBAO_MODELS[number];

export const OFFICIAL_DOUBAO_THINKING_MODES = ['disabled', 'enabled'] as const;
export type OfficialDoubaoThinkingMode = typeof OFFICIAL_DOUBAO_THINKING_MODES[number];

export const OFFICIAL_DOUBAO_REASONING_EFFORTS = ['high', 'max'] as const;
export type OfficialDoubaoReasoningEffort = typeof OFFICIAL_DOUBAO_REASONING_EFFORTS[number];

export interface OfficialApiChatConfig {
  model: OfficialDoubaoModel;
  thinking: OfficialDoubaoThinkingMode;
  reasoningEffort: OfficialDoubaoReasoningEffort;
}

export const DEFAULT_OFFICIAL_API_CHAT_CONFIG: OfficialApiChatConfig = {
  model: 'doubao-pro-32k',
  thinking: 'disabled',
  reasoningEffort: 'high',
};

export async function getOfficialApiChatConfig(): Promise<OfficialApiChatConfig> {
  const data = await chrome.storage.local.get(OFFICIAL_API_CHAT_CONFIG_STORAGE_KEY) as Record<string, unknown>;
  return normalizeOfficialApiChatConfig(data[OFFICIAL_API_CHAT_CONFIG_STORAGE_KEY]);
}

export async function saveOfficialApiChatConfig(value: unknown): Promise<OfficialApiChatConfig> {
  const config = normalizeOfficialApiChatConfig(value);
  await chrome.storage.local.set({ [OFFICIAL_API_CHAT_CONFIG_STORAGE_KEY]: config });
  return config;
}

export function normalizeOfficialApiChatConfig(value: unknown): OfficialApiChatConfig {
  if (!value || typeof value !== 'object') return DEFAULT_OFFICIAL_API_CHAT_CONFIG;
  const object = value as Partial<Record<keyof OfficialApiChatConfig, unknown>>;
  const model = normalizeModel(object.model);
  const thinking = normalizeThinkingMode(object.thinking);
  return {
    model,
    thinking,
    reasoningEffort: thinking === 'enabled'
      ? normalizeReasoningEffort(object.reasoningEffort)
      : DEFAULT_OFFICIAL_API_CHAT_CONFIG.reasoningEffort,
  };
}

function normalizeModel(value: unknown): OfficialDoubaoModel {
  return value === 'doubao-lite-32k' ? 'doubao-lite-32k' : 'doubao-pro-32k';
}

function normalizeThinkingMode(value: unknown): OfficialDoubaoThinkingMode {
  return value === 'enabled' ? 'enabled' : 'disabled';
}

function normalizeReasoningEffort(value: unknown): OfficialDoubaoReasoningEffort {
  return value === 'max' ? 'max' : 'high';
}
