// core/memory/portability.ts
// Memory 导入导出 — Memory Studio 用。
//
// 导出格式：JSON 数组（validateStoredMemory 兼容的完整字段，含可选 source），
// 与云同步的 memories 文件同构 —— 导出文件可直接被 IMPORT_MEMORY_DRAFTS 校验路径消化。
// 导入复用 core/sync/schema.ts 的 validateImportedMemory（fail-fast 校验）。

import type { Memory, NewMemory } from '../types';
import { validateImportedMemory } from '../sync/schema';

export interface MemoryImportResult {
  ok: boolean;
  memories: NewMemory[];
  /** 校验失败时的错误说明 */
  error?: string;
}

/** 序列化为导出 JSON（剥离本地自增 id；保留 syncId 供跨设备去重） */
export function exportMemoriesToJson(memories: Memory[]): string {
  const exported = memories.map(({ id: _id, ...rest }) => rest);
  return JSON.stringify(exported, null, 2);
}

/** 解析导入 JSON；整体 fail-fast（任何一条非法即拒绝，避免半量导入） */
export function parseMemoriesImport(content: string): MemoryImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { ok: false, memories: [], error: '不是有效 JSON' };
  }
  if (!Array.isArray(parsed)) {
    return { ok: false, memories: [], error: '格式错误：应为 memory 数组' };
  }
  try {
    const memories = parsed.map((item, index) => validateImportedMemory(item, `memories[${index}]`));
    return { ok: true, memories };
  } catch (error) {
    return {
      ok: false,
      memories: [],
      error: error instanceof Error ? error.message : '校验失败',
    };
  }
}

/** 触发浏览器下载（sidepanel 环境） */
export function downloadMemoriesExport(memories: Memory[], doc: Document = document): void {
  const blob = new Blob([exportMemoriesToJson(memories)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = doc.createElement('a');
  anchor.href = url;
  anchor.download = `dwplus-memories-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}
