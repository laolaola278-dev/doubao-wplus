// tests/diagnostics-export.test.ts
// 诊断导出 + Adapter 元数据 — 单元测试
//
// 验证：
//   - adapter getMeta() 契约：必填字段、版本格式、日期格式
//   - buildDiagnosticsExport 汇总 host / adapter / debug / selfCheck / lastAugmentation
//   - 生产模式（门控关闭）返回 null，不安装全局函数
//   - 导出内容不含敏感数据通道（结构层面断言）

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildDiagnosticsExport, installDiagnosticsExport } from '../core/diagnostics/diagnostics-export';
import {
  clearDevDiagnostics,
  setLastAugmentationOutcome,
  writeDevDiagnostics,
} from '../core/diagnostics/dev-diagnostics';
import { runAndReportStartupSelfCheck } from '../core/diagnostics/startup-self-check';
import { DoubaoAdapter } from '../core/hosts/doubao/adapter';
import { DeepSeekAdapter } from '../core/hosts/deepseek/adapter';
import { setActiveHostId } from '../core/hosts/registry';

function setEnabled(v: boolean): void {
  if (v) {
    (globalThis as Record<string, unknown>)['__DOUBAO_WPLUS_E2E__'] = '1';
  } else {
    delete (globalThis as Record<string, unknown>)['__DOUBAO_WPLUS_E2E__'];
  }
}

describe('HostAdapter.getMeta contract', () => {
  const adapters = [new DoubaoAdapter(), new DeepSeekAdapter()];

  it.each(adapters.map((a) => [a.id, a] as const))('%s meta has all required fields', (_id, adapter) => {
    const meta = adapter.getMeta();
    expect(meta.hostName).toBe(adapter.name);
    // semver 格式
    expect(meta.adapterVersion).toMatch(/^\d+\.\d+\.\d+$/);
    // ISO 日期
    expect(meta.lastVerifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(meta.verifiedPages.length).toBeGreaterThan(0);
    expect(meta.verifiedBodyStructures.length).toBeGreaterThan(0);
    expect(meta.evidence.length).toBeGreaterThan(0);
  });

  it('doubao meta records the real completion contract facts', () => {
    const meta = new DoubaoAdapter().getMeta();
    const structures = meta.verifiedBodyStructures.join('\n');
    expect(structures).toContain('need_create_conversation');
    expect(structures).toContain('content_block');
    expect(structures).toContain('a_bogus');
  });
});

describe('buildDiagnosticsExport', () => {
  beforeEach(() => {
    setEnabled(true);
    setActiveHostId('doubao');
    clearDevDiagnostics();
  });
  afterEach(() => {
    setEnabled(false);
    clearDevDiagnostics();
  });

  it('returns null in production (gate off)', () => {
    setEnabled(false);
    expect(buildDiagnosticsExport()).toBeNull();
  });

  it('aggregates host, adapter meta, debug flags, self check, and last augmentation', () => {
    writeDevDiagnostics({ mainWorldReady: true, fetchHooked: true }, { version: '0.1.0' });
    runAndReportStartupSelfCheck('https://www.doubao.com/chat/');
    setLastAugmentationOutcome({
      urlPath: '/chat/completion',
      transport: 'fetch',
      modified: true,
      originalBodyLength: 1000,
      augmentedBodyLength: 9000,
      error: null,
      timestamp: 123,
    });

    const exported = buildDiagnosticsExport();
    expect(exported).not.toBeNull();
    expect(exported!.exportVersion).toBe(1);
    expect(exported!.host).toBe('doubao');
    expect(exported!.adapter.id).toBe('doubao');
    expect(exported!.adapter.adapterVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(exported!.debug.devDiagnosticsEnabled).toBe(true);
    expect(exported!.debug.extensionVersion).toBe('0.1.0');
    expect(exported!.debug.mainWorldReady).toBe(true);
    expect(exported!.debug.fetchHooked).toBe(true);
    expect(exported!.selfCheck?.passed).toBe(true);
    expect(exported!.selfCheck?.checks).toHaveLength(5);
    expect(exported!.lastAugmentation?.modified).toBe(true);
    expect(exported!.lastAugmentation?.augmentedBodyLength).toBe(9000);
  });

  it('tolerates a fresh session with no diagnostics written yet', () => {
    const exported = buildDiagnosticsExport();
    expect(exported).not.toBeNull();
    expect(exported!.selfCheck).toBeNull();
    expect(exported!.lastAugmentation).toBeNull();
    expect(exported!.lastCapturedRequest).toBeNull();
    expect(exported!.debug.mainWorldReady).toBeNull();
  });

  it('export structure carries no sensitive value channels', () => {
    setLastAugmentationOutcome({
      urlPath: '/chat/completion',
      transport: 'xhr',
      modified: false,
      originalBodyLength: 10,
      augmentedBodyLength: 10,
      error: 'augmentation timed out',
      timestamp: 1,
    });
    const json = JSON.stringify(buildDiagnosticsExport());
    // 脱敏结构断言：不存在 prompt / cookie / authorization 的值字段
    expect(json).not.toMatch(/"prompt"\s*:/);
    expect(json).not.toMatch(/"cookie"\s*:\s*"[^"]/i);
    expect(json).not.toMatch(/"authorization"\s*:\s*"[^"]/i);
    // 增强摘要只有长度，没有 body 内容字段
    expect(json).not.toMatch(/"body"\s*:/);
  });
});

describe('installDiagnosticsExport', () => {
  afterEach(() => {
    setEnabled(false);
    delete (window as unknown as Record<string, unknown>)['__DWPLUS_EXPORT_DIAG__'];
  });

  it('installs the global function in dev mode', () => {
    setEnabled(true);
    installDiagnosticsExport();
    const fn = (window as unknown as Record<string, unknown>)['__DWPLUS_EXPORT_DIAG__'];
    expect(typeof fn).toBe('function');
    expect((fn as () => unknown)()).toMatchObject({ exportVersion: 1 });
  });

  it('does not install in production', () => {
    setEnabled(false);
    installDiagnosticsExport();
    expect((window as unknown as Record<string, unknown>)['__DWPLUS_EXPORT_DIAG__']).toBeUndefined();
  });
});
