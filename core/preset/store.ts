import type { SystemPromptPreset } from '../types';
import { readStorageValueWithMigration } from '../platform/storage-migration';

const STORAGE_KEY = 'doubao_wplus_presets';
const ACTIVE_KEY = 'doubao_wplus_active_preset_id';
// backward compat: old brand
const DEPRECATED_STORAGE_KEY = 'deepseek_pp_presets';
// backward compat: old brand
const DEPRECATED_ACTIVE_KEY = 'deepseek_pp_active_preset_id';

export async function getAllPresets(): Promise<SystemPromptPreset[]> {
  const presets = await readStorageValueWithMigration<unknown>(
    chrome.storage.local,
    STORAGE_KEY,
    DEPRECATED_STORAGE_KEY,
  );
  return Array.isArray(presets) ? (presets as SystemPromptPreset[]) : [];
}

export async function savePreset(preset: SystemPromptPreset): Promise<void> {
  const presets = await getAllPresets();
  const idx = presets.findIndex((p) => p.id === preset.id);
  if (idx >= 0) {
    presets[idx] = preset;
  } else {
    presets.push(preset);
  }
  await chrome.storage.local.set({ [STORAGE_KEY]: presets });
}

export async function deletePreset(id: string): Promise<void> {
  const presets = await getAllPresets();
  const filtered = presets.filter((p) => p.id !== id);
  await chrome.storage.local.set({ [STORAGE_KEY]: filtered });

  const activeId = await getActivePresetId();
  if (activeId === id) {
    await setActivePresetId(null);
  }
}

export async function getActivePresetId(): Promise<string | null> {
  const activeId = await readStorageValueWithMigration<unknown>(
    chrome.storage.local,
    ACTIVE_KEY,
    DEPRECATED_ACTIVE_KEY,
  );
  return typeof activeId === 'string' ? activeId : null;
}

export async function setActivePresetId(id: string | null): Promise<void> {
  if (id === null) {
    await chrome.storage.local.remove([ACTIVE_KEY, DEPRECATED_ACTIVE_KEY]);
  } else {
    await chrome.storage.local.set({ [ACTIVE_KEY]: id });
  }
}

export async function getActivePreset(): Promise<SystemPromptPreset | null> {
  const activeId = await getActivePresetId();
  if (!activeId) return null;
  const presets = await getAllPresets();
  return presets.find((p) => p.id === activeId) ?? null;
}

export async function replaceAllPresets(presets: SystemPromptPreset[]): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: presets });

  const activeId = await getActivePresetId();
  if (activeId && !presets.some((preset) => preset.id === activeId)) {
    await setActivePresetId(null);
  }
}
