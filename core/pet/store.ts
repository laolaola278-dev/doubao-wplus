import type { PetConfig } from '../types';
import { readStorageValueWithMigration } from '../platform/storage-migration';
import { normalizePetConfig } from './config';

const STORAGE_KEY = 'doubao_wplus_pet';
// backward compat: old brand
const DEPRECATED_STORAGE_KEY = 'deepseek_pp_pet';

export async function getPetConfig(): Promise<PetConfig> {
  return normalizePetConfig(await readStorageValueWithMigration<Partial<PetConfig>>(
    chrome.storage.local,
    STORAGE_KEY,
    DEPRECATED_STORAGE_KEY,
  ));
}

export async function savePetConfig(config: PetConfig): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: normalizePetConfig(config) });
}

export async function clearPetConfig(): Promise<void> {
  await chrome.storage.local.remove([STORAGE_KEY, DEPRECATED_STORAGE_KEY]);
}
