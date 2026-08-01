import Dexie, { type EntityTable } from 'dexie';
import type { Memory, NewMemory } from '../types';

export const MEMORY_DATABASE_NAME = 'DoubaoWPlus';
// backward compat: old brand — only used to migrate an existing IndexedDB database.
export const DEPRECATED_MEMORY_DATABASE_NAME = 'DeepSeekPP';

const db = new Dexie(MEMORY_DATABASE_NAME) as Dexie & {
  memories: EntityTable<Memory, 'id'>;
};

db.version(1).stores({
  memories: '++id, type, name, pinned, createdAt, updatedAt, lastAccessedAt',
});

db.version(2)
  .stores({
    memories: '++id, type, name, pinned, createdAt, updatedAt, lastAccessedAt, syncId',
  })
  .upgrade((tx) => {
    return tx
      .table('memories')
      .toCollection()
      .modify((memory: Record<string, unknown>) => {
        memory.syncId = crypto.randomUUID();
      });
  });

db.version(3)
  .stores({
    memories: '++id, type, name, pinned, createdAt, updatedAt, lastAccessedAt, syncId, scope, projectId',
  })
  .upgrade((tx) => {
    return tx
      .table('memories')
      .toCollection()
      .modify((memory: Record<string, unknown>) => {
        memory.scope = 'global';
        delete memory.projectId;
      });
  });

export type MemoryDatabaseMigrationStatus =
  | { status: 'not_needed'; migratedCount: 0; oldDatabaseDeleted: false }
  | { status: 'migrated'; migratedCount: number; oldDatabaseDeleted: true }
  | { status: 'failed'; migratedCount: 0; oldDatabaseDeleted: false; error: string };

let migrationPromise: Promise<MemoryDatabaseMigrationStatus> | null = null;

export function ensureMemoryDatabaseMigration(): Promise<MemoryDatabaseMigrationStatus> {
  migrationPromise ??= migrateDeprecatedMemoryDatabase();
  return migrationPromise;
}

export async function migrateDeprecatedMemoryDatabase(): Promise<MemoryDatabaseMigrationStatus> {
  try {
    if (!(await Dexie.exists(DEPRECATED_MEMORY_DATABASE_NAME))) {
      return { status: 'not_needed', migratedCount: 0, oldDatabaseDeleted: false };
    }

    const legacyDb = createLegacyMemoryDatabase();
    try {
      await legacyDb.open();
      const legacyMemories = await legacyDb.memories.toArray();
      await db.open();
      await db.transaction('rw', db.memories, async () => {
        for (const legacyMemory of legacyMemories) {
          await migrateMemoryRecord(legacyMemory);
        }
      });
      await legacyDb.close();
      await Dexie.delete(DEPRECATED_MEMORY_DATABASE_NAME);
      return {
        status: 'migrated',
        migratedCount: legacyMemories.length,
        oldDatabaseDeleted: true,
      };
    } finally {
      legacyDb.close();
    }
  } catch (error) {
    return {
      status: 'failed',
      migratedCount: 0,
      oldDatabaseDeleted: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function getAllMemories(): Promise<Memory[]> {
  await ensureMemoryDatabaseMigration();
  return (await db.memories.toArray()).map(normalizeMemory);
}

export async function getMemoryById(id: number): Promise<Memory | undefined> {
  await ensureMemoryDatabaseMigration();
  const memory = await db.memories.get(id);
  return memory ? normalizeMemory(memory) : undefined;
}

export async function saveMemory(
  mem: NewMemory,
): Promise<number> {
  await ensureMemoryDatabaseMigration();
  const now = Date.now();
  const id = await db.memories.add({
    ...mem,
    ...normalizeMemoryScope(mem),
    syncId: mem.syncId ?? crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    accessCount: 0,
    lastAccessedAt: now,
  } as Memory);
  return id as number;
}

export async function updateMemory(mem: Memory): Promise<void> {
  await ensureMemoryDatabaseMigration();
  if (mem.id == null) return;
  await db.memories.update(mem.id, { ...mem, ...normalizeMemoryScope(mem), updatedAt: Date.now() });
}

export async function deleteMemory(id: number): Promise<void> {
  await ensureMemoryDatabaseMigration();
  await db.memories.delete(id);
}

/** 批量删除（Memory Studio 用）；返回实际删除数 */
export async function deleteMemories(ids: number[]): Promise<number> {
  await ensureMemoryDatabaseMigration();
  const valid = ids.filter((id) => Number.isInteger(id));
  if (valid.length === 0) return 0;
  const existing = await db.memories.where('id').anyOf(valid).primaryKeys();
  await db.memories.bulkDelete(existing);
  return existing.length;
}

export async function deleteMemoriesForProject(projectId: string): Promise<number> {
  await ensureMemoryDatabaseMigration();
  const trimmedProjectId = projectId.trim();
  if (!trimmedProjectId) throw new Error('Project id is required.');
  return db.memories.where('projectId').equals(trimmedProjectId).delete();
}

export async function touchMemories(ids: number[]): Promise<void> {
  await ensureMemoryDatabaseMigration();
  const now = Date.now();
  await db.memories
    .where('id')
    .anyOf(ids)
    .modify((m) => {
      m.accessCount++;
      m.lastAccessedAt = now;
    });
}

export async function replaceAllMemories(memories: Omit<Memory, 'id'>[]): Promise<void> {
  await ensureMemoryDatabaseMigration();
  await db.transaction('rw', db.memories, async () => {
    await db.memories.clear();
    await db.memories.bulkAdd(memories.map((memory) => ({
      ...memory,
      ...normalizeMemoryScope(memory),
    })) as Memory[]);
  });
}

const STALE_THRESHOLD_DAYS = 90;
const MIN_ACCESS_FOR_RETENTION = 3;

export async function archiveStaleMemories(): Promise<number> {
  await ensureMemoryDatabaseMigration();
  const threshold = Date.now() - STALE_THRESHOLD_DAYS * 86_400_000;
  const stale = await db.memories
    .where('lastAccessedAt')
    .below(threshold)
    .filter((m) => !m.pinned && m.accessCount < MIN_ACCESS_FOR_RETENTION)
    .toArray();

  if (stale.length === 0) return 0;

  const ids = stale.map((m) => m.id).filter((id): id is number => id != null);
  await db.memories.bulkDelete(ids);
  return ids.length;
}

export { db };

function createLegacyMemoryDatabase(): Dexie & { memories: EntityTable<Memory, 'id'> } {
  const legacyDb = new Dexie(DEPRECATED_MEMORY_DATABASE_NAME) as Dexie & {
    memories: EntityTable<Memory, 'id'>;
  };
  legacyDb.version(1).stores({
    memories: '++id, type, name, pinned, createdAt, updatedAt, lastAccessedAt',
  });
  legacyDb.version(2).stores({
    memories: '++id, type, name, pinned, createdAt, updatedAt, lastAccessedAt, syncId',
  });
  legacyDb.version(3).stores({
    memories: '++id, type, name, pinned, createdAt, updatedAt, lastAccessedAt, syncId, scope, projectId',
  });
  return legacyDb;
}

async function migrateMemoryRecord(memory: Memory): Promise<void> {
  const normalized = normalizeMemory({
    ...memory,
    syncId: memory.syncId || crypto.randomUUID(),
  });
  const existingBySyncId = normalized.syncId
    ? await db.memories.where('syncId').equals(normalized.syncId).first()
    : undefined;
  if (existingBySyncId) return;

  if (normalized.id != null) {
    const existingById = await db.memories.get(normalized.id);
    if (existingById) {
      const { id: _legacyId, ...withoutId } = normalized;
      await db.memories.add(withoutId as Memory);
      return;
    }
  }
  await db.memories.put(normalized);
}

function normalizeMemory(memory: Memory): Memory {
  return {
    ...memory,
    ...normalizeMemoryScope(memory),
  };
}

function normalizeMemoryScope(memory: Pick<NewMemory, 'scope' | 'projectId'>): Pick<Memory, 'scope' | 'projectId'> {
  if (memory.scope === 'project') {
    const projectId = typeof memory.projectId === 'string' ? memory.projectId.trim() : '';
    if (projectId) return { scope: 'project', projectId };
  }
  return { scope: 'global', projectId: undefined };
}
