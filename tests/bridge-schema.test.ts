import { describe, expect, it } from 'vitest';
import { requireBridgeMessage, validateBridgeMessage } from '../core/messaging/schema';

describe('bridge message schema', () => {
  it('accepts known bridge messages from the expected source', () => {
    const message = validateBridgeMessage({
      source: 'dwplus-main',
      type: 'AUGMENT_REQUEST_BODY',
      id: 'req-1',
      body: '{"prompt":"hello"}',
    }, 'dwplus-main');

    expect(message?.type).toBe('AUGMENT_REQUEST_BODY');
    expect(message?.id).toBe('req-1');
  });

  it('accepts the deprecated ready message during the compatibility window', () => {
    // backward compat: old brand
    const message = validateBridgeMessage({ source: 'deepseek-pp-main', type: 'DPP_BRIDGE_READY' });
    expect(message?.type).toBe('DPP_BRIDGE_READY');
  });

  it('rejects unknown types, source mismatches, and malformed optional fields', () => {
    expect(validateBridgeMessage({ source: 'dwplus-main', type: 'UNKNOWN' })).toBeNull();
    expect(validateBridgeMessage({ source: 'other', type: 'DWPLUS_BRIDGE_READY' }, 'dwplus-main')).toBeNull();
    expect(validateBridgeMessage({ source: 'dwplus-main', type: 'DWPLUS_BRIDGE_READY', ok: 'yes' })).toBeNull();
  });

  it('throws a clear error for required bridge messages', () => {
    expect(() => requireBridgeMessage({ source: 'dwplus-main', type: 'NOPE' }))
      .toThrow('Invalid doubao-wplus bridge message.');
  });
});
