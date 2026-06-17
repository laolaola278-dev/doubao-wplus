import type { McpServerCreateInput } from '../mcp/types';
import { SHELL_MCP_NATIVE_HOST, SHELL_MCP_SERVER_NAME } from './contracts';

export interface ShellMcpPresetOptions {
  nativeHost?: string;
  enabled?: boolean;
  executionEnabled?: boolean;
}

export function createShellMcpPresetInput(
  options: ShellMcpPresetOptions = {},
): McpServerCreateInput {
  return {
    displayName: SHELL_MCP_SERVER_NAME,
    enabled: options.enabled ?? false,
    transport: {
      kind: 'native_messaging',
      nativeHost: options.nativeHost ?? SHELL_MCP_NATIVE_HOST,
    },
    headers: [],
    secrets: [],
    timeouts: {
      connectMs: 5_000,
      requestMs: 120_000,
      discoveryMs: 10_000,
    },
    limits: {
      maxResultBytes: 128_000,
      maxToolCount: 8,
    },
    allowlist: {
      mode: 'allow',
      // B-02 fix: include the high-risk exec tools so the model can actually call
      // them. Without these the model only ever sees `shell_status` /
      // `python_status` / `local_skill_preview` / `local_folder_pick` and can
      // never reach the `officecli` binary to analyse uploaded documents.
      // Execution still defaults to `mode: 'manual'` (see below) so the user
      // must confirm each `shell_exec` / `python_exec` invocation.
      //
      // B-03 fix: also expose `download_attached_file` so the model can
      // bridge from DeepSeek's `ref_file_ids` (uploaded files in the page
      // UI) to a local path before invoking `officecli`. Risk is `medium`
      // — see `SHELL_TOOL_SPECS` in `contracts.ts`.
      toolNames: [
        'shell_status',
        'python_status',
        'local_skill_preview',
        'local_folder_pick',
        'shell_exec',
        'python_exec',
        'download_attached_file',
        // B-08: 供 upload_attached_file（extension-implemented）调用的 fs 桥
        'read_local_file',
      ],
    },
    execution: {
      enabled: options.executionEnabled ?? false,
      mode: 'manual',
    },
  };
}
