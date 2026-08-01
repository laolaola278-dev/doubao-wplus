import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
  DEPRECATED_SHELL_MCP_NATIVE_HOST,
  DEPRECATED_SHELL_MCP_NATIVE_HOST_SETTING_KEY,
  SHELL_MCP_NATIVE_HOST,
  SHELL_MCP_NATIVE_HOST_SETTING_KEY,
} from '../core/shell/contracts';
import { getShellNativeHostName, setShellNativeHostName } from '../core/shell/host-name-store';

type StorageMock = {
  data: Record<string, unknown>;
  get: (keys?: string | string[] | null) => Promise<Record<string, unknown>>;
  set: (items: Record<string, unknown>) => Promise<void>;
  remove: (keys: string | string[]) => Promise<void>;
};

function makeChromeStorageMock(): StorageMock {
  const data: Record<string, unknown> = {};
  return {
    data,
    get: vi.fn(async (keys?: string | string[] | null) => {
      if (!keys) return { ...data };
      const list = Array.isArray(keys) ? keys : [keys];
      const out: Record<string, unknown> = {};
      for (const k of list) if (k in data) out[k] = data[k];
      return out;
    }),
    set: vi.fn(async (items: Record<string, unknown>) => {
      Object.assign(data, items);
    }),
    remove: vi.fn(async (keys: string | string[]) => {
      const list = Array.isArray(keys) ? keys : [keys];
      for (const k of list) delete data[k];
    }),
  };
}

describe('shell host name store (B-13)', () => {
  let storage: StorageMock;

  beforeEach(() => {
    storage = makeChromeStorageMock();
    // @ts-expect-error - assign a minimal chrome shim for the test environment.
    globalThis.chrome = { storage: { local: storage } };
  });

  it('falls back to the Doubao WPlus default when nothing is configured', async () => {
    expect(await getShellNativeHostName()).toBe(SHELL_MCP_NATIVE_HOST);
    expect(SHELL_MCP_NATIVE_HOST).toBe('com.doubao_wplus.shell');
  });

  it('returns the user-configured name when one is set', async () => {
    storage.data[SHELL_MCP_NATIVE_HOST_SETTING_KEY] = 'com.dev_myid.shell';
    expect(await getShellNativeHostName()).toBe('com.dev_myid.shell');
  });

  it('migrates the deprecated storage key', async () => {
    // backward compat: old brand
    storage.data[DEPRECATED_SHELL_MCP_NATIVE_HOST_SETTING_KEY] = DEPRECATED_SHELL_MCP_NATIVE_HOST;
    expect(await getShellNativeHostName()).toBe(DEPRECATED_SHELL_MCP_NATIVE_HOST);
    expect(storage.data[SHELL_MCP_NATIVE_HOST_SETTING_KEY]).toBe(DEPRECATED_SHELL_MCP_NATIVE_HOST);
    expect(storage.data[DEPRECATED_SHELL_MCP_NATIVE_HOST_SETTING_KEY]).toBeUndefined();
  });

  it('strips whitespace before saving and rejects empty values', async () => {
    await setShellNativeHostName('   com.dev_x.shell   ');
    expect(storage.data[SHELL_MCP_NATIVE_HOST_SETTING_KEY]).toBe('com.dev_x.shell');

    await setShellNativeHostName('   ');
    expect(storage.data[SHELL_MCP_NATIVE_HOST_SETTING_KEY]).toBeUndefined();
  });

  it('removes the setting when the value matches the current default', async () => {
    storage.data[SHELL_MCP_NATIVE_HOST_SETTING_KEY] = 'com.stale.shell';
    await setShellNativeHostName(SHELL_MCP_NATIVE_HOST);
    expect(storage.data[SHELL_MCP_NATIVE_HOST_SETTING_KEY]).toBeUndefined();
  });
});
