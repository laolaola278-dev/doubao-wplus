import type { SyncConfig } from '../types';
import { readStorageValueWithMigration } from '../platform/storage-migration';

const CONFIG_KEY = 'doubao_wplus_sync_config';
// backward compat: old brand
const DEPRECATED_CONFIG_KEY = 'deepseek_pp_sync_config';

export async function getSyncConfig(): Promise<SyncConfig | null> {
  return await readStorageValueWithMigration<SyncConfig>(
    chrome.storage.local,
    CONFIG_KEY,
    DEPRECATED_CONFIG_KEY,
  ) ?? null;
}

export async function saveSyncConfig(config: SyncConfig): Promise<void> {
  await chrome.storage.local.set({ [CONFIG_KEY]: config });
}
