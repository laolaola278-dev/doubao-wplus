import { describe, expect, it } from 'vitest';
import { readStorageValueWithMigration } from '../core/platform/storage-migration';

describe('storage brand migration', () => {
  it('copies a deprecated value to the current key and removes the old key', async () => {
    const values = new Map<string, unknown>([['deprecated-key', { enabled: true }]]);
    const area = {
      async get(keys: string | string[]) {
        return Object.fromEntries(
          (Array.isArray(keys) ? keys : [keys])
            .filter((key) => values.has(key))
            .map((key) => [key, values.get(key)]),
        );
      },
      async set(items: Record<string, unknown>) {
        for (const [key, value] of Object.entries(items)) values.set(key, value);
      },
      async remove(keys: string | string[]) {
        for (const key of Array.isArray(keys) ? keys : [keys]) values.delete(key);
      },
    } as Pick<chrome.storage.StorageArea, 'get' | 'set' | 'remove'>;

    await expect(readStorageValueWithMigration(area, 'current-key', 'deprecated-key'))
      .resolves.toEqual({ enabled: true });
    expect(values.get('current-key')).toEqual({ enabled: true });
    expect(values.has('deprecated-key')).toBe(false);
  });
});
