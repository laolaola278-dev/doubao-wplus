import type {
  McpJsonRpcNotification,
  McpJsonRpcRequest,
  McpJsonRpcResponse,
  McpProtocolTransport,
  McpServerConfig,
} from '../types';
import { McpTransportError, normalizeJsonRpcResponse } from './common';

interface McpNativeEnvelope {
  protocol: 'dwplus-mcp-native';
  version: 1;
  server: {
    id: string;
    command?: string;
    args?: string[];
    cwd?: string;
    env?: Record<string, string>;
  };
  message: McpJsonRpcRequest<any> | McpJsonRpcNotification;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface NativePortState {
  port: chrome.runtime.Port;
  pendingRequests: Map<number | string, PendingRequest>;
}

const nativePortStates = new Map<string, NativePortState>();

function getPortState(nativeHost: string): NativePortState {
  const existing = nativePortStates.get(nativeHost);
  if (existing) return existing;

  if (!chrome.runtime?.connectNative) {
    throw new McpTransportError('mcp_native_messaging_unavailable', 'Browser native messaging is unavailable.', {
      retryable: false,
    });
  }

  const port = chrome.runtime.connectNative(nativeHost);
  const state: NativePortState = {
    port,
    pendingRequests: new Map(),
  };
  nativePortStates.set(nativeHost, state);

  port.onMessage.addListener((response: any) => {
    const id = response?.id ?? response?.result?.id;
    const rpcId = response?.jsonrpc === '2.0' ? response.id : id;
    if (rpcId != null && state.pendingRequests.has(rpcId)) {
      const pending = state.pendingRequests.get(rpcId)!;
      state.pendingRequests.delete(rpcId);
      clearTimeout(pending.timer);
      pending.resolve(response);
    }
  });

  port.onDisconnect.addListener(() => {
    const err = new McpTransportError(
      'mcp_native_host_disconnected',
      chrome.runtime.lastError?.message || 'Native host disconnected.',
      { retryable: true },
    );
    for (const pending of state.pendingRequests.values()) {
      clearTimeout(pending.timer);
      pending.reject(err);
    }
    state.pendingRequests.clear();
    nativePortStates.delete(nativeHost);
  });

  return state;
}

export function createMcpNativeMessagingTransport(server: McpServerConfig): McpProtocolTransport {
  return {
    request(request, options) {
      return sendNativeMessage(server, request, options?.timeoutMs);
    },
    async notify(notification, options) {
      await sendNativeMessage(server, notification, options?.timeoutMs);
    },
  };
}

async function sendNativeMessage<TParams extends Record<string, unknown> | undefined, TResult>(
  server: McpServerConfig,
  message: McpJsonRpcRequest<TParams> | McpJsonRpcNotification,
  timeoutMs: number = server.timeouts.requestMs,
): Promise<McpJsonRpcResponse<TResult>> {
  const nativeHost = server.transport.nativeHost;
  if (!nativeHost) {
    throw new McpTransportError('mcp_native_host_missing', 'Native messaging host is not configured.', {
      retryable: false,
    });
  }

  const expectedRequest = 'id' in message ? message as McpJsonRpcRequest<TParams> : undefined;
  const envelope = createNativeEnvelope(server, message);

  let response: unknown;
  if (expectedRequest) {
    response = await sendAndWait(nativeHost, envelope, expectedRequest.id, timeoutMs);
  } else {
    const state = getPortState(nativeHost);
    state.port.postMessage(envelope);
    return undefined as any;
  }

  return normalizeJsonRpcResponse<TResult>(response, expectedRequest);
}

function sendAndWait(
  nativeHost: string,
  envelope: McpNativeEnvelope,
  requestId: number | string,
  timeoutMs: number,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let state: NativePortState;
    try {
      state = getPortState(nativeHost);
    } catch (err) {
      reject(err);
      return;
    }

    const timer = setTimeout(() => {
      state.pendingRequests.delete(requestId);
      reject(new McpTransportError('mcp_native_timeout', `Native MCP request exceeded ${timeoutMs} ms.`));
    }, timeoutMs);

    state.pendingRequests.set(requestId, { resolve, reject, timer });
    try {
      state.port.postMessage(envelope);
    } catch (err) {
      clearTimeout(timer);
      state.pendingRequests.delete(requestId);
      reject(err);
    }
  });
}

function createNativeEnvelope(
  server: McpServerConfig,
  message: McpJsonRpcRequest<any> | McpJsonRpcNotification,
): McpNativeEnvelope {
  return {
    protocol: 'dwplus-mcp-native',
    version: 1,
    server: {
      id: server.id,
      command: server.transport.command,
      args: server.transport.args,
      cwd: server.transport.cwd,
      env: server.transport.env,
    },
    message,
  };
}
