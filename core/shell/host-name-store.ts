import {
  DEPRECATED_SHELL_MCP_NATIVE_HOST_SETTING_KEY,
  SHELL_MCP_NATIVE_HOST,
  SHELL_MCP_NATIVE_HOST_SETTING_KEY,
} from './contracts';

/**
 * Returns the user-configured native messaging host name.
 * New installs use the Doubao WPlus host; an older configured host is copied
 * to the new setting once and then the deprecated key is removed.
 */
export async function getShellNativeHostName(): Promise<string> {
  const data = await chrome.storage.local.get([
    SHELL_MCP_NATIVE_HOST_SETTING_KEY,
    DEPRECATED_SHELL_MCP_NATIVE_HOST_SETTING_KEY,
  ]) as Record<string, unknown>;
  const current = readHostName(data[SHELL_MCP_NATIVE_HOST_SETTING_KEY]);
  if (current) return current;

  const deprecated = readHostName(data[DEPRECATED_SHELL_MCP_NATIVE_HOST_SETTING_KEY]);
  if (deprecated) {
    await chrome.storage.local.set({ [SHELL_MCP_NATIVE_HOST_SETTING_KEY]: deprecated });
    await chrome.storage.local.remove(DEPRECATED_SHELL_MCP_NATIVE_HOST_SETTING_KEY);
    return deprecated;
  }
  // Existing installations that still have the old native host registered can
  // continue to work until the user installs the new host package.
  return SHELL_MCP_NATIVE_HOST;
}

export async function setShellNativeHostName(name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed || trimmed === SHELL_MCP_NATIVE_HOST) {
    await chrome.storage.local.remove([
      SHELL_MCP_NATIVE_HOST_SETTING_KEY,
      DEPRECATED_SHELL_MCP_NATIVE_HOST_SETTING_KEY,
    ]);
    return;
  }
  await chrome.storage.local.set({ [SHELL_MCP_NATIVE_HOST_SETTING_KEY]: trimmed });
  await chrome.storage.local.remove(DEPRECATED_SHELL_MCP_NATIVE_HOST_SETTING_KEY);
}

function readHostName(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
