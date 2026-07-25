import type { ToolCall, ToolDescriptor, ToolResult } from '../tool';
import { applyMcpToolPolicy, callMcpTool, createMcpProtocolClient } from './client';
import {
  getAllMcpServers,
  getAllMcpToolCaches,
  getMcpServerById,
  getMcpToolCache,
  saveMcpToolCache,
  updateMcpServer,
} from './store';
import { createMcpTransport } from './transports';
import type {
  McpServerConfig,
  McpServerHealth,
  McpServerId,
  McpToolCacheEntry,
  McpToolDefinition,
} from './types';
import { getShellSyntheticToolDefinitions, isShellMcpServer } from '../shell/extension-tools';
import { downloadAttachedFile, type ChromeDownloadsApi } from '../shell/attached-file-downloader';
import { uploadAttachedFile, type UploadAttachedFileOptions } from '../shell/attached-file-uploader';
import { browser as safeBrowser } from '../browser/safe-wxt-browser';

const DEFAULT_CACHE_TTL_MS = 5 * 60_000;

export async function refreshMcpServerDiscovery(
  serverId: McpServerId,
  options?: { cacheTtlMs?: number },
): Promise<McpToolCacheEntry> {
  const server = await getMcpServerById(serverId, { includeSecrets: true });
  if (!server) throw new Error(`MCP server not found: ${serverId}`);
  return discoverServerTools(server, options);
}

export async function getMcpToolDescriptors(options?: {
  includeDisabled?: boolean;
  maxAgeMs?: number;
}): Promise<ToolDescriptor[]> {
  const [servers, caches] = await Promise.all([
    getAllMcpServers({ includeSecrets: false }),
    getAllMcpToolCaches(),
  ]);
  const now = Date.now();
  const serverMap = new Map(servers.map((server) => [server.id, server]));
  const descriptors: ToolDescriptor[] = [];

  for (const cache of caches) {
    const server = serverMap.get(cache.serverId);
    if (!server) continue;
    if (!options?.includeDisabled && !server.enabled) continue;
    if (options?.maxAgeMs != null && now - cache.refreshedAt > options.maxAgeMs) continue;
    // Expired descriptors are still useful for prompt injection; execution refreshes stale discovery before calling.
    const policyDescriptors = applyMcpToolPolicy(cache.descriptors, server);
    descriptors.push(
      ...policyDescriptors.filter((descriptor) =>
        options?.includeDisabled ||
        (descriptor.execution.enabled && descriptor.execution.mode === 'auto'),
      ),
    );
  }

  return descriptors;
}

export async function ensureMcpServerDiscovery(
  serverId: McpServerId,
  options?: { maxAgeMs?: number; cacheTtlMs?: number },
): Promise<McpToolCacheEntry> {
  const cache = await getMcpToolCache(serverId);
  const now = Date.now();
  if (
    cache &&
    cache.expiresAt > now &&
    (options?.maxAgeMs == null || now - cache.refreshedAt <= options.maxAgeMs)
  ) {
    return cache;
  }
  return refreshMcpServerDiscovery(serverId, options);
}

export async function executeMcpToolCall(call: ToolCall): Promise<ToolResult> {
  const serverId = call.provider?.kind === 'mcp'
    ? call.provider.id
    : call.provider?.id || call.descriptorId?.split(':')[1];
  if (!serverId) {
    return {
      ok: false,
      summary: 'MCP 服务缺失',
      detail: 'Tool call does not include an MCP server id.',
      name: call.name,
      error: {
        code: 'mcp_server_id_missing',
        message: 'Tool call does not include an MCP server id.',
        retryable: false,
      },
    };
  }

  const server = await getMcpServerById(serverId, { includeSecrets: true });
  if (!server || !server.enabled) {
    return {
      ok: false,
      summary: 'MCP 服务不可用',
      detail: server ? 'MCP server is disabled.' : `MCP server not found: ${serverId}`,
      name: call.name,
      error: {
        code: server ? 'mcp_server_disabled' : 'mcp_server_not_found',
        message: server ? 'MCP server is disabled.' : `MCP server not found: ${serverId}`,
        retryable: false,
      },
    };
  }

  const cache = await ensureMcpServerDiscovery(server.id);
  const descriptors = applyMcpToolPolicy(cache.descriptors, server);
  const descriptor = descriptors.find((item) => item.id === call.descriptorId || item.invocationName === call.invocationName || item.name === call.name);
  if (!descriptor) {
    return {
      ok: false,
      summary: 'MCP 工具不可用',
      detail: `MCP tool is not available on server ${server.displayName}.`,
      name: call.name,
      provider: call.provider,
      descriptorId: call.descriptorId,
      error: {
        code: 'mcp_tool_not_found',
        message: `MCP tool is not available on server ${server.displayName}.`,
        retryable: true,
      },
    };
  }
  if (!descriptor.execution.enabled || descriptor.execution.mode === 'disabled') {
    return {
      ok: false,
      summary: 'MCP 工具已禁用',
      detail: `MCP tool ${descriptor.name} is disabled by server policy.`,
      name: descriptor.name,
      provider: descriptor.provider,
      descriptorId: descriptor.id,
      error: {
        code: 'mcp_tool_disabled',
        message: `MCP tool ${descriptor.name} is disabled by server policy.`,
        retryable: false,
      },
    };
  }
  // B-05 fix: gate high-risk tools when the server is in `manual` mode.
  // Without this guard the runtime would happily call shell_exec /
  // python_exec as soon as the model emits the XML tag. We now refuse
  // to execute and ask the UI to surface a confirmation prompt; the UI
  // is expected to re-invoke with `call.confirmed = true` after the
  // user approves.
  if (
    descriptor.execution.mode === 'manual' &&
    descriptor.execution.risk === 'high' &&
    call.confirmed !== true
  ) {
    return {
      ok: false,
      summary: '高危工具等待确认',
      detail: `MCP tool ${descriptor.name} is marked high risk and the server is in manual execution mode. Confirm in the sidepanel to run it.`,
      name: descriptor.name,
      provider: descriptor.provider,
      descriptorId: descriptor.id,
      requiresConfirmation: true,
      confirmationToken: crypto.randomUUID(),
      riskLevel: descriptor.execution.risk,
      executionMode: descriptor.execution.mode,
      error: {
        code: 'mcp_tool_confirmation_required',
        message: 'High-risk MCP tool requires user confirmation.',
        retryable: true,
      },
    };
  }
  // B-08: tools marked `extensionImplemented: true` (e.g.
  // `download_attached_file`) need the user's browser session and must be
  // executed by the extension itself, not by the native shell host. We
  // short-circuit before the native host transport is constructed.
  if (descriptor.annotations?.extensionImplemented === 'true') {
    return executeExtensionImplementedTool(server, descriptor, call);
  }
  const transport = createMcpTransport(server);
  return callMcpTool(server, transport, {
    call: {
      ...call,
      descriptorId: descriptor?.id ?? call.descriptorId,
      provider: descriptor?.provider ?? call.provider,
    },
    descriptor,
    timeoutMs: descriptor?.execution.timeoutMs ?? server.timeouts.requestMs,
    maxResultBytes: descriptor?.execution.maxResultBytes ?? server.limits.maxResultBytes,
  });
}

async function discoverServerTools(
  server: McpServerConfig,
  options?: { cacheTtlMs?: number },
): Promise<McpToolCacheEntry> {
  const startedAt = Date.now();
  try {
    const client = createMcpProtocolClient(server, createMcpTransport(server));
    await client.initialize();
    const descriptors = await client.listTools();
    // B-08: merge in any extension-implemented tool definitions so the
    // model sees them in `tools/list` and the discovery layer can match
    // the call. The native host cannot implement these because it runs
    // outside the browser and lacks the user's chat.deepseek.com session.
    const augmented = augmentWithExtensionImplementedTools(server, descriptors);
    const completedAt = Date.now();
    const health: McpServerHealth = {
      serverId: server.id,
      status: 'ready',
      checkedAt: completedAt,
      latencyMs: completedAt - startedAt,
      toolCount: augmented.length,
      error: null,
    };
    const entry: McpToolCacheEntry = {
      serverId: server.id,
      descriptors: augmented,
      refreshedAt: completedAt,
      expiresAt: completedAt + (options?.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS),
      health,
    };
    await saveMcpToolCache(entry);
    await updateMcpServer(server.id, {
      status: 'ready',
      lastConnectedAt: completedAt,
      lastError: null,
    });
    return entry;
  } catch (err) {
    const completedAt = Date.now();
    const message = err instanceof Error ? err.message : String(err);
    const health: McpServerHealth = {
      serverId: server.id,
      status: 'error',
      checkedAt: completedAt,
      latencyMs: completedAt - startedAt,
      toolCount: 0,
      error: message,
    };
    const entry: McpToolCacheEntry = {
      serverId: server.id,
      descriptors: [],
      refreshedAt: completedAt,
      expiresAt: completedAt + Math.min(options?.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS, 30_000),
      health,
    };
    await saveMcpToolCache(entry);
    await updateMcpServer(server.id, {
      status: 'error',
      lastError: message,
    });
    return entry;
  }
}

// B-08: helpers for extension-implemented MCP tools.

function augmentWithExtensionImplementedTools(
  server: McpServerConfig,
  descriptors: ToolDescriptor[],
): ToolDescriptor[] {
  if (!isShellMcpServer(server)) return descriptors;
  const synthetic = getShellSyntheticToolDefinitions();
  if (synthetic.length === 0) return descriptors;

  const existingNames = new Set(descriptors.map((descriptor) => descriptor.name));
  const merged: ToolDescriptor[] = [...descriptors];
  for (const def of synthetic) {
    if (existingNames.has(def.name)) continue;
    merged.push(applyMcpToolPolicy([normalizeSyntheticDescriptor(server, def)], server)[0]);
  }
  return merged;
}

function normalizeSyntheticDescriptor(server: McpServerConfig, def: McpToolDefinition): ToolDescriptor {
  // `applyMcpToolPolicy` works on a list of descriptors produced by
  // `normalizeMcpToolDescriptor`, so we wrap the raw McpToolDefinition in
  // a descriptor first by re-using the existing normaliser.
  return {
    id: `mcp:${server.id}:${def.name}`,
    provider: {
      kind: 'mcp',
      id: server.id,
      displayName: server.displayName,
      transport: server.transport.kind as ToolDescriptor['provider']['transport'],
    },
    name: def.name,
    invocationName: `mcp_${server.id.replace(/[^A-Za-z0-9_]+/g, '_')}_${def.name}`.slice(0, 96),
    title: def.title || def.name,
    description: def.description || `MCP tool ${def.name}`,
    inputSchema: (def.inputSchema && typeof def.inputSchema === 'object' && !Array.isArray(def.inputSchema)
      ? { ...(def.inputSchema as Record<string, unknown>), type: 'object' } as ToolDescriptor['inputSchema']
      : { type: 'object', properties: {} } as ToolDescriptor['inputSchema']),
    outputSchema: { type: 'object', properties: {} },
    execution: {
      mode: server.execution.mode,
      enabled: server.enabled && server.execution.enabled,
      risk: def.annotations?.risk === 'low' || def.annotations?.risk === 'high' ? def.annotations.risk : 'medium',
      timeoutMs: server.timeouts.requestMs,
      maxResultBytes: server.limits.maxResultBytes,
    },
    annotations: {
      mcpServerId: server.id,
      mcpToolName: def.name,
      // String-coerce so the value survives `JSON.stringify` round trips
      // through the descriptor cache.
      extensionImplemented: def.annotations?.extensionImplemented === true ? 'true' : 'false',
    },
  };
}

async function executeExtensionImplementedTool(
  _server: McpServerConfig,
  descriptor: ToolDescriptor,
  call: ToolCall,
): Promise<ToolResult> {
  const startedAt = Date.now();
  const completedAt = Date.now();
  const baseFields = {
    name: descriptor.name,
    provider: descriptor.provider,
    descriptorId: descriptor.id,
    startedAt,
    completedAt,
    durationMs: 0,
  };

  if (descriptor.name === 'download_attached_file') {
    const fileId = readFileIdFromCall(call);
    if (!fileId) {
      return {
        ...baseFields,
        ok: false,
        summary: '下载网页附件失败',
        detail: 'download_attached_file requires a `file_id` argument. Pass one of the ref_file_ids the model saw on the request.',
        error: {
          code: 'dwplus_missing_file_id',
          message: 'file_id argument is missing.',
          retryable: false,
        },
      };
    }

    const result = await downloadAttachedFile({
      fileId,
      downloadApi: createChromeDownloadsApi(),
    });
    if (result.ok) {
      return {
        ...baseFields,
        ok: true,
        summary: `已下载到本机：${result.localPath}`,
        detail: `fileName=${result.fileName}, sizeBytes=${result.sizeBytes}, mimeType=${result.mimeType ?? 'unknown'}`,
        output: {
          localPath: result.localPath,
          fileName: result.fileName,
          sizeBytes: result.sizeBytes,
          mimeType: result.mimeType,
          fileId: result.fileId,
          downloadId: result.downloadId,
        },
        durationMs: completedAt - startedAt,
      };
    }
    return {
      ...baseFields,
      ok: false,
      summary: '下载网页附件失败',
      detail: result.message,
      error: {
        code: result.code,
        message: result.message,
        retryable: result.retryable,
      },
    };
  }

  if (descriptor.name === 'upload_attached_file') {
    const localPath = readLocalPathFromCall(call);
    if (!localPath) {
      return {
        ...baseFields,
        ok: false,
        summary: '上传文件到 DeepSeek 失败',
        detail: 'upload_attached_file requires a `local_path` argument pointing to a file on the local filesystem.',
        error: {
          code: 'dwplus_missing_local_path',
          message: 'local_path argument is missing.',
          retryable: false,
        },
      };
    }

    // B-08: 浏览器侧没有 file:// 权限，先调 native host 读文件拿字节。
    // `read_local_file` 是普通的 shell 工具（不是 extensionImplemented），
    // 走 createMcpTransport → callMcpTool 的标准通道；这里只复用 transport
    // 不会形成递归。
    let readFileImpl: UploadAttachedFileOptions['readFileImpl'];
    let readError: ToolResult | null = null;
    try {
      const readResult = await readLocalFileViaShell(_server, localPath);
      if (readResult.ok) {
        readFileImpl = async () => readResult.file;
      } else {
        readError = {
          ...baseFields,
          ok: false,
          summary: '上传文件到 DeepSeek 失败',
          detail: readResult.message,
          error: { code: readResult.code, message: readResult.message, retryable: false },
        };
      }
    } catch (err) {
      readError = {
        ...baseFields,
        ok: false,
        summary: '上传文件到 DeepSeek 失败',
        detail: err instanceof Error ? err.message : String(err),
        error: {
          code: 'dwplus_read_local_file_failed',
          message: err instanceof Error ? err.message : String(err),
          retryable: true,
        },
      };
    }
    if (readError) return readError;

    const result = await uploadAttachedFile({
      localPath,
      fileName: readStringFieldFromCall(call, 'file_name'),
      mimeType: readStringFieldFromCall(call, 'mime_type'),
      readFileImpl,
    });
    if (result.ok) {
      return {
        ...baseFields,
        ok: true,
        summary: `已上传：${result.fileName} → ref_file_id=${result.refFileId}`,
        detail: `sizeBytes=${result.sizeBytes}, mimeType=${result.mimeType ?? 'unknown'}`,
        output: {
          refFileId: result.refFileId,
          fileName: result.fileName,
          sizeBytes: result.sizeBytes,
          mimeType: result.mimeType,
          localPath: result.localPath,
        },
        durationMs: completedAt - startedAt,
      };
    }
    return {
      ...baseFields,
      ok: false,
      summary: '上传文件到 DeepSeek 失败',
      detail: result.message,
      error: {
        code: result.code,
        message: result.message,
        retryable: result.retryable,
      },
    };
  }

  return {
    ...baseFields,
    ok: false,
    summary: '工具未实现',
    detail: `Extension-implemented tool ${descriptor.name} has no executor wired up yet.`,
    error: {
      code: 'dwplus_extension_tool_not_implemented',
      message: `No extension-side executor for ${descriptor.name}.`,
      retryable: false,
    },
  };
}

function createChromeDownloadsApi(): ChromeDownloadsApi {
  // Wrap chrome.downloads into the ChromeDownloadsApi interface expected
  // by downloadAttachedFile. The native host cannot reach the user's
  // browser session, so the extension is the only place where we can
  // resolve a `file_id` (issued by chat.deepseek.com) into a local
  // download. Prefer the safe wrapper so we fail fast in tests/SSR
  // environments where chrome.* is undefined, and fall back to the raw
  // global otherwise.
  const downloads = (safeBrowser as unknown as {
    downloads?: {
      download: (options: unknown, callback: (id: number) => void) => void;
      search: (query: unknown, callback: (items: Array<{ id: number; filename?: string }>) => void) => void;
    };
  }).downloads
    ?? (typeof chrome !== 'undefined' && (chrome as unknown as { downloads?: unknown }).downloads
      ? (chrome as unknown as {
        downloads: {
          download: (options: unknown, callback: (id: number) => void) => void;
          search: (query: unknown, callback: (items: Array<{ id: number; filename?: string }>) => void) => void;
        };
      }).downloads
      : undefined);
  if (!downloads) {
    throw new Error('chrome.downloads API is unavailable in this context.');
  }
  const readLastError = (): string | null => {
    try {
      const last = (chrome as unknown as { runtime?: { lastError?: { message?: string } } })
        ?.runtime?.lastError;
      return last?.message ?? null;
    } catch {
      return null;
    }
  };
  return {
    download: (options) =>
      new Promise<number>((resolve, reject) => {
        downloads.download(options, (downloadId) => {
          const err = readLastError();
          if (err || typeof downloadId !== 'number') {
            reject(new Error(err ?? 'chrome.downloads.download did not return a numeric id.'));
            return;
          }
          resolve(downloadId);
        });
      }),
    search: (query) =>
      new Promise<Array<{ id: number; filename: string }>>((resolve, reject) => {
        downloads.search(query, (items) => {
          const err = readLastError();
          if (err) {
            reject(new Error(err));
            return;
          }
          const result = Array.isArray(items)
            ? items
              .map((item) => ({
                id: typeof item.id === 'number' ? item.id : -1,
                filename: typeof item.filename === 'string' ? item.filename : '',
              }))
              .filter((item) => item.id >= 0)
            : [];
          resolve(result);
        });
      }),
  };
}

function readFileIdFromCall(call: ToolCall): string | null {
  const payload = (call as unknown as { payload?: Record<string, unknown> }).payload;
  if (payload && typeof payload === 'object') {
    for (const key of ['file_id', 'fileId', 'ref_file_id', 'refFileId']) {
      const value = payload[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
  }
  if (typeof call.name === 'string') {
    const match = call.name.match(/[A-Za-z0-9_-]{8,}/);
    if (match) return match[0];
  }
  return null;
}

function readLocalPathFromCall(call: ToolCall): string | null {
  const payload = (call as unknown as { payload?: Record<string, unknown> }).payload;
  if (payload && typeof payload === 'object') {
    for (const key of ['local_path', 'localPath', 'path', 'file_path', 'filePath']) {
      const value = payload[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
  }
  return null;
}

function readStringFieldFromCall(call: ToolCall, field: string): string | undefined {
  const payload = (call as unknown as { payload?: Record<string, unknown> }).payload;
  if (!payload || typeof payload !== 'object') return undefined;
  const value = payload[field];
  if (typeof value === 'string' && value.trim()) return value.trim();
  return undefined;
}

// B-08: 通过 native shell host 的 `read_local_file` 工具读取本机文件。
// 返回的 file 对象可直接喂给 uploadAttachedFile 的 readFileImpl。
async function readLocalFileViaShell(
  server: McpServerConfig,
  localPath: string,
): Promise<
  | {
      ok: true;
      file: { name: string; sizeBytes: number; mimeType: string | null; bytes: Uint8Array };
    }
  | { ok: false; code: string; message: string }
> {
  const transport = createMcpTransport(server);
  const result = await callMcpTool(server, transport, {
    call: {
      name: 'read_local_file',
      descriptorId: `mcp:${server.id}:read_local_file`,
      provider: { kind: 'mcp', id: server.id, displayName: server.displayName, transport: server.transport.kind as 'native_messaging' },
      payload: { local_path: localPath },
      raw: JSON.stringify({ name: 'read_local_file', arguments: { local_path: localPath } }),
    },
    descriptor: {
      id: `mcp:${server.id}:read_local_file`,
      provider: { kind: 'mcp', id: server.id, displayName: server.displayName, transport: server.transport.kind as 'native_messaging' },
      name: 'read_local_file',
      invocationName: `mcp_${server.id.replace(/[^A-Za-z0-9_]+/g, '_')}_read_local_file`.slice(0, 96),
      title: 'Read Local File',
      description: 'Read a local file (base64) for upload.',
      inputSchema: { type: 'object', properties: { local_path: { type: 'string' } } },
      outputSchema: { type: 'object', properties: {} },
      execution: { mode: server.execution.mode, enabled: server.enabled, risk: 'medium', timeoutMs: server.timeouts.requestMs, maxResultBytes: server.limits.maxResultBytes },
      annotations: { mcpServerId: server.id, mcpToolName: 'read_local_file', extensionImplemented: 'false' },
    },
    timeoutMs: server.timeouts.requestMs,
    maxResultBytes: Math.max(server.limits.maxResultBytes, 32 * 1024 * 1024), // base64 至少要 4/3 倍，32MB 上限足够 16MB 文件
  });
  if (!result.ok) {
    return {
      ok: false,
      code: (result.error?.code as string) ?? 'dwplus_read_local_file_failed',
      message: result.detail ?? result.error?.message ?? 'read_local_file failed',
    };
  }
  const data = (result.output as { data?: { contentBase64?: string; fileName?: string; sizeBytes?: number; mimeType?: string | null } } | undefined)?.data;
  const base64 = data?.contentBase64;
  if (typeof base64 !== 'string' || !base64) {
    return { ok: false, code: 'dwplus_read_local_file_empty', message: 'read_local_file returned no contentBase64' };
  }
  // 浏览器环境用 atob 把 base64 还原成 binary string，再转 Uint8Array
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return {
    ok: true,
    file: {
      name: data?.fileName ?? localPath.split(/[\\/]/).pop() ?? 'file',
      sizeBytes: typeof data?.sizeBytes === 'number' ? data.sizeBytes : bytes.byteLength,
      mimeType: data?.mimeType ?? null,
      bytes,
    },
  };
}
