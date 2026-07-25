export type BridgeMessageType =
  | 'SYNC_HOOK_STATE'
  | 'AUGMENT_REQUEST_BODY'
  | 'AUGMENT_REQUEST_BODY_RESULT'
  | 'TOOL_CALL'
  | 'RESTORE_TOOL_CALLS'
  | 'RESPONSE_COMPLETE'
  | 'RESPONSE_TOKEN_SPEED'
  | 'MEMORIES_USED'
  | 'HEADERS_CAPTURED'
  // dev-only：content world 跑完启动自检后，把报告转发给 main world 写入 __DWPLUS_DIAG__
  | 'SELF_CHECK_REPORT'
  // dev-only：Prompt Inspector 快照的脱敏摘要（无 prompt 全文），同上转发写入 __DWPLUS_DIAG__
  | 'PROMPT_SNAPSHOT_SUMMARY'
  | 'DWPLUS_BRIDGE_READY'
  | 'DPP_BRIDGE_READY';

export interface ValidatedBridgeMessage {
  source: string;
  type: BridgeMessageType;
  id?: string;
  body?: string;
  ok?: boolean;
  error?: string;
  [key: string]: unknown;
}

const BRIDGE_TYPES = new Set<string>([
  'SYNC_HOOK_STATE',
  'AUGMENT_REQUEST_BODY',
  'AUGMENT_REQUEST_BODY_RESULT',
  'TOOL_CALL',
  'RESTORE_TOOL_CALLS',
  'RESPONSE_COMPLETE',
  'RESPONSE_TOKEN_SPEED',
  'MEMORIES_USED',
  'HEADERS_CAPTURED',
  'SELF_CHECK_REPORT',
  'PROMPT_SNAPSHOT_SUMMARY',
  'DWPLUS_BRIDGE_READY',
  'DPP_BRIDGE_READY',
]);

export function validateBridgeMessage(
  value: unknown,
  expectedSource?: string,
): ValidatedBridgeMessage | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const message = value as Record<string, unknown>;
  if (expectedSource && message.source !== expectedSource) return null;
  if (typeof message.source !== 'string') return null;
  if (typeof message.type !== 'string' || !BRIDGE_TYPES.has(message.type)) return null;

  if ('id' in message && typeof message.id !== 'string') return null;
  if ('body' in message && typeof message.body !== 'string') return null;
  if ('ok' in message && typeof message.ok !== 'boolean') return null;
  if ('error' in message && typeof message.error !== 'string') return null;

  return message as ValidatedBridgeMessage;
}

export function requireBridgeMessage(
  value: unknown,
  expectedSource?: string,
): ValidatedBridgeMessage {
  const message = validateBridgeMessage(value, expectedSource);
  if (!message) {
    throw new Error('Invalid doubao-wplus bridge message.');
  }
  return message;
}
