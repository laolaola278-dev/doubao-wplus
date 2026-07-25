// tests/dev-diagnostics.test.ts
// Dev-only diagnostics — 单元测试
//
// 验证：
//   - 仅在 E2E / dev 构建模式下启用
//   - writeDevDiagnostics 幂等合并
//   - markFetchHooked / markMainWorldReadyForDev / setSelectorHealth 各自只更新自己的字段
//   - extractMaskedHeaderMeta 不暴露 header 值
//   - setLastCapturedRequest 不暴露敏感数据

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as devDiag from '../core/diagnostics/dev-diagnostics';

const {
  clearDevDiagnostics,
  isDevDiagnosticsEnabled,
  markFetchHooked,
  markMainWorldReadyForDev,
  readDevDiagnostics,
  setLastCapturedRequest,
  setSelectorHealth,
  writeDevDiagnostics,
  extractMaskedHeaderMeta,
} = devDiag;

function setEnabled(v: boolean): void {
  if (v) {
    (globalThis as Record<string, unknown>)['__DOUBAO_WPLUS_E2E__'] = '1';
  } else {
    delete (globalThis as Record<string, unknown>)['__DOUBAO_WPLUS_E2E__'];
    delete (globalThis as Record<string, unknown>)['__DOUBAO_WPLUS_DEV__'];
  }
}

describe('dev-diagnostics: isDevDiagnosticsEnabled', () => {
  afterEach(() => {
    setEnabled(false);
    clearDevDiagnostics();
  });

  it('disabled in production', () => {
    setEnabled(false);
    expect(isDevDiagnosticsEnabled()).toBe(false);
  });

  it('enabled in E2E mode', () => {
    setEnabled(true);
    expect(isDevDiagnosticsEnabled()).toBe(true);
  });
});

describe('dev-diagnostics: writeDevDiagnostics + readDevDiagnostics', () => {
  beforeEach(() => {
    setEnabled(true);
    clearDevDiagnostics();
  });
  afterEach(() => {
    setEnabled(false);
    clearDevDiagnostics();
  });

  it('writes initial state', () => {
    writeDevDiagnostics({}, { version: '0.1.0' });
    const diag = readDevDiagnostics();
    expect(diag).not.toBeNull();
    expect(diag!.version).toBe('0.1.0');
    expect(diag!.mainWorldReady).toBe(false);
    expect(diag!.fetchHooked).toBe(false);
    expect(diag!.lastCapturedRequest).toBeNull();
    expect(diag!.selectorHealth.status).toBe('unsupported');
    expect(diag!.host).toMatch(/doubao|deepseek/);
  });

  it('merges subsequent writes (idempotent)', () => {
    markMainWorldReadyForDev('1.0.0');
    markFetchHooked();
    const diag = readDevDiagnostics();
    expect(diag!.mainWorldReady).toBe(true);
    expect(diag!.fetchHooked).toBe(true);
  });

  it('patch cannot override host (always from registry)', () => {
    writeDevDiagnostics({} as never);
    const diag = readDevDiagnostics();
    // host 永远从 registry 读取，不接受 patch
    expect(diag!.host).toMatch(/doubao|deepseek/);
  });
});

describe('dev-diagnostics: marker helpers', () => {
  beforeEach(() => {
    setEnabled(true);
    clearDevDiagnostics();
  });
  afterEach(() => {
    setEnabled(false);
    clearDevDiagnostics();
  });

  it('markFetchHooked sets only fetchHooked=true', () => {
    markFetchHooked();
    const diag = readDevDiagnostics();
    expect(diag!.fetchHooked).toBe(true);
    expect(diag!.mainWorldReady).toBe(false);
  });

  it('markMainWorldReadyForDev sets only mainWorldReady=true', () => {
    markMainWorldReadyForDev('1.0.0');
    const diag = readDevDiagnostics();
    expect(diag!.mainWorldReady).toBe(true);
    expect(diag!.fetchHooked).toBe(false);
    expect(diag!.version).toBe('1.0.0');
  });

  it('setSelectorHealth updates selectorHealth', () => {
    setSelectorHealth({
      hostId: 'doubao',
      timestamp: 12345,
      probes: [],
      healthy: true,
      status: 'full',
      missingCritical: [],
      missingEssential: [],
      pageUrl: 'https://www.doubao.com/chat/abc',
    });
    const diag = readDevDiagnostics();
    expect(diag!.selectorHealth.status).toBe('full');
    expect(diag!.selectorHealth.healthy).toBe(true);
    expect(diag!.selectorHealth.timestamp).toBe(12345);
  });

  it('setLastCapturedRequest updates lastCapturedRequest', () => {
    setLastCapturedRequest({
      url: 'https://www.doubao.com/api/v1/chat/completion',
      method: 'POST',
      hasBody: true,
      bodyLength: 256,
      matchedHostPath: 'completion',
      headerKeys: ['Content-Type', 'Authorization'],
      hasAuthorization: true,
      hasCookie: false,
      hasSignatureLikeHeader: false,
      timestamp: 99999,
    });
    const diag = readDevDiagnostics();
    expect(diag!.lastCapturedRequest).not.toBeNull();
    expect(diag!.lastCapturedRequest!.url).toBe('https://www.doubao.com/api/v1/chat/completion');
    expect(diag!.lastCapturedRequest!.matchedHostPath).toBe('completion');
    expect(diag!.lastCapturedRequest!.hasAuthorization).toBe(true);
  });
});

describe('dev-diagnostics: production safety', () => {
  afterEach(() => {
    setEnabled(false);
    clearDevDiagnostics();
  });

  it('writeDevDiagnostics is a no-op when disabled', () => {
    setEnabled(false);
    clearDevDiagnostics();
    writeDevDiagnostics({} as never, { version: 'should-not-stick' });
    expect(readDevDiagnostics()).toBeNull();
  });

  it('readDiagnostics returns null when nothing written', () => {
    setEnabled(true);
    clearDevDiagnostics();
    expect(readDevDiagnostics()).toBeNull();
  });
});

describe('extractMaskedHeaderMeta: 安全脱敏', () => {
  it('returns header keys without values', () => {
    const meta = extractMaskedHeaderMeta(
      new Headers({
        'Content-Type': 'application/json',
        'Authorization': 'Bearer super-secret-token',
        'Cookie': 'session=abc123; user=me',
      }),
    );
    // Headers 对象规范化为小写，键名顺序无关
    expect(meta.headerKeys.sort()).toEqual(['authorization', 'content-type', 'cookie']);
    // 不应有任何 header 值
    expect(JSON.stringify(meta)).not.toContain('super-secret-token');
    expect(JSON.stringify(meta)).not.toContain('session=abc123');
    expect(meta.hasAuthorization).toBe(true);
    expect(meta.hasCookie).toBe(true);
  });

  it('detects signature-like headers', () => {
    const meta = extractMaskedHeaderMeta(
      new Headers({
        'a_bogus': 'xyz123',
        'x-tt-sign': 'somelongvalue',
        'msToken': 'abc',
        'Content-Type': 'application/json',
      }),
    );
    expect(meta.hasSignatureLikeHeader).toBe(true);
    expect(meta.hasAuthorization).toBe(false);
    expect(meta.hasCookie).toBe(false);
  });

  it('handles undefined headers', () => {
    const meta = extractMaskedHeaderMeta(undefined);
    expect(meta.headerKeys).toEqual([]);
    expect(meta.hasAuthorization).toBe(false);
    expect(meta.hasCookie).toBe(false);
    expect(meta.hasSignatureLikeHeader).toBe(false);
  });

  it('handles invalid headers without throwing', () => {
    expect(() => extractMaskedHeaderMeta(null as never)).not.toThrow();
  });
});
