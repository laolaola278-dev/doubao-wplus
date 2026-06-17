import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import {
  uploadAttachedFile,
  UPLOAD_ATTACHED_FILE_BYPASS_HEADER,
  UPLOAD_ATTACHED_FILE_DEFAULT_FIELD,
  UPLOAD_ATTACHED_FILE_DEFAULT_PATH,
  UPLOAD_ATTACHED_FILE_MAX_BYTES,
  __test__,
} from '../core/shell/attached-file-uploader';

interface FakeFile {
  name: string;
  sizeBytes: number;
  mimeType: string | null;
  bytes: Uint8Array;
}

function makeFakeFile(name: string, content: string, mimeType: string | null = null): FakeFile {
  return {
    name,
    sizeBytes: new TextEncoder().encode(content).byteLength,
    mimeType,
    bytes: new TextEncoder().encode(content),
  };
}

function makeReadFileMock(files: Map<string, FakeFile>) {
  return async (path: string): Promise<FakeFile> => {
    const file = files.get(path);
    if (!file) throw new Error(`ENOENT: ${path}`);
    return file;
  };
}

interface RecordedUpload {
  contentType: string | null;
  bypass: string | null;
  raw: Buffer;
  fields: Array<{ name: string; filename: string; contentType: string | null; content: string }>;
}

function parseMultipart(body: Buffer, boundary: string): RecordedUpload {
  const text = body.toString('utf8');
  const sep = `--${boundary}`;
  const parts = text.split(sep).slice(1, -1); // drop preamble and trailer
  const fields: RecordedUpload['fields'] = [];
  for (const part of parts) {
    const trimmed = part.replace(/^\r\n/, '').replace(/\r\n$/, '');
    const headerEnd = trimmed.indexOf('\r\n\r\n');
    if (headerEnd < 0) continue;
    const headerBlock = trimmed.slice(0, headerEnd);
    const content = trimmed.slice(headerEnd + 4);
    const disposition = /Content-Disposition: form-data; name="([^"]+)"(?:; filename="([^"]+)")?/.exec(headerBlock);
    const type = /Content-Type: ([^\r\n]+)/.exec(headerBlock);
    if (!disposition) continue;
    fields.push({
      name: disposition[1] ?? '',
      filename: disposition[2] ?? '',
      contentType: type ? (type[1] ?? null) : null,
      content,
    });
  }
  return {
    contentType: null,
    bypass: null,
    raw: body,
    fields,
  };
}

function firstHeader(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function startMockServer(handler: (rec: RecordedUpload) => { status: number; body: unknown }): Promise<{ server: Server; url: string }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const body = Buffer.concat(chunks);
        const contentType = firstHeader(req.headers['content-type']);
        const bypass = firstHeader(req.headers['x-dpp-bypass-hook']);
        const boundaryMatch = /boundary=([^;]+)/.exec(contentType ?? '');
        const boundary = boundaryMatch ? boundaryMatch[1]?.trim().replace(/^"|"$/g, '') ?? '' : '';
        const rec: RecordedUpload = parseMultipart(body, boundary);
        rec.contentType = contentType;
        rec.bypass = bypass;
        const response = handler(rec);
        res.statusCode = response.status;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(response.body));
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

describe('upload_attached_file (extension side)', () => {
  describe('__test__ helpers', () => {
    it('infers mime types from common extensions', () => {
      expect(__test__.inferMimeTypeFromPath('/tmp/a.docx')).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      expect(__test__.inferMimeTypeFromPath('C:\\a.pdf')).toBe('application/pdf');
      expect(__test__.inferMimeTypeFromPath('/a/b/c.txt')).toBe('text/plain');
      expect(__test__.inferMimeTypeFromPath('/a/b/c.unknown')).toBeNull();
    });

    it('builds a multipart body with the requested boundary and file bytes', () => {
      const fileBytes = new TextEncoder().encode('hello world');
      const body = __test__.buildMultipartBody({
        field: 'file',
        fileName: 'a.docx',
        mimeType: 'application/octet-stream',
        bytes: fileBytes,
        boundary: 'XYZ',
      });
      const text = new TextDecoder().decode(body);
      expect(text).toContain('--XYZ');
      expect(text).toContain('Content-Disposition: form-data; name="file"; filename="a.docx"');
      expect(text).toContain('Content-Type: application/octet-stream');
      expect(text).toContain('hello world');
      expect(text.endsWith('--XYZ--\r\n')).toBe(true);
    });

    it('parses ref_file_id from {biz_data:{id}} and {data:{id}} and {id} responses', () => {
      expect(__test__.readRefFileIdFromResponse({ biz_data: { id: 'file_biz' } })).toBe('file_biz');
      expect(__test__.readRefFileIdFromResponse({ data: { id: 'file_data' } })).toBe('file_data');
      expect(__test__.readRefFileIdFromResponse({ id: 'file_top' })).toBe('file_top');
      expect(__test__.readRefFileIdFromResponse({ biz_data: { files: [{ id: 'file_in_list' }] } })).toBe('file_in_list');
      expect(__test__.readRefFileIdFromResponse({ biz_data: {} })).toBeNull();
      expect(__test__.readRefFileIdFromResponse(null)).toBeNull();
    });
  });

  describe('uploadAttachedFile validation', () => {
    it('rejects empty local_path', async () => {
      const result = await uploadAttachedFile({ localPath: '' });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe('dpp_invalid_local_path');
    });

    it('rejects files exceeding the 64 MB safety cap', async () => {
      const result = await uploadAttachedFile({
        localPath: '/tmp/huge.bin',
        readFileImpl: async () => ({
          name: 'huge.bin',
          sizeBytes: UPLOAD_ATTACHED_FILE_MAX_BYTES + 1,
          mimeType: null,
          bytes: new Uint8Array(0),
        }),
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe('dpp_file_too_large');
    });

    it('rejects empty files', async () => {
      const result = await uploadAttachedFile({
        localPath: '/tmp/empty.bin',
        readFileImpl: async () => ({ name: 'empty.bin', sizeBytes: 0, mimeType: null, bytes: new Uint8Array(0) }),
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe('dpp_file_empty');
    });

    it('surfaces read errors', async () => {
      const result = await uploadAttachedFile({
        localPath: '/tmp/missing.bin',
        readFileImpl: async () => { throw new Error('ENOENT'); },
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe('dpp_file_read_failed');
      expect(result.message).toContain('ENOENT');
    });
  });

  describe('end-to-end against a mock DeepSeek upload server', () => {
    let server: Server;
    let baseUrl: string;

    beforeEach(async () => {
      const mock = await startMockServer((rec) => {
        // 校验 multipart 字段
        expect(rec.contentType).toContain(`boundary=`);
        expect(rec.bypass).toBe('1');
        const fileField = rec.fields.find((f) => f.name === UPLOAD_ATTACHED_FILE_DEFAULT_FIELD);
        expect(fileField).toBeDefined();
        return {
          status: 200,
          body: { biz_data: { id: 'file_mock_123' } },
        };
      });
      server = mock.server;
      baseUrl = mock.url;
    });

    afterEach(() => {
      server.close();
    });

    it('uploads a docx, sends multipart body, attaches bypass header, and parses ref_file_id', async () => {
      const files = new Map<string, FakeFile>();
      files.set('/tmp/report.docx', makeFakeFile('report.docx', 'fake docx content'));
      const result = await uploadAttachedFile({
        localPath: '/tmp/report.docx',
        readFileImpl: makeReadFileMock(files),
        baseUrl,
        uploadPath: UPLOAD_ATTACHED_FILE_DEFAULT_PATH,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.refFileId).toBe('file_mock_123');
      expect(result.fileName).toBe('report.docx');
      expect(result.sizeBytes).toBe('fake docx content'.length);
      expect(result.mimeType).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    });

    it('uses an override file_name and mime_type when supplied', async () => {
      const files = new Map<string, FakeFile>();
      files.set('/tmp/whatever', makeFakeFile('whatever', 'x'));
      let receivedFilename = '';
      let receivedType: string | null = null;
      // 重启服务器，捕获细节
      server.close();
      const mock = await startMockServer((rec) => {
        const f = rec.fields.find((f) => f.name === 'file');
        if (f) {
          receivedFilename = f.filename;
          receivedType = f.contentType;
        }
        return { status: 200, body: { biz_data: { id: 'file_override' } } };
      });
      server = mock.server;
      baseUrl = mock.url;
      const result = await uploadAttachedFile({
        localPath: '/tmp/whatever',
        fileName: '已重命名.pdf',
        mimeType: 'application/x-custom',
        readFileImpl: makeReadFileMock(files),
        baseUrl,
      });
      expect(result.ok).toBe(true);
      expect(receivedFilename).toBe('%E5%B7%B2%E9%87%8D%E5%91%BD%E5%90%8D.pdf');
      expect(receivedType).toBe('application/x-custom');
      mock.server.close();
    });

    it('handles 5xx with retryable=true', async () => {
      server.close();
      const mock = await startMockServer(() => ({ status: 502, body: { msg: 'bad gateway' } }));
      server = mock.server;
      baseUrl = mock.url;
      const files = new Map<string, FakeFile>();
      files.set('/tmp/r.docx', makeFakeFile('r.docx', 'r'));
      const result = await uploadAttachedFile({
        localPath: '/tmp/r.docx',
        readFileImpl: makeReadFileMock(files),
        baseUrl,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe('dpp_upload_http_error');
      expect(result.retryable).toBe(true);
      mock.server.close();
    });

    it('handles 4xx with retryable=false', async () => {
      server.close();
      const mock = await startMockServer(() => ({ status: 401, body: { msg: 'unauth' } }));
      server = mock.server;
      baseUrl = mock.url;
      const files = new Map<string, FakeFile>();
      files.set('/tmp/r.docx', makeFakeFile('r.docx', 'r'));
      const result = await uploadAttachedFile({
        localPath: '/tmp/r.docx',
        readFileImpl: makeReadFileMock(files),
        baseUrl,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe('dpp_upload_http_error');
      expect(result.retryable).toBe(false);
      mock.server.close();
    });

    it('rejects when response is missing a ref_file_id', async () => {
      server.close();
      const mock = await startMockServer(() => ({ status: 200, body: { biz_data: { url: 'no id here' } } }));
      server = mock.server;
      baseUrl = mock.url;
      const files = new Map<string, FakeFile>();
      files.set('/tmp/r.docx', makeFakeFile('r.docx', 'r'));
      const result = await uploadAttachedFile({
        localPath: '/tmp/r.docx',
        readFileImpl: makeReadFileMock(files),
        baseUrl,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe('dpp_upload_no_ref_file_id');
      mock.server.close();
    });
  });

  it('exposes the correct default constants', () => {
    expect(UPLOAD_ATTACHED_FILE_DEFAULT_PATH).toBe('/api/v0/file/upload');
    expect(UPLOAD_ATTACHED_FILE_DEFAULT_FIELD).toBe('file');
    expect(UPLOAD_ATTACHED_FILE_MAX_BYTES).toBe(64 * 1024 * 1024);
    expect(UPLOAD_ATTACHED_FILE_BYPASS_HEADER).toBe('X-DPP-Bypass-Hook');
  });
});
