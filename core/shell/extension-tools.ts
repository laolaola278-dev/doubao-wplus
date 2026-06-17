// B-08: 把 Shell MCP server 上由扩展侧实现的工具（不走 native host）以
// 标准 McpToolDefinition 形式暴露出来，供 discovery 合并进 tools/list 响应。
//
// 这些工具调用需要用户的浏览器 session，native host 跑在浏览器外部拿不到，
// 所以在扩展里执行更合理。

import { SHELL_MCP_NATIVE_HOST, SHELL_MCP_SERVER_NAME, SHELL_TOOL_SPECS, type ShellToolSpec } from './contracts';
import type { McpServerConfig, McpToolDefinition } from '../mcp/types';

export function isShellMcpServer(server: Pick<McpServerConfig, 'displayName' | 'transport'>): boolean {
  if (server.displayName === SHELL_MCP_SERVER_NAME) return true;
  if (server.transport.kind === 'native_messaging' && server.transport.nativeHost === SHELL_MCP_NATIVE_HOST) {
    return true;
  }
  return false;
}

export function getExtensionImplementedShellSpecs(): ShellToolSpec[] {
  return SHELL_TOOL_SPECS.filter((spec) => spec.extensionImplemented === true);
}

export function getShellSyntheticToolDefinitions(): McpToolDefinition[] {
  return getExtensionImplementedShellSpecs().map((spec) => buildSyntheticToolDefinition(spec));
}

function buildSyntheticToolDefinition(spec: ShellToolSpec): McpToolDefinition {
  const baseInput: Record<string, unknown> = spec.inputSchema ?? {
    type: 'object',
    properties: {},
    additionalProperties: false,
  };
  return {
    name: spec.name,
    title: spec.title,
    description: spec.description,
    inputSchema: baseInput as unknown as McpToolDefinition['inputSchema'],
    annotations: {
      operation: 'read',
      risk: spec.risk,
      // 给 discovery 用的标志：识别为扩展侧实现
      extensionImplemented: true,
    },
  };
}
