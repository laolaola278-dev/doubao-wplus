import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildTargetFilename,
  downloadAttachedFile,
  DOWNLOAD_ATTACHED_FILE_BYPASS_HEADER,
  DOWNLOAD_ATTACHED_FILE_TARGET_DIR,
  type ChromeDownloadsApi,
  type ChromeDownloadItem,
} from '../core/shell/attached-file-downloader';

interface MockResponseInit {
  ok?: boolean;
  status?: number;
  body?: string | null;
  contentType?: string;
  contentLength?: number;
  json?: unknown;
}

function makeResponse(init: MockResponseInit = {}): Response {
  const status = init.status ?? 200;
  const headers = new Headers();
  if (init.contentType) headers.set('content-type', init.contentType);
  if (init.contentLength != null) headers.set('content-length', String(init.contentLength));
  const body = init.body ?? '';
  return new Response(body, { status, headers });
}

function makeJsonResponse(json: unknown, status = 200): Response {
  return new Response(JSON.stringify(json), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function makeBlobResponse(body: string, contentType: string, contentLength?: number): Response {
  const headers = new Headers();
  headers.set('content-type', contentType);
  if (contentLength != null) headers.set('content-length', String(contentLength));
  return new Response(body, { status: 200, headers });
}

interface FetchCall {
  url: string;
  init: RequestInit | undefined;
}

function makeFetchMock(responses: Array<(url: string) => Response | null>): {
  fetch: typeof fetch;
  calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
  const fetchMock: typeof fetch = vi.fn(async (input, init) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    calls.push({ url, init });
    for (const responder of responses) {
      const response = responder(url);
      if (response) return response;
    }
    throw new Error(`No mock response configured for ${url}`);
  }) as unknown as typeof fetch;
  return { fetch: fetchMock, calls };
}

function makeDownloadsApi(targetFilename: string, localPath: string): {
  api: ChromeDownloadsApi;
  calls: Array<{ method: 'download' | 'search'; payload: unknown }>;
} {
  const calls: Array<{ method: 'download' | 'search'; payload: unknown }> = [];
  const api: ChromeDownloadsApi = {
    async download(options) {
      calls.push({ method: 'download', payload: options });
      return 42;
    },
    async search(query) {
      calls.push({ method: 'search', payload: query });
      const item: ChromeDownloadItem = { id: 42, filename: localPath };
      if (query.id === 42) return [item];
      return [];
    },
  };
  // silence the unused warning while still verifying the type
  void targetFilename;
  return { api, calls };
}

describe('downloadAttachedFile (B-08)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('builds the target filename under doubao-wplus/ and sanitizes unsafe characters', () => {
    expect(buildTargetFilename({
      id: 'file_x',
      fileName: 'Q4: report?.docx',
      mimeType: null,
      sizeBytes: null,
      signedPath: 'https://x/y',
    })).toBe(`${DOWNLOAD_ATTACHED_FILE_TARGET_DIR}/Q4_ report_.docx`);

    expect(buildTargetFilename({
      id: 'file_x',
      fileName: 'safe-name.xlsx',
      mimeType: null,
      sizeBytes: null,
      signedPath: 'https://x/y',
    })).toBe(`${DOWNLOAD_ATTACHED_FILE_TARGET_DIR}/safe-name.xlsx`);

    // `..` 路径穿越被完全打散；每个 `/` 和 `..` 都被替换为 `_`，
    // 实际输出就是 6 个下划线 + `etc_passwd`。
    expect(buildTargetFilename({
      id: 'file_x',
      fileName: '../../../etc/passwd',
      mimeType: null,
      sizeBytes: null,
      signedPath: 'https://x/y',
    })).toBe(`${DOWNLOAD_ATTACHED_FILE_TARGET_DIR}/______etc_passwd`);
  });

  it('downloads via metadata + signed URL and returns the local path', async () => {
    const metadataUrl = 'https://chat.deepseek.com/api/v0/file/fetch_files?file_ids=file_123';
    const downloadUrl = 'https://files.deepseek.com/signed/file_123.docx';
    const { fetch: fetchMock, calls } = makeFetchMock([
      (url) => url === metadataUrl ? makeJsonResponse({
        biz_data: {
          files: [{
            id: 'file_123',
            file_name: 'report.docx',
            mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            file_size: 12,
            signed_path: downloadUrl,
          }],
        },
      }) : null,
      (url) => url === downloadUrl ? makeBlobResponse('hello world', 'application/octet-stream', 11) : null,
    ]);
    const { api: downloadApi, calls: downloadCalls } = makeDownloadsApi(
      'doubao-wplus/report.docx',
      'C:\\Users\\me\\Downloads\\doubao-wplus\\report.docx',
    );

    const result = await downloadAttachedFile({ fileId: 'file_123', fetchImpl: fetchMock, downloadApi });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.localPath).toBe('C:\\Users\\me\\Downloads\\doubao-wplus\\report.docx');
    expect(result.fileName).toBe('report.docx');
    expect(result.sizeBytes).toBe(11);
    expect(result.mimeType).toContain('openxmlformats');

    expect(calls).toHaveLength(2);
    expect(calls[0].url).toBe(metadataUrl);
    expect(calls[0].init?.credentials).toBe('include');
    expect((calls[0].init?.headers as Record<string, string> | undefined)?.[DOWNLOAD_ATTACHED_FILE_BYPASS_HEADER]).toBe('1');
    expect(calls[1].url).toBe(downloadUrl);

    expect(downloadCalls[0].method).toBe('download');
    expect((downloadCalls[0].payload as { filename: string }).filename).toBe('doubao-wplus/report.docx');
    expect(downloadCalls[1].method).toBe('search');
  });

  it('falls back to the first file when no exact id match exists', async () => {
    const metadataUrl = 'https://chat.deepseek.com/api/v0/file/fetch_files?file_ids=file_123';
    const downloadUrl = 'https://files.deepseek.com/signed/file_999.docx';
    const { fetch: fetchMock } = makeFetchMock([
      (url) => url === metadataUrl ? makeJsonResponse({
        data: {
          biz_data: {
            files: [{
              id: 'file_999',
              file_name: 'notes.txt',
              signed_path: downloadUrl,
            }],
          },
        },
      }) : null,
      (url) => url === downloadUrl ? makeBlobResponse('hi', 'text/plain', 2) : null,
    ]);
    const { api: downloadApi } = makeDownloadsApi('doubao-wplus/notes.txt', '/tmp/notes.txt');

    const result = await downloadAttachedFile({ fileId: 'file_123', fetchImpl: fetchMock, downloadApi });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fileName).toBe('notes.txt');
  });

  it('rejects empty file ids', async () => {
    const result = await downloadAttachedFile({ fileId: '', downloadApi: {} as ChromeDownloadsApi });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('dwplus_invalid_file_id');
  });

  it('reports missing metadata when fetch_files returns no matching entry', async () => {
    const metadataUrl = 'https://chat.deepseek.com/api/v0/file/fetch_files?file_ids=file_123';
    const { fetch: fetchMock } = makeFetchMock([
      (url) => url === metadataUrl ? makeJsonResponse({ data: { biz_data: { files: [] } } }) : null,
    ]);

    const result = await downloadAttachedFile({ fileId: 'file_123', fetchImpl: fetchMock, downloadApi: {} as ChromeDownloadsApi });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('dwplus_metadata_not_found');
  });

  it('reports HTTP failure on the metadata endpoint', async () => {
    const metadataUrl = 'https://chat.deepseek.com/api/v0/file/fetch_files?file_ids=file_500';
    const { fetch: fetchMock } = makeFetchMock([
      (url) => url === metadataUrl ? makeResponse({ status: 500 }) : null,
    ]);

    const result = await downloadAttachedFile({ fileId: 'file_500', fetchImpl: fetchMock, downloadApi: {} as ChromeDownloadsApi });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('dwplus_metadata_http_error');
    expect(result.retryable).toBe(true);
  });

  it('refuses files that exceed the safety cap', async () => {
    const metadataUrl = 'https://chat.deepseek.com/api/v0/file/fetch_files?file_ids=file_big';
    const downloadUrl = 'https://files.deepseek.com/signed/big.bin';
    const { fetch: fetchMock } = makeFetchMock([
      (url) => url === metadataUrl ? makeJsonResponse({
        biz_data: { files: [{ id: 'file_big', file_name: 'big.bin', signed_path: downloadUrl }] },
      }) : null,
      (url) => url === downloadUrl ? makeBlobResponse('00000000', 'application/octet-stream', 1024 * 1024 * 200) : null,
    ]);
    const result = await downloadAttachedFile({ fileId: 'file_big', fetchImpl: fetchMock, downloadApi: {} as ChromeDownloadsApi });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('dwplus_file_too_large');
  });

  it('uses bypassChromeDownloads when provided and skips the chrome API', async () => {
    const metadataUrl = 'https://chat.deepseek.com/api/v0/file/fetch_files?file_ids=file_bypass';
    const downloadUrl = 'https://files.deepseek.com/signed/bypass.bin';
    const { fetch: fetchMock } = makeFetchMock([
      (url) => url === metadataUrl ? makeJsonResponse({
        biz_data: { files: [{ id: 'file_bypass', file_name: 'b.bin', signed_path: downloadUrl }] },
      }) : null,
      (url) => url === downloadUrl ? makeBlobResponse('payload', 'application/octet-stream', 7) : null,
    ]);
    const result = await downloadAttachedFile({
      fileId: 'file_bypass',
      fetchImpl: fetchMock,
      bypassChromeDownloads: async (_blob, targetFilename) => {
        return { localPath: `/tmp/${targetFilename}` };
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.localPath).toBe('/tmp/doubao-wplus/b.bin');
  });

  it('returns an error when no downloader is available', async () => {
    const metadataUrl = 'https://chat.deepseek.com/api/v0/file/fetch_files?file_ids=file_nodl';
    const downloadUrl = 'https://files.deepseek.com/signed/nodl.bin';
    const { fetch: fetchMock } = makeFetchMock([
      (url) => url === metadataUrl ? makeJsonResponse({
        biz_data: { files: [{ id: 'file_nodl', file_name: 'n.bin', signed_path: downloadUrl }] },
      }) : null,
      (url) => url === downloadUrl ? makeBlobResponse('x', 'application/octet-stream', 1) : null,
    ]);
    const result = await downloadAttachedFile({ fileId: 'file_nodl', fetchImpl: fetchMock });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('dwplus_no_downloader');
  });
});
