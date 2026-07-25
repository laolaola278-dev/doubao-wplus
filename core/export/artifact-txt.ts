import { createExportFilename } from './artifact-filename';
import type {
  ConversationExport,
  ConversationExportArtifact,
  ExportedMessage,
  ExportedSession,
} from './types';

/**
 * 纯文本对话记录：便于快速阅读、粘贴到笔记或第三方工具，无格式噪音。
 */
export function createConversationExportTxtArtifact(exportData: ConversationExport): ConversationExportArtifact {
  return {
    format: 'txt',
    filename: createExportFilename(exportData, 'txt'),
    mimeType: 'text/plain;charset=utf-8',
    content: renderConversationExportTxt(exportData),
  };
}

export function renderConversationExportTxt(exportData: ConversationExport): string {
  const parts: string[] = [
    'Conversation Export',
    `Export ID: ${exportData.exportId}`,
    `Created: ${exportData.createdAt}`,
    `Mode: ${exportData.request.mode}`,
    `Sessions: ${exportData.stats.sessionCount}`,
    `Messages: ${exportData.stats.messageCount}`,
    `Attachments: ${exportData.stats.attachmentCount}`,
    '',
  ];

  if (exportData.failures.length > 0) {
    parts.push('Export Warnings:');
    for (const failure of exportData.failures) parts.push(`- ${failure.code}: ${failure.message}`);
    parts.push('');
  }

  for (const session of exportData.sessions) {
    parts.push(renderSession(session));
    parts.push('');
  }

  if (exportData.attachments.length > 0) {
    parts.push('Attachment Manifest:');
    for (const attachment of exportData.attachments) {
      const size = attachment.sizeBytes === null || attachment.sizeBytes === undefined ? '' : `, ${formatBytes(attachment.sizeBytes)}`;
      const type = attachment.mimeType ? `, type=${attachment.mimeType}` : '';
      parts.push(`- ${attachment.fileName ?? attachment.id} (id=${attachment.id}, status=${attachment.status}${size}${type})`);
    }
    parts.push('');
  }

  return `${parts.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

function renderSession(session: ExportedSession): string {
  const lines: string[] = [
    `# ${session.title || '未命名对话'}`,
    `Session ID: ${session.id}`,
    `Updated: ${session.updatedAt ?? 'unknown'}`,
    `Model: ${session.modelType ?? 'unknown'}`,
    '',
  ];

  if (session.failures.length > 0) {
    lines.push('Session Warnings:');
    for (const failure of session.failures) lines.push(`- ${failure.code}: ${failure.message}`);
    lines.push('');
  }

  for (const message of session.messages) {
    lines.push(...renderMessage(message));
    lines.push('');
  }

  return lines.join('\n');
}

function renderMessage(message: ExportedMessage): string[] {
  const role = message.role.toUpperCase();
  const content = message.content || '(No text content)';
  const lines = [`[${role}]`, content];
  if (message.attachmentRefs.length > 0) {
    lines.push(`Attachments: ${message.attachmentRefs.map((ref) => ref.id).join(', ')}`);
  }
  return lines;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
