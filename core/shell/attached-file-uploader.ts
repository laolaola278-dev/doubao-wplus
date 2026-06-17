/**
 * B-08 输出回路：`upload_attached_file` 工具的扩展侧实现。
 *
 * native host 跑在浏览器外面，没有 chat.deepseek.com session cookie，
 * 不能直接发文件。和 download_attached_file 对称，这里由扩展（content script
 * 或 background）来上传，绕开 native host transport。
 *
 * DeepSeek 网页上传文件的实际端点（路径 + 字段名）需要从线上抓包确认；
 * 此模块把端点拆成两个常量，错了改一行就行：
 *
 *   - `UPLOAD_PATH = '/api/v0/file/upload'`
 *   - `MULTIPART_FIELD = 'file'`
 *
 * 测试模式：`fetchImpl` 注入 mock，`readFileImpl` 注入 fs 读取，避开
 * 真实 `FileReader` / `fetch`。
 */

import { DOWNLOAD_ATTACHED_FILE_BYPASS_HEADER } from './attached-file-downloader';

export const UPLOAD_ATTACHED_FILE_TOOL_NAME = 'upload_attached_file';
export const UPLOAD_ATTACHED_FILE_DEFAULT_PATH = '/api/v0/file/upload';
export const UPLOAD_ATTACHED_FILE_DEFAULT_FIELD = 'file';
export const UPLOAD_ATTACHED_FILE_MAX_BYTES = 64 * 1024 * 1024;
export const UPLOAD_ATTACHED_FILE_BYPASS_HEADER = DOWNLOAD_ATTACHED_FILE_BYPASS_HEADER;

export interface UploadAttachedFileOptions {
  localPath: string;
  fileName?: string;
  mimeType?: string;
  // 注入 fetch，便于测试；默认用 globalThis.fetch
  fetchImpl?: typeof fetch;
  // 注入文件读取，便于测试；默认走 FileReader（浏览器环境）
  readFileImpl?: (path: string) => Promise<{ name: string; sizeBytes: number; mimeType: string | null; bytes: Uint8Array }>;
  // 默认 '/api/v0/file/upload'，可注入做 e2e mock
  uploadPath?: string;
  // 默认 'file'，multipart 字段名
  uploadField?: string;
  // 注入 baseUrl，便于 mock
  baseUrl?: string;
  signal?: AbortSignal;
  // 覆盖默认文件 mime 推断（path → mime）
  inferMimeType?: (path: string) => string | null;
}

export interface UploadAttachedFileResult {
  ok: true;
  refFileId: string;
  fileName: string;
  sizeBytes: number;
  mimeType: string | null;
  localPath: string;
}

export interface UploadAttachedFileFailure {
  ok: false;
  code: string;
  message: string;
  retryable: boolean;
  localPath: string;
}

export type UploadAttachedFileOutcome = UploadAttachedFileResult | UploadAttachedFileFailure;

export async function uploadAttachedFile(
  options: UploadAttachedFileOptions,
): Promise<UploadAttachedFileOutcome> {
  const localPath = options.localPath?.trim();
  if (!localPath) {
    return {
      ok: false,
      code: 'dpp_invalid_local_path',
      message: 'local_path is required',
      retryable: false,
      localPath: options.localPath ?? '',
    };
  }

  // 1) 读文件
  let file: { name: string; sizeBytes: number; mimeType: string | null; bytes: Uint8Array };
  try {
    file = options.readFileImpl
      ? await options.readFileImpl(localPath)
      : await defaultReadFile(localPath);
  } catch (error) {
    return {
      ok: false,
      code: 'dpp_file_read_failed',
      message: error instanceof Error ? error.message : `Cannot read local file: ${localPath}`,
      retryable: false,
      localPath,
    };
  }
  if (file.sizeBytes <= 0) {
    return { ok: false, code: 'dpp_file_empty', message: 'Local file is empty', retryable: false, localPath };
  }
  if (file.sizeBytes > UPLOAD_ATTACHED_FILE_MAX_BYTES) {
    return {
      ok: false,
      code: 'dpp_file_too_large',
      message: `Local file exceeds the ${UPLOAD_ATTACHED_FILE_MAX_BYTES}-byte safety cap`,
      retryable: false,
      localPath,
    };
  }
  const fileName = options.fileName?.trim() || file.name;
  const mimeType = options.mimeType?.trim()
    || file.mimeType
    || (options.inferMimeType ?? inferMimeTypeFromPath)(localPath);

  // 2) 构造 multipart/form-data
  const uploadField = options.uploadField ?? UPLOAD_ATTACHED_FILE_DEFAULT_FIELD;
  const boundary = `----DPPBoundary${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
  const body = buildMultipartBody({
    field: uploadField,
    fileName,
    mimeType,
    bytes: file.bytes,
    boundary,
  });

  // 3) 发送
  const baseUrl = options.baseUrl ?? '';
  const uploadPath = options.uploadPath ?? UPLOAD_ATTACHED_FILE_DEFAULT_PATH;
  const url = `${baseUrl}${uploadPath}`;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
        // 走扩展的 fetch 拦截器时，标记为扩展内部 API，避开 INJECTION header 校验
        [UPLOAD_ATTACHED_FILE_BYPASS_HEADER]: '1',
      },
      body,
      credentials: 'include',
      signal: options.signal,
    } as unknown as RequestInit);
  } catch (error) {
    return {
      ok: false,
      code: 'dpp_upload_fetch_failed',
      message: error instanceof Error ? error.message : `POST ${url} failed`,
      retryable: true,
      localPath,
    };
  }
  if (!response.ok) {
    return {
      ok: false,
      code: 'dpp_upload_http_error',
      message: `Upload endpoint returned HTTP ${response.status}`,
      retryable: response.status >= 500,
      localPath,
    };
  }

  // 4) 解析响应
  let json: unknown;
  try {
    json = await response.json();
  } catch (error) {
    return {
      ok: false,
      code: 'dpp_upload_parse_failed',
      message: error instanceof Error ? error.message : 'Upload response is not JSON',
      retryable: false,
      localPath,
    };
  }
  const refFileId = readRefFileIdFromResponse(json);
  if (!refFileId) {
    return {
      ok: false,
      code: 'dpp_upload_no_ref_file_id',
      message: 'Upload response did not contain a recognizable ref_file_id',
      retryable: false,
      localPath,
    };
  }
  return {
    ok: true,
    refFileId,
    fileName,
    sizeBytes: file.sizeBytes,
    mimeType,
    localPath,
  };
}

interface MultipartFile {
  field: string;
  fileName: string;
  mimeType: string | null;
  bytes: Uint8Array;
  boundary: string;
}

function buildMultipartBody(file: MultipartFile): Uint8Array {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  chunks.push(encoder.encode(`--${file.boundary}\r\n`));
  chunks.push(
    encoder.encode(
      `Content-Disposition: form-data; name="${file.field}"; filename="${encodeURIComponent(file.fileName)}"\r\n`,
    ),
  );
  if (file.mimeType) {
    chunks.push(encoder.encode(`Content-Type: ${file.mimeType}\r\n`));
  }
  chunks.push(encoder.encode('\r\n'));
  chunks.push(file.bytes);
  chunks.push(encoder.encode(`\r\n--${file.boundary}--\r\n`));
  // 总长度
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.length;
  }
  return merged;
}

function readRefFileIdFromResponse(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  // DeepSeek 的 response 通常是 { biz_data: { id: 'file_xxx' } } 或 { data: { ... } }
  const candidateContainers: unknown[] = [
    record.biz_data,
    (record as { data?: unknown }).data,
    record,
  ];
  for (const container of candidateContainers) {
    if (!container || typeof container !== 'object') continue;
    const obj = container as Record<string, unknown>;
    for (const key of ['id', 'file_id', 'ref_file_id', 'refFileId']) {
      const v = obj[key];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
    // files[0].id 也可能
    const files = (obj as { files?: unknown }).files;
    if (Array.isArray(files) && files[0] && typeof files[0] === 'object') {
      const f0 = files[0] as Record<string, unknown>;
      for (const key of ['id', 'file_id']) {
        const v = f0[key];
        if (typeof v === 'string' && v.trim()) return v.trim();
      }
    }
  }
  return null;
}

function inferMimeTypeFromPath(path: string): string | null {
  const ext = path.toLowerCase().split('.').pop() ?? '';
  switch (ext) {
    case 'docx': return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case 'doc':  return 'application/msword';
    case 'pdf':  return 'application/pdf';
    case 'txt':  return 'text/plain';
    case 'md':   return 'text/markdown';
    case 'json': return 'application/json';
    case 'csv':  return 'text/csv';
    case 'xlsx': return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    case 'xls':  return 'application/vnd.ms-excel';
    case 'pptx': return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    case 'png':  return 'image/png';
    case 'jpg':
    case 'jpeg': return 'image/jpeg';
    case 'gif':  return 'image/gif';
    case 'webp': return 'image/webp';
    case 'svg':  return 'image/svg+xml';
    case 'zip':  return 'application/zip';
    default:     return null;
  }
}

async function defaultReadFile(path: string): Promise<{
  name: string;
  sizeBytes: number;
  mimeType: string | null;
  bytes: Uint8Array;
}> {
  // 浏览器环境：扩展层（background / content script）必须用 platform services
  // 或 File System Access API 读取真实文件。这里只取 path 的 basename，bytes
  // 留给调用方注入 readFileImpl。
  const sep = path.includes('/') ? '/' : '\\';
  const parts = path.split(sep);
  const name = parts[parts.length - 1] || path;
  return {
    name,
    sizeBytes: 0,
    mimeType: inferMimeTypeFromPath(path),
    bytes: new Uint8Array(),
  };
}

export const __test__ = {
  buildMultipartBody,
  readRefFileIdFromResponse,
  inferMimeTypeFromPath,
};
