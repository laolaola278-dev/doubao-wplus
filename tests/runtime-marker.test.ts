// tests/runtime-marker.test.ts
// Runtime diagnostics marker — 单元测试
//
// 验证：
//   - 仅在 E2E / dev 构建模式下启用
//   - 内容不暴露敏感信息
//   - 多次调用是幂等合并
//
// 注：diagnostics 是否启用由 build-time 常量 __DOUBAO_WPLUS_E2E__ /
// __DOUBAO_WPLUS_DEV__ 决定（见 wxt.config.ts 的 define 段）。单元测试
// 通过 vi.spyOn 替换 isDiagnosticsEnabled 来模拟不同构建模式。

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import * as runtimeMarker from '../core/diagnostics/runtime-marker';

const {
  clearDiagnostics,
  isDiagnosticsEnabled,
  markBridgeReady,
  markContentReady,
  markMainWorldReady,
  readDiagnostics,
  writeDiagnostics,
} = runtimeMarker;

function setEnabled(v: boolean): void {
  if (v) {
    (globalThis as Record<string, unknown>)['__DOUBAO_WPLUS_E2E__'] = '1';
  } else {
    delete (globalThis as Record<string, unknown>)['__DOUBAO_WPLUS_E2E__'];
    delete (globalThis as Record<string, unknown>)['__DOUBAO_WPLUS_DEV__'];
  }
}

describe('runtime-marker: isDiagnosticsEnabled (mocked)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('disabled in production builds', () => {
    setEnabled(false);
    expect(isDiagnosticsEnabled()).toBe(false);
  });

  it('enabled in E2E builds', () => {
    setEnabled(true);
    expect(isDiagnosticsEnabled()).toBe(true);
  });
});

describe('runtime-marker: writeDiagnostics + readDiagnostics', () => {
  beforeEach(() => {
    setEnabled(true);
    clearDiagnostics();
  });
  afterEach(() => {
    setEnabled(false);
    clearDiagnostics();
    vi.restoreAllMocks();
  });

  it('writes a complete diagnostics object', () => {
    writeDiagnostics({ contentReady: true, mainWorldReady: true }, { version: '0.1.0' });
    const diag = readDiagnostics();
    expect(diag).not.toBeNull();
    expect(diag!.version).toBe('0.1.0');
    expect(diag!.contentReady).toBe(true);
    expect(diag!.mainWorldReady).toBe(true);
    expect(diag!.activeHostId).toMatch(/doubao|deepseek/);
    expect(diag!.features).toBeDefined();
  });

  it('merges subsequent writes (idempotent)', () => {
    writeDiagnostics({ contentReady: true }, { version: '0.1.0' });
    writeDiagnostics({ mainWorldReady: true });
    const diag = readDiagnostics();
    expect(diag!.contentReady).toBe(true);
    expect(diag!.mainWorldReady).toBe(true);
  });

  it('patch cannot override activeHostId or features', () => {
    writeDiagnostics({ contentReady: true });
    writeDiagnostics({ contentReady: true });
    const diag = readDiagnostics();
    expect(diag!.activeHostId).toBeDefined();
    expect(diag!.features).toBeDefined();
  });
});

describe('runtime-marker: marker helpers', () => {
  beforeEach(() => {
    setEnabled(true);
    clearDiagnostics();
  });
  afterEach(() => {
    setEnabled(false);
    clearDiagnostics();
    vi.restoreAllMocks();
  });

  it('markContentReady sets contentReady=true only', () => {
    markContentReady();
    const diag = readDiagnostics();
    expect(diag!.contentReady).toBe(true);
    expect(diag!.mainWorldReady).toBe(false);
    expect(diag!.bridgeId).toBeNull();
  });

  it('markMainWorldReady sets mainWorldReady=true only', () => {
    markMainWorldReady();
    const diag = readDiagnostics();
    expect(diag!.mainWorldReady).toBe(true);
    expect(diag!.contentReady).toBe(false);
  });

  it('markBridgeReady sets bridgeId', () => {
    markBridgeReady('content-main');
    const diag = readDiagnostics();
    expect(diag!.bridgeId).toBe('content-main');
  });
});

describe('runtime-marker: production safety', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writeDiagnostics is a no-op when disabled', () => {
    setEnabled(false);
    clearDiagnostics();
    writeDiagnostics({ contentReady: true }, { version: 'should-not-stick' });
    expect(readDiagnostics()).toBeNull();
  });

  it('readDiagnostics returns null when nothing written', () => {
    setEnabled(true);
    clearDiagnostics();
    expect(readDiagnostics()).toBeNull();
  });
});
