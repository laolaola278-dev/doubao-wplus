export type JsonPrimitive = string | number | boolean | null;

export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type ToolPayload = Record<string, unknown>;

export type ToolProviderKind = 'local' | 'mcp';

export type ToolProviderId = string;

export type ToolDescriptorId = string;

export type ToolCallId = string;

export type ToolExecutionTrigger = 'manual_chat' | 'agent_run' | 'automation' | 'test' | 'sidepanel_chat';

export type ToolExecutionMode = 'auto' | 'manual' | 'disabled';

export type ToolRiskLevel = 'low' | 'medium' | 'high';

export type ToolTransportKind =
  | 'in_process'
  | 'http'
  | 'sse'
  | 'streamable_http'
  | 'stdio_bridge'
  | 'native_messaging';

export interface ToolProviderIdentity {
  kind: ToolProviderKind;
  id: ToolProviderId;
  displayName: string;
  transport: ToolTransportKind;
}

export interface ToolDescriptorSchema {
  type: 'object';
  properties?: Record<string, JsonValue>;
  required?: string[];
  additionalProperties?: boolean;
  description?: string;
}

export interface ToolDescriptorExecution {
  mode: ToolExecutionMode;
  enabled: boolean;
  risk: ToolRiskLevel;
  timeoutMs?: number;
  maxResultBytes?: number;
}

export interface ToolDescriptor {
  id: ToolDescriptorId;
  provider: ToolProviderIdentity;
  name: string;
  invocationName: string;
  title: string;
  description: string;
  inputSchema: ToolDescriptorSchema;
  outputSchema?: ToolDescriptorSchema;
  execution: ToolDescriptorExecution;
  annotations?: Record<string, string>;
}

export interface ToolCallSource {
  trigger: ToolExecutionTrigger;
  requestId?: string;
  chatSessionId?: string | null;
  parentMessageId?: number | null;
  taskId?: string;
  runId?: string;
  messageId?: number | null;
  automationId?: string;
  automationRunId?: string;
}

export interface ToolCall {
  id?: ToolCallId;
  descriptorId?: ToolDescriptorId;
  provider?: ToolProviderIdentity;
  name: string;
  invocationName?: string;
  payload: ToolPayload;
  raw: string;
  parseError?: ToolError;
  source?: ToolCallSource;
  createdAt?: number;
  // B-05 fix: set to true when the user has approved a high-risk tool call
  // (e.g. shell_exec under `mode: 'manual'`) via the confirmation prompt.
  // The runtime guard checks this flag and lets the call through.
  confirmed?: boolean;
}

export interface ToolError {
  code: string;
  message: string;
  retryable: boolean;
  details?: ToolPayload;
}

export interface ToolResult {
  ok: boolean;
  summary: string;
  detail?: string;
  callId?: ToolCallId;
  descriptorId?: ToolDescriptorId;
  provider?: ToolProviderIdentity;
  name?: string;
  output?: JsonValue;
  error?: ToolError;
  startedAt?: number;
  completedAt?: number;
  durationMs?: number;
  truncated?: boolean;
  // B-05 fix: when set, the tool was *not* executed; the UI must show a
  // confirmation prompt and call back into the runtime with this token to
  // actually run it. Used for high-risk tools (shell_exec, python_exec) on
  // servers configured with `execution.mode === 'manual'`.
  requiresConfirmation?: boolean;
  confirmationToken?: string;
  riskLevel?: ToolRiskLevel;
  executionMode?: ToolExecutionMode;
}

export interface ToolExecutionContext {
  trigger: ToolExecutionTrigger;
  requestId: string;
  chatSessionId?: string | null;
  taskId?: string;
  runId?: string;
  timeoutMs?: number;
  maxResultBytes?: number;
}

export interface ToolProvider {
  identity: ToolProviderIdentity;
  listTools(): Promise<ToolDescriptor[]>;
  execute(call: ToolCall, context: ToolExecutionContext): Promise<ToolResult>;
}

export interface ToolRegistrySnapshot {
  providers: ToolProviderIdentity[];
  tools: ToolDescriptor[];
  refreshedAt: number;
}

export interface ToolCallHistoryRecord {
  id: string;
  call: ToolCall;
  result: ToolResult;
  createdAt: number;
  source: ToolExecutionTrigger;
}
