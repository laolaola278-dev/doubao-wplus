/**
 * Per-tool enabled/disabled settings for built-in web tools.
 * Stored in chrome.storage.local so settings persist across sessions.
 */

import { WEB_SEARCH_TOOL_NAMES, type WebSearchToolName } from './web-search';
import { readStorageValueWithMigration } from '../platform/storage-migration';

const STORAGE_KEY = 'doubao_wplus_web_tool_settings';
// backward compat: old brand
const DEPRECATED_STORAGE_KEY = 'deepseek_pp_web_tool_settings';

export type WebToolSettings = Record<WebSearchToolName, boolean>;

const DEFAULT_SETTINGS: WebToolSettings = {
  web_search: true,
  web_fetch: true,
};

export async function getWebToolSettings(): Promise<WebToolSettings> {
  const stored = await readStorageValueWithMigration<unknown>(
    chrome.storage.local,
    STORAGE_KEY,
    DEPRECATED_STORAGE_KEY,
  );
  if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
    return {
      ...DEFAULT_SETTINGS,
      ...(stored as Partial<WebToolSettings>),
    };
  }
  return { ...DEFAULT_SETTINGS };
}

export async function setWebToolEnabled(name: WebSearchToolName, enabled: boolean): Promise<void> {
  const current = await getWebToolSettings();
  current[name] = enabled;
  await chrome.storage.local.set({ [STORAGE_KEY]: current });
}

export async function isWebToolEnabled(name: WebSearchToolName): Promise<boolean> {
  const settings = await getWebToolSettings();
  return settings[name] ?? true;
}
