import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  createDeepSeekConversationExportTransport,
  listDeepSeekSessions,
} from '../core/deepseek/conversation-export';
import {
  buildConversationExportArtifactsCancellable,
  buildConversationExportArtifacts,
  runConversationExport,
} from '../core/export/service';
import {
  ConversationExportValidationError,
  normalizeConversationExportRequest,
  validateConversationExport,
} from '../core/export/schema';
import {
  CONVERSATION_EXPORT_SCHEMA_VERSION,
  DEPRECATED_CONVERSATION_EXPORT_SCHEMA_VERSION,
} from '../core/export/types';
import { normalizeDeepSeekHistory } from '../core/export/normalize';

const fixtureDir = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures/deepseek-export');

describe('conversation export request schema', () => {
  it('defaults to sanitized HTML with attachment metadata', () => {
    expect(normalizeConversationExportRequest({})).toMatchObject({
      mode: 'sanitized',
      formats: ['html'],
      includeAttachmentMetadata: true,
      includeFileBodies: false,
      pageSize: 50,
    });
  });

  it('rejects file body export until official download behavior is verified', () => {
    expect(() => normalizeConversationExportRequest({ includeFileBodies: true }))
      .toThrow(ConversationExportValidationError);
  });

  it('accepts the deprecated conversation export schema for reads', () => {
    const legacy = {
      schemaVersion: DEPRECATED_CONVERSATION_EXPORT_SCHEMA_VERSION,
      exportId: 'legacy-export',
      createdAt: '2026-08-02T00:00:00.000Z',
      source: { provider: 'deepseek-official-web', baseUrl: 'https://chat.deepseek.com', endpointVerification: 'static-bundle-and-browser-session', fileBodies: 'unsupported-unverified' },
      generatedBy: { name: 'WPlus', version: '0.0.0-test' },
      request: { mode: 'sanitized', formats: ['json'], includeAttachmentMetadata: true, includeFileBodies: false },
      stats: { sessionCount: 0, messageCount: 0, attachmentCount: 0, failedSessionCount: 0, startedAt: '2026-08-02T00:00:00.000Z', completedAt: '2026-08-02T00:00:00.000Z' },
      sessions: [],
      attachments: [],
      failures: [],
    };
    expect(validateConversationExport(legacy as Parameters<typeof validateConversationExport>[0])).toBe(legacy);
  });

  it('fails closed for invalid explicit modes and formats', () => {
    expect(() => normalizeConversationExportRequest({ mode: 'readable' }))
      .toThrow(ConversationExportValidationError);
    expect(() => normalizeConversationExportRequest({ formats: ['docx'] }))
      .toThrow(ConversationExportValidationError);
    expect(() => normalizeConversationExportRequest({ formats: ['xml'] }))
      .toThrow(ConversationExportValidationError);
  });

  it('normalizes explicit session ids for current-conversation export', () => {
    expect(normalizeConversationExportRequest({ sessionIds: [' session-alpha ', 'session-alpha'] }))
      .toMatchObject({ sessionIds: ['session-alpha'] });
    expect(() => normalizeConversationExportRequest({ sessionIds: [''] }))
      .toThrow(ConversationExportValidationError);
  });
});

describe('DeepSeek conversation export adapter and service', () => {
  it('reads message text from DeepSeek history fragments and nested content objects', () => {
    const session = normalizeDeepSeekHistory({
      id: 'session-fragments',
      title: 'Nested content',
      pinned: false,
      titleType: null,
      modelType: null,
      createdAt: null,
      updatedAt: null,
    }, {
      data: {
        biz_data: {
          chat_messages: [
            {
              id: 1,
              message_role: 'user',
              created_at: 1760000001,
              fragments: [
                { type: 'text', content: '早' },
              ],
            },
            {
              id: 2,
              parent_id: 1,
              message_role: 'assistant',
              created_at: 1760000002,
              message_content: {
                parts: [
                  { content_type: 'text', content: '早上好！' },
                  { content_type: 'text', content: '新的一天开始了。' },
                ],
              },
            },
          ],
        },
      },
    }, { includeRaw: false });

    expect(session.messages[0].content).toBe('早');
    expect(session.messages[1].content).toContain('早上好！');
    expect(session.messages[1].content).toContain('新的一天开始了。');
  });

  it('paginates sessions and exports sanitized artifacts with attachment metadata', async () => {
    const fetchImpl = createFixtureFetch();
    const transport = createDeepSeekConversationExportTransport({
      baseUrl: 'https://chat.deepseek.com',
      clientHeaders: { Authorization: 'Bearer synthetic' },
      fetchImpl,
    });

    const exportData = await runConversationExport({
      exportId: 'export-test',
      extensionVersion: '0.0.0-test',
      baseUrl: 'https://chat.deepseek.com',
      request: {
        mode: 'sanitized',
        formats: ['markdown', 'html', 'pdf', 'image_manifest'],
        includeAttachmentMetadata: true,
        includeFileBodies: false,
        pageSize: 1,
      },
      transport,
      now: createClock([
        '2026-06-06T00:00:00.000Z',
        '2026-06-06T00:00:01.000Z',
      ]),
    });

    expect(exportData.schemaVersion).toBe(CONVERSATION_EXPORT_SCHEMA_VERSION);
    expect(exportData.sessions).toHaveLength(1);
    expect(exportData.failures).toHaveLength(1);
    expect(exportData.failures[0].sessionId).toBe('session-beta');
    expect(exportData.attachments[0]).toMatchObject({
      id: 'file-1',
      fileName: 'memo.txt',
      sizeBytes: 2048,
      status: 'metadata_available',
      sourceMessageIds: ['1001'],
    });
    expect(exportData.attachments[0].signedPath).toBeUndefined();
    expect(exportData.sessions[0].raw).toBeUndefined();
    expect(exportData.sessions[0].messages[0].content).toBe('Please summarize the attached memo.');
    expect(exportData.sessions[0].messages[1].content).not.toContain('memory_save');
    expect(exportData.sessions[0].messages[1].id).toBe('session-alpha:message:1');
    expect(exportData.sessions[0].failures[0].code).toBe('message_id_missing');

    const artifacts = buildConversationExportArtifacts(exportData);
    expect(artifacts.map((artifact) => artifact.format)).toEqual(['markdown', 'html', 'pdf', 'image_manifest']);
    expect(artifacts.find((artifact) => artifact.format === 'markdown')?.content).toContain('Synthetic Alpha');
    expect(artifacts.find((artifact) => artifact.format === 'html')?.content).toContain('<!doctype html>');
    expect(artifacts.find((artifact) => artifact.format === 'pdf')).toMatchObject({
      filename: 'deepseek-conversations-sanitized-2026-06-06T00-00-01.pdf',
      mimeType: 'application/pdf',
    });
    expect(artifacts.find((artifact) => artifact.format === 'pdf')?.content.startsWith('%PDF-1.4')).toBe(true);
    expect(artifacts.find((artifact) => artifact.format === 'image_manifest')).toMatchObject({
      filename: 'deepseek-image-manifest-2026-06-06.html',
      mimeType: 'text/html;charset=utf-8',
    });
    expect(artifacts.find((artifact) => artifact.format === 'image_manifest')?.content).toContain('0 image attachments');
  });

  it('exports JSON and TXT artifacts alongside the existing formats', async () => {
    const transport = createDeepSeekConversationExportTransport({
      baseUrl: 'https://chat.deepseek.com',
      clientHeaders: { Authorization: 'Bearer synthetic' },
      fetchImpl: createFixtureFetch(),
    });

    const exportData = await runConversationExport({
      exportId: 'export-json-txt',
      extensionVersion: '0.0.0-test',
      baseUrl: 'https://chat.deepseek.com',
      request: {
        mode: 'sanitized',
        formats: ['json', 'txt', 'markdown'],
        includeAttachmentMetadata: true,
        includeFileBodies: false,
        pageSize: 1,
      },
      transport,
    });

    const artifacts = buildConversationExportArtifacts(exportData);
    expect(artifacts.map((artifact) => artifact.format).sort()).toEqual(['json', 'markdown', 'txt']);

    const jsonArtifact = artifacts.find((artifact) => artifact.format === 'json');
    expect(jsonArtifact?.mimeType).toBe('application/json;charset=utf-8');
    expect(jsonArtifact?.filename.endsWith('.json')).toBe(true);
    const parsed = JSON.parse(jsonArtifact!.content);
    expect(parsed.exportId).toBe('export-json-txt');
    expect(parsed.sessions).toHaveLength(1);

    const txtArtifact = artifacts.find((artifact) => artifact.format === 'txt');
    expect(txtArtifact?.mimeType).toBe('text/plain;charset=utf-8');
    expect(txtArtifact?.filename.endsWith('.txt')).toBe(true);
    expect(txtArtifact?.content).toContain('Conversation Export');
    expect(txtArtifact?.content).toContain('[USER]');
    expect(txtArtifact?.content).toContain('[ASSISTANT]');
    expect(txtArtifact?.content).toContain('Please summarize the attached memo.');
  });

  it('derives the official pagination cursor from the last session', async () => {
    const fetchImpl = createFixtureFetch();
    const sessions = await listDeepSeekSessions({
      baseUrl: 'https://chat.deepseek.com',
      clientHeaders: { Authorization: 'Bearer synthetic' },
      fetchImpl,
      pageSize: 1,
      includeRaw: true,
    });

    expect(sessions.map((session) => session.id)).toEqual(['session-alpha', 'session-beta']);
    expect(fetchImpl.calls.some((url) => url.includes('lte_cursor.updated_at=1760000000'))).toBe(true);
    expect(fetchImpl.calls.some((url) => url.includes('lte_cursor.pinned=false'))).toBe(true);
  });

  it('keeps official raw payloads only in raw mode', async () => {
    const transport = createDeepSeekConversationExportTransport({
      baseUrl: 'https://chat.deepseek.com',
      clientHeaders: { Authorization: 'Bearer synthetic' },
      fetchImpl: createFixtureFetch(),
    });

    const exportData = await runConversationExport({
      exportId: 'export-raw-test',
      extensionVersion: '0.0.0-test',
      baseUrl: 'https://chat.deepseek.com',
      request: {
        mode: 'raw',
        formats: ['html'],
        includeAttachmentMetadata: true,
        includeFileBodies: false,
        pageSize: 1,
        sessionLimit: 1,
      },
      transport,
    });

    expect(exportData.sessions[0].raw).toBeTruthy();
    expect(exportData.sessions[0].messages[0].content).toContain('doubao-wplus-visible-user-prompt');
    expect(exportData.sessions[0].messages[1].content).toContain('memory_save');
    expect(exportData.attachments[0].signedPath).toBe('https://example.invalid/signed/memo.txt');
    expect(exportData.attachments[0].raw).toBeTruthy();
  });

  it('exports explicit sessions without reading the session list', async () => {
    let listedSessions = false;
    const exportData = await runConversationExport({
      exportId: 'export-current-session-test',
      extensionVersion: '0.0.0-test',
      baseUrl: 'https://chat.deepseek.com',
      request: {
        mode: 'sanitized',
        formats: ['markdown'],
        includeAttachmentMetadata: false,
        includeFileBodies: false,
        sessionIds: ['session-alpha'],
      },
      transport: {
        async listSessions() {
          listedSessions = true;
          return [];
        },
        async fetchHistory({ session }) {
          expect(session.id).toBe('session-alpha');
          return readFixture('history-alpha.json');
        },
        async fetchFiles() {
          throw new Error('fetchFiles should not run when attachment metadata is disabled.');
        },
      },
    });

    expect(listedSessions).toBe(false);
    expect(exportData.sessions).toHaveLength(1);
    expect(exportData.sessions[0].id).toBe('session-alpha');
    expect(exportData.sessions[0].title).toBe('Synthetic Alpha');
  });

  it('does not return artifacts after formatting is cancelled', async () => {
    const transport = createDeepSeekConversationExportTransport({
      baseUrl: 'https://chat.deepseek.com',
      clientHeaders: { Authorization: 'Bearer synthetic' },
      fetchImpl: createFixtureFetch(),
    });
    const exportData = await runConversationExport({
      exportId: 'export-cancel-test',
      extensionVersion: '0.0.0-test',
      baseUrl: 'https://chat.deepseek.com',
      request: {
        mode: 'sanitized',
        formats: ['html'],
        includeAttachmentMetadata: false,
        includeFileBodies: false,
        pageSize: 1,
        sessionLimit: 1,
      },
      transport,
    });

    const controller = new AbortController();
    controller.abort();
    await expect(buildConversationExportArtifactsCancellable(exportData, controller.signal))
      .rejects.toThrow('Conversation export was cancelled.');
  });
});

function createFixtureFetch() {
  const calls: string[] = [];
  const fetchImpl = (async (url: RequestInfo | URL) => {
    const href = String(url);
    calls.push(href);
    const parsed = new URL(href);

    if (parsed.pathname === '/api/v0/chat_session/fetch_page') {
      return jsonResponse(parsed.searchParams.has('lte_cursor.updated_at')
        ? readFixture('session-page-2.json')
        : readFixture('session-page-1.json'));
    }

    if (parsed.pathname === '/api/v0/chat/history_messages') {
      const sessionId = parsed.searchParams.get('chat_session_id');
      if (sessionId === 'session-alpha') return jsonResponse(readFixture('history-alpha.json'));
      return jsonResponse({ data: { biz_code: 50001, biz_data: {} } }, 500);
    }

    if (parsed.pathname === '/api/v0/file/fetch_files') {
      return jsonResponse(readFixture('file-metadata.json'));
    }

    return jsonResponse({ data: { biz_code: 404, biz_data: {} } }, 404);
  }) as typeof fetch & { calls: string[] };
  fetchImpl.calls = calls;
  return fetchImpl;
}

function readFixture(name: string) {
  return JSON.parse(readFileSync(resolve(fixtureDir, name), 'utf8'));
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function createClock(values: string[]) {
  let index = 0;
  return () => new Date(values[Math.min(index++, values.length - 1)]);
}
