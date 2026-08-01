import type { ModelType } from '../types';
import { readStorageValueWithMigration } from '../platform/storage-migration';

const STORAGE_KEY = 'doubao_wplus_model_type';
// backward compat: old brand
const DEPRECATED_STORAGE_KEY = 'deepseek_pp_model_type';

export async function getModelType(): Promise<ModelType> {
  const value = await readStorageValueWithMigration(
    chrome.storage.local,
    STORAGE_KEY,
    DEPRECATED_STORAGE_KEY,
  );
  return value === 'expert' ? 'expert' : null;
}

export async function setModelType(modelType: ModelType): Promise<void> {
  if (modelType === null) {
    await chrome.storage.local.remove([STORAGE_KEY, DEPRECATED_STORAGE_KEY]);
  } else {
    await chrome.storage.local.set({ [STORAGE_KEY]: modelType });
  }
}
