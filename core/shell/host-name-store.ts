import { SHELL_MCP_NATIVE_HOST } from './contracts';

const STORAGE_KEY = 'dpp.shell.nativeHostName';

/**
 * Returns the user-configured native messaging host name, falling back to
 * the historical default (`com.deepseek_pp.shell`) which is what the
 * published Chrome Web Store build of the extension registers.
 *
 * Local unpacked builds (different extension ID) should override this
 * from the Settings page so the native host can be installed against the
 * unpacked extension's ID.
 */
export async function getShellNativeHostName(): Promise<string> {
  const data = await chrome.storage.local.get(STORAGE_KEY) as Record<string, unknown>;
  const value = data[STORAGE_KEY];
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }
  return SHELL_MCP_NATIVE_HOST;
}

export async function setShellNativeHostName(name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed || trimmed === SHELL_MCP_NATIVE_HOST) {
    await chrome.storage.local.remove(STORAGE_KEY);
    return;
  }
  await chrome.storage.local.set({ [STORAGE_KEY]: trimmed });
}
