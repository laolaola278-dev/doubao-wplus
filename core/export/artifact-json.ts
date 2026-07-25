import { createExportFilename } from './artifact-filename';
import type { ConversationExport, ConversationExportArtifact } from './types';

/**
 * 结构化 JSON 导出：完整保留导出数据结构，便于程序化消费（二次分析、迁移、备份）。
 */
export function createConversationExportJsonArtifact(exportData: ConversationExport): ConversationExportArtifact {
  return {
    format: 'json',
    filename: createExportFilename(exportData, 'json'),
    mimeType: 'application/json;charset=utf-8',
    content: JSON.stringify(exportData, null, 2),
  };
}
