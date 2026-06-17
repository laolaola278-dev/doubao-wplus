// B-08: download_attached_file 实现。
//
// 背景：这个工具由扩展侧（content script / background）执行，不走 native host。
// 原因是 native host 跑在浏览器外部，没有用户的 chat.deepseek.com session cookie，
// 不能直接拉取 ref_file_id 对应的文件内容。所以我们在扩展里 fetch 文件，然后
// 通过 chrome.downloads 写一份到磁盘，模型拿到的 localPath 可以直接喂给
// `shell_exec officecli ...`。
//
// 协议：
//   1) GET https://chat.deepseek.com/api/v0/file/fetch_files?file_ids=<id>
//      拿到 biz_data.files[0] 的 {file_name, mime_type, file_size, signed_path, ...}
//   2) GET <signed_path> 拿 bytes (with credentials: include)
//   3) chrome.downloads.download({ url: blob:, filename: 'deepseek-pp/<file_name>',
//      saveAs: false, conflictAction: 'uniquify' })
//   4) chrome.downloads.search({ id }) 拿到最终本地路径
//
// 注入：fetchImpl、downloadApi、searchApi 都可注入，方便在 vitest 里 mock。

import { DEEPSEEK_API_URL } from '../constants';

export const DOWNLOAD_ATTACHED_FILE_TOOL_NAME = 'download_attached_file';
export const DOWNLOAD_ATTACHED_FILE_TARGET_DIR = 'deepseek-pp';
export const DOWNLOAD_ATTACHED_FILE_BYPASS_HEADER = 'X-DPP-Bypass-Hook';

export interface AttachedFileMetadata {
  id: string;
  fileName: string;
  mimeType: string | null;
  sizeBytes: number | null;
  signedPath: string;
}

export interface AttachedFileDownloadResult {
  ok: true;
  localPath: string;
  fileName: string;
  sizeBytes: number;
  mimeType: string | null;
  fileId: string;
  // chrome.downloads 分配的下载 ID；UI 可以用 chrome.downloads.show(id) 在文件管理器里定位文件
  // （仅 Windows / macOS 可用）。失败时为 null。
  downloadId: number | null;
  source: 'metadata' | 'fallback';
}

export interface AttachedFileDownloadFailure {
  ok: false;
  code: string;
  message: string;
  retryable: boolean;
  fileId: string;
}

export type AttachedFileDownloadOutcome =
  | AttachedFileDownloadResult
  | AttachedFileDownloadFailure;

export interface ChromeDownloadsApi {
  download(options: ChromeDownloadOptions): Promise<number>;
  search(query: ChromeDownloadQuery): Promise<ChromeDownloadItem[]>;
}

// chrome.downloads API 的子集：只声明我们实际用到的字段，避免在测试或 SSR 环境
// 里被全局 chrome 类型绑架。
export interface ChromeDownloadOptions {
  url: string;
  filename?: string;
  saveAs?: boolean;
  conflictAction?: 'uniquify' | 'overwrite' | 'prompt';
  method?: string;
  headers?: Array<{ name: string; value: string }>;
  body?: string;
}

export interface ChromeDownloadQuery {
  id?: number;
  query?: string[];
  startedAfter?: Date;
  startedBefore?: Date;
  endedAfter?: Date;
  endedBefore?: Date;
  totalBytesGreater?: number;
  totalBytesLess?: number;
  filenameRegex?: string;
  state?: 'in_progress' | 'interrupted' | 'complete';
  paused?: boolean;
  error?: number;
  bytesReceivedGreater?: number;
  bytesReceivedLess?: number;
  mime?: string;
  limit?: number;
  orderBy?: string[];
  danger?: 'allowed' | 'host' | 'extension' | 'safeBrowsing' | 'content';
}

export interface ChromeDownloadItem {
  id: number;
  filename: string;
  mime?: string;
}

export interface DownloadAttachedFileOptions {
  fileId: string;
  fetchImpl?: typeof fetch;
  downloadApi?: ChromeDownloadsApi;
  signal?: AbortSignal;
  // 给测试用：把最终的 downloadItem 直接传进来，跳过 chrome.downloads 调用
  bypassChromeDownloads?: (blob: Blob, targetFilename: string) => Promise<{ localPath: string; downloadId?: number | null }>;
  // 注入 blob URL 工厂，便于在 vitest 里避开真实 URL.createObjectURL。
  // 默认值是 globalThis.URL.createObjectURL / revokeObjectURL（浏览器环境）。
  createObjectUrl?: (blob: Blob) => string;
  revokeObjectUrl?: (url: string) => void;
}

const DEEPSEEK_FILE_METADATA_PATH = '/api/v0/file/fetch_files';
const MAX_FILE_BYTES = 64 * 1024 * 1024; // 64 MB cap for safety

function readString(...candidates: unknown[]): string | null {
  for (const candidate of candidates) {
    if (typeof candidate === 'string') {
      const trimmed = candidate.trim();
      if (trimmed) return trimmed;
    }
  }
  return null;
}

function readNumber(...candidates: unknown[]): number | null {
  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate >= 0) {
      return candidate;
    }
    if (typeof candidate === 'string' && candidate.trim()) {
      const parsed = Number(candidate);
      if (Number.isFinite(parsed) && parsed >= 0) return parsed;
    }
  }
  return null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeMetadata(raw: Record<string, unknown>, fileId: string): AttachedFileMetadata | null {
  const id = readString(raw.id, raw.file_id, raw.fileId) ?? fileId;
  const fileName = readString(raw.file_name, raw.fileName, raw.name) ?? `${fileId}.bin`;
  const mimeType = readString(raw.mime_type, raw.mimeType, raw.type);
  const sizeBytes = readNumber(raw.file_size, raw.fileSize, raw.size);
  const signedPath = readString(raw.signed_path, raw.signedPath, raw.url, raw.download_url);
  if (!signedPath) return null;
  return { id, fileName, mimeType, sizeBytes, signedPath };
}

function findMetadataInResponse(json: unknown, fileId: string): AttachedFileMetadata | null {
  if (!isPlainObject(json)) return null;
  const data = isPlainObject(json.data) ? json.data : null;
  // DeepSeek 通常包成 `{ data: { biz_data: { files: [...] } } }`，
  // 但 export transport 也见过顶层直接给 `{ biz_data: ... }` 的情况。
  const bizData = isPlainObject(data?.biz_data)
    ? data.biz_data
    : isPlainObject(json.biz_data) ? json.biz_data : null;
  const candidates: unknown[] = [];
  if (bizData && Array.isArray(bizData.files)) candidates.push(...bizData.files);
  if (Array.isArray(json.files)) candidates.push(...json.files);
  if (Array.isArray(data?.files)) candidates.push(...data.files);

  // 优先精确匹配 fileId，其次取第一个
  for (const raw of candidates) {
    if (!isPlainObject(raw)) continue;
    const candidateId = readString(raw.id, raw.file_id, raw.fileId);
    if (candidateId === fileId) {
      const normalized = normalizeMetadata(raw, fileId);
      if (normalized) return normalized;
    }
  }
  for (const raw of candidates) {
    if (!isPlainObject(raw)) continue;
    const normalized = normalizeMetadata(raw, fileId);
    if (normalized) return normalized;
  }
  return null;
}

function resolveSignedUrl(signedPath: string, baseUrl: string): string {
  if (/^https?:\/\//i.test(signedPath)) return signedPath;
  if (signedPath.startsWith('//')) return `https:${signedPath}`;
  if (signedPath.startsWith('/')) return new URL(signedPath, baseUrl).href;
  return new URL(signedPath, baseUrl).href;
}

function buildMetadataUrl(baseUrl: string, fileId: string): string {
  const url = new URL(DEEPSEEK_FILE_METADATA_PATH, baseUrl);
  url.searchParams.set('file_ids', fileId);
  return url.href;
}

function sanitizeFilename(name: string): string {
  // Windows 不允许 \ / : * ? " < > |；也避免 .. 路径穿越
  return name
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\.\.+/g, '_')
    .slice(0, 120) || 'attachment.bin';
}

export function buildTargetFilename(metadata: AttachedFileMetadata): string {
  return `${DOWNLOAD_ATTACHED_FILE_TARGET_DIR}/${sanitizeFilename(metadata.fileName)}`;
}

export async function downloadAttachedFile(
  options: DownloadAttachedFileOptions,
): Promise<AttachedFileDownloadOutcome> {
  const { fileId } = options;
  if (!fileId || typeof fileId !== 'string') {
    return {
      ok: false,
      code: 'dpp_invalid_file_id',
      message: 'file_id is required and must be a non-empty string.',
      retryable: false,
      fileId: String(fileId ?? ''),
    };
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = new URL(DEEPSEEK_API_URL).origin;

  // 1) 拉元数据
  let metadata: AttachedFileMetadata | null = null;
  try {
    const metadataResponse = await fetchImpl(buildMetadataUrl(baseUrl, fileId), {
      method: 'GET',
      credentials: 'include',
      signal: options.signal,
      headers: {
        accept: 'application/json',
        [DOWNLOAD_ATTACHED_FILE_BYPASS_HEADER]: '1',
      },
    });
    if (!metadataResponse.ok) {
      return {
        ok: false,
        code: 'dpp_metadata_http_error',
        message: `DeepSeek file metadata returned HTTP ${metadataResponse.status}.`,
        retryable: metadataResponse.status >= 500,
        fileId,
      };
    }
    const metadataJson = await metadataResponse.json().catch(() => null);
    metadata = findMetadataInResponse(metadataJson, fileId);
  } catch (err) {
    return {
      ok: false,
      code: 'dpp_metadata_fetch_failed',
      message: err instanceof Error ? err.message : String(err),
      retryable: true,
      fileId,
    };
  }

  if (!metadata) {
    return {
      ok: false,
      code: 'dpp_metadata_not_found',
      message: `DeepSeek file metadata did not include file_id ${fileId}. The file may have been removed, or you may not have permission to access it.`,
      retryable: false,
      fileId,
    };
  }

  // 2) 拉文件 bytes
  let blob: Blob;
  try {
    const downloadUrl = resolveSignedUrl(metadata.signedPath, baseUrl);
    const fileResponse = await fetchImpl(downloadUrl, {
      method: 'GET',
      credentials: 'include',
      signal: options.signal,
      headers: {
        accept: '*/*',
        [DOWNLOAD_ATTACHED_FILE_BYPASS_HEADER]: '1',
      },
    });
    if (!fileResponse.ok) {
      return {
        ok: false,
        code: 'dpp_file_http_error',
        message: `DeepSeek file download returned HTTP ${fileResponse.status}.`,
        retryable: fileResponse.status >= 500,
        fileId,
      };
    }
    const contentLength = readNumber(fileResponse.headers.get('content-length'));
    if (contentLength !== null && contentLength > MAX_FILE_BYTES) {
      return {
        ok: false,
        code: 'dpp_file_too_large',
        message: `File is ${contentLength} bytes which exceeds the ${MAX_FILE_BYTES} byte safety cap.`,
        retryable: false,
        fileId,
      };
    }
    blob = await fileResponse.blob();
  } catch (err) {
    return {
      ok: false,
      code: 'dpp_file_fetch_failed',
      message: err instanceof Error ? err.message : String(err),
      retryable: true,
      fileId,
    };
  }

  if (blob.size > MAX_FILE_BYTES) {
    return {
      ok: false,
      code: 'dpp_file_too_large',
      message: `Downloaded ${blob.size} bytes which exceeds the ${MAX_FILE_BYTES} byte safety cap.`,
      retryable: false,
      fileId,
    };
  }

  // 3) 写磁盘
  const targetFilename = buildTargetFilename(metadata);
  let localPath: string;
  let downloadId: number | null = null;
  if (options.bypassChromeDownloads) {
    const bypass = await options.bypassChromeDownloads(blob, targetFilename);
    localPath = bypass.localPath;
    downloadId = typeof bypass.downloadId === 'number' ? bypass.downloadId : null;
  } else if (options.downloadApi) {
    // chrome.downloads.download 不接受凭空构造的 `blob:...` 字符串，
    // 必须先用 URL.createObjectURL(blob) 拿到真实 blob URL，传下去之后再 revoke。
    const createObjectUrl = options.createObjectUrl
      ?? (typeof globalThis.URL?.createObjectURL === 'function'
        ? globalThis.URL.createObjectURL.bind(globalThis.URL)
        : null);
    const revokeObjectUrl = options.revokeObjectUrl
      ?? (typeof globalThis.URL?.revokeObjectURL === 'function'
        ? globalThis.URL.revokeObjectURL.bind(globalThis.URL)
        : null);
    if (!createObjectUrl) {
      return {
        ok: false,
        code: 'dpp_no_downloader',
        message: 'No URL.createObjectURL is available; cannot bridge the blob to chrome.downloads.',
        retryable: false,
        fileId,
      };
    }
    const blobUrl = createObjectUrl(blob);
    try {
      downloadId = await options.downloadApi.download({
        url: blobUrl,
        filename: targetFilename,
        saveAs: false,
        conflictAction: 'uniquify',
      });
    } finally {
      if (revokeObjectUrl) {
        try { revokeObjectUrl(blobUrl); } catch { /* ignore */ }
      }
    }
    const items = await options.downloadApi.search({ id: downloadId });
    if (items.length === 0 || !items[0].filename) {
      return {
        ok: false,
        code: 'dpp_download_path_unknown',
        message: 'chrome.downloads did not return a local path for the downloaded attachment.',
        retryable: false,
        fileId,
      };
    }
    localPath = items[0].filename;
  } else {
    return {
      ok: false,
      code: 'dpp_no_downloader',
      message: 'No chrome.downloads API is available in this environment.',
      retryable: false,
      fileId,
    };
  }

  return {
    ok: true,
    localPath,
    fileName: metadata.fileName,
    sizeBytes: blob.size,
    mimeType: metadata.mimeType,
    fileId,
    downloadId: typeof downloadId === 'number' ? downloadId : null,
    source: 'metadata',
  };
}
