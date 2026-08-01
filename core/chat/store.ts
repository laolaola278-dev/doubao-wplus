import { readStorageValueWithMigration } from '../platform/storage-migration';

export const CHAT_ENABLED_STORAGE_KEY = 'doubao_wplus_chat_enabled';
// backward compat: old brand
export const DEPRECATED_CHAT_ENABLED_STORAGE_KEY = 'deepseek_pp_chat_enabled';

// Must match STORAGE_HEADERS_KEY in core/deepseek/adapter.ts
const STORAGE_HEADERS_KEY = 'deepseekCachedClientHeaders';

export async function getChatEnabled(): Promise<boolean> {
  return await readStorageValueWithMigration(
    chrome.storage.local,
    CHAT_ENABLED_STORAGE_KEY,
    DEPRECATED_CHAT_ENABLED_STORAGE_KEY,
  ) === true;
}

export async function setChatEnabled(enabled: boolean): Promise<void> {
  await chrome.storage.local.set({ [CHAT_ENABLED_STORAGE_KEY]: enabled });
  await chrome.storage.local.remove(DEPRECATED_CHAT_ENABLED_STORAGE_KEY);
  if (!enabled) {
    try {
      await chrome.storage.local.remove(STORAGE_HEADERS_KEY);
    } catch {}
  }
}
