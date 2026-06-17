import { describe, expect, it, beforeEach, vi } from 'vitest';
import { SHELL_MCP_NATIVE_HOST } from '../core/shell/contracts';
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

  it('falls back to the historical default when nothing is configured', async () => {
    expect(await getShellNativeHostName()).toBe(SHELL_MCP_NATIVE_HOST);
    expect(SHELL_MCP_NATIVE_HOST).toBe('com.deepseek_pp.shell');
  });

  it('returns the user-configured name when one is set', async () => {
    storage.data['dpp.shell.nativeHostName'] = 'com.dev_myid.shell';
    expect(await getShellNativeHostName()).toBe('com.dev_myid.shell');
  });

  it('strips whitespace before saving and rejects empty values', async () => {
    await setShellNativeHostName('   com.dev_x.shell   ');
    expect(storage.data['dpp.shell.nativeHostName']).toBe('com.dev_x.shell');

    await setShellNativeHostName('   ');
    expect(storage.data['dpp.shell.nativeHostName']).toBeUndefined();
  });

  it('removes the setting when the value matches the historical default', async () => {
    storage.data['dpp.shell.nativeHostName'] = 'com.stale.shell';
    await setShellNativeHostName(SHELL_MCP_NATIVE_HOST);
    expect(storage.data['dpp.shell.nativeHostName']).toBeUndefined();
  });
});
