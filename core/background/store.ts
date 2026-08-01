import type { BackgroundConfig } from '../types';
import { readStorageValueWithMigration } from '../platform/storage-migration';
import { normalizeBackgroundConfig } from './config';

const STORAGE_KEY = 'doubao_wplus_background';
// backward compat: old brand
const DEPRECATED_STORAGE_KEY = 'deepseek_pp_background';

export async function getBackgroundConfig(): Promise<BackgroundConfig | null> {
  const value = await readStorageValueWithMigration<Partial<BackgroundConfig>>(
    chrome.storage.local,
    STORAGE_KEY,
    DEPRECATED_STORAGE_KEY,
  );
  return normalizeBackgroundConfig(value);
}

export async function saveBackgroundConfig(config: BackgroundConfig): Promise<void> {
  const normalized = normalizeBackgroundConfig(config);
  if (!normalized) return;
  await chrome.storage.local.set({ [STORAGE_KEY]: normalized });
}

export async function clearBackgroundConfig(): Promise<void> {
  await chrome.storage.local.remove([STORAGE_KEY, DEPRECATED_STORAGE_KEY]);
}
