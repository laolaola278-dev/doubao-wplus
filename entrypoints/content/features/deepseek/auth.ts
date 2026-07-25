// entrypoints/content/features/deepseek/auth.ts
// DeepSeek authentication — persists client headers from fetch interception

import {
  createClientHeaders,
  rememberDeepSeekClientHeaders,
  saveClientHeadersToStorage,
} from '../../../../core/deepseek/adapter';

export function normalizeCapturedClientHeaders(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== 'object') return null;
  const headers = value as Record<string, unknown>;
  const authorization = headers.Authorization;
  if (typeof authorization !== 'string' || !authorization) return null;

  const normalized: Record<string, string> = { Authorization: authorization };
  for (const [key, entry] of Object.entries(headers)) {
    if (key === 'Authorization') continue;
    if (typeof entry === 'string' && entry) normalized[key] = entry;
  }
  return normalized;
}

export async function persistDeepSeekClientHeaders(capturedHeaders?: Record<string, string> | null): Promise<boolean> {
  const headers = capturedHeaders ?? createClientHeaders();
  if (!headers) return false;
  rememberDeepSeekClientHeaders(headers);
  const saved = await saveClientHeadersToStorage();
  if (!saved) return false;
  chrome.runtime.sendMessage({ type: 'AUTH_STATUS_CHANGED' }).catch(() => {});
  return true;
}
