export const DOUBAO_API_KEY_STORAGE_KEY = 'doubao_wplus_official_api_key';

export async function getDoubaoApiKey(): Promise<string | null> {
  const data = await chrome.storage.local.get(DOUBAO_API_KEY_STORAGE_KEY) as Record<string, unknown>;
  return normalizeApiKey(data[DOUBAO_API_KEY_STORAGE_KEY]);
}

export async function hasDoubaoApiKey(): Promise<boolean> {
  return (await getDoubaoApiKey()) !== null;
}

export async function saveDoubaoApiKey(apiKey: string): Promise<void> {
  const normalized = normalizeApiKey(apiKey);
  if (!normalized) {
    throw new Error('豆包 API Key 不能为空');
  }
  await chrome.storage.local.set({ [DOUBAO_API_KEY_STORAGE_KEY]: normalized });
}

export async function clearDoubaoApiKey(): Promise<void> {
  await chrome.storage.local.remove(DOUBAO_API_KEY_STORAGE_KEY);
}

function normalizeApiKey(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
