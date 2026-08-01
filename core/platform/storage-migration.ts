type MigratableStorageArea = Pick<chrome.storage.StorageArea, 'get' | 'set' | 'remove'>;

export async function readStorageValueWithMigration<T>(
  area: MigratableStorageArea,
  currentKey: string,
  deprecatedKey: string,
): Promise<T | undefined> {
  const currentData = await area.get(currentKey) as Record<string, T | undefined>;
  if (currentData[currentKey] !== undefined) return currentData[currentKey];

  const deprecatedData = await area.get(deprecatedKey) as Record<string, T | undefined>;
  const deprecatedValue = deprecatedData[deprecatedKey];
  if (deprecatedValue === undefined) return undefined;

  await area.set({ [currentKey]: deprecatedValue });
  await area.remove(deprecatedKey);
  return deprecatedValue;
}
