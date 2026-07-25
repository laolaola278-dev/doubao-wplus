// tests/startup-self-check.test.ts
// dev-only 启动自检 — 单元测试
//
// 验证：
//   - 两个真实 adapter 在健康状态下全部 5 项检查通过
//   - 各失败模式产生对应的 fail 项与定位线索（用 stub adapter 注入故障）
//   - DEV 门控：生产模式 runAndReportStartupSelfCheck 为 no-op
//   - 自检对异常 adapter 绝不抛出

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildBodyScaffoldForPath,
  runAndReportStartupSelfCheck,
  runStartupSelfCheck,
} from '../core/diagnostics/startup-self-check';
import { clearDevDiagnostics, readDevDiagnostics } from '../core/diagnostics/dev-diagnostics';
import { DoubaoAdapter } from '../core/hosts/doubao/adapter';
import { DeepSeekAdapter } from '../core/hosts/deepseek/adapter';
import { setActiveHostId } from '../core/hosts/registry';
import type { HostAdapter } from '../core/hosts/types';

const DOUBAO_URL = 'https://www.doubao.com/chat/';
const DEEPSEEK_URL = 'https://chat.deepseek.com/a/chat/s/abc';

function findCheck(report: ReturnType<typeof runStartupSelfCheck>, id: string) {
  const check = report.checks.find((c) => c.id === id);
  expect(check, `check ${id} should exist`).toBeDefined();
  return check!;
}

describe('buildBodyScaffoldForPath', () => {
  it('builds nested object/array scaffold for the doubao prompt path', () => {
    const scaffold = buildBodyScaffoldForPath('messages.0.content_block.0.content.text_block.text', 'v');
    expect(scaffold).toEqual({
      messages: [{ content_block: [{ content: { text_block: { text: 'v' } } }] }],
    });
  });

  it('builds flat scaffold for a single-segment path', () => {
    expect(buildBodyScaffoldForPath('prompt', 'v')).toEqual({ prompt: 'v' });
  });

  it('returns null for empty path or index-rooted path', () => {
    expect(buildBodyScaffoldForPath('', 'v')).toBeNull();
    expect(buildBodyScaffoldForPath('0.a', 'v')).toBeNull();
  });
});

describe('runStartupSelfCheck: healthy adapters', () => {
  it('doubao passes all 5 checks with info severity', () => {
    setActiveHostId('doubao');
    const report = runStartupSelfCheck(DOUBAO_URL, new DoubaoAdapter());
    expect(report.hostId).toBe('doubao');
    expect(report.checks).toHaveLength(5);
    expect(report.checks.filter((c) => !c.passed)).toEqual([]);
    expect(report.checks.every((c) => c.severity === 'info')).toBe(true);
    expect(report.passed).toBe(true);
    expect(report.errorCount).toBe(0);
    expect(report.warnCount).toBe(0);
    // 豆包声明缺失字段应出现在 mapping-compat detail 中（可诊断性）
    expect(findCheck(report, 'mapping-compat').detail).toContain('refFileIds');
  });

  it('deepseek passes all 5 checks', () => {
    setActiveHostId('deepseek');
    const report = runStartupSelfCheck(DEEPSEEK_URL, new DeepSeekAdapter());
    expect(report.passed).toBe(true);
  });
});

describe('runStartupSelfCheck: failure modes', () => {
  beforeEach(() => setActiveHostId('doubao'));

  function stubAdapter(overrides: Partial<HostAdapter>): HostAdapter {
    const base = new DoubaoAdapter();
    return new Proxy(base, {
      get(target, prop: string | symbol) {
        if (prop in overrides) return overrides[prop as keyof HostAdapter];
        const value = target[prop as keyof HostAdapter];
        return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
      },
    }) as HostAdapter;
  }

  it('detects unrecognized host URL', () => {
    const report = runStartupSelfCheck('https://unknown.example.com/', new DoubaoAdapter());
    const check = findCheck(report, 'host-detection');
    expect(check.passed).toBe(false);
    expect(check.severity).toBe('error');
    expect(check.detail).toContain('matchUrl');
    expect(report.passed).toBe(false);
    expect(report.errorCount).toBeGreaterThan(0);
  });

  it('detects chat path mismatch (P0-1 regression: placeholder path scenario)', () => {
    // 复现 P0-1 故障形态：isChatStreamUrl 用与 getPaths() 不一致的占位路径
    const adapter = stubAdapter({
      isChatStreamUrl: (url: string) => url.includes('/api/v1/chat/completion'),
    });
    const report = runStartupSelfCheck(DOUBAO_URL, adapter);
    const check = findCheck(report, 'chat-path-match');
    expect(check.passed).toBe(false);
    expect(check.severity).toBe('error');
    expect(check.detail).toContain('Prompt 增强将全程失效');
  });

  it('grades regenerate-only mismatch as WARN (core path still works)', () => {
    // completion 命中但 regenerate 不命中 —— 次级能力降级，不阻断
    const adapter = stubAdapter({
      isChatStreamUrl: (url: string) => url.includes('/chat/completion') && !url.includes('probe=1&regen'),
      getPaths: () => ({ completion: '/chat/completion', regenerate: '/chat/regen-other', history: '/x' }),
    });
    const report = runStartupSelfCheck(DOUBAO_URL, adapter);
    const check = findCheck(report, 'chat-path-match');
    expect(check.passed).toBe(false);
    expect(check.severity).toBe('warn');
    // warn 不阻断整体 passed
    expect(report.errorCount).toBe(0);
    expect(report.warnCount).toBeGreaterThan(0);
    expect(report.passed).toBe(true);
  });

  it('detects empty prompt path', () => {
    const adapter = stubAdapter({
      getRequestBodyFields: () => ({
        prompt: '', parentMessageId: '', chatSessionId: '', refFileIds: '',
        modelType: '', searchEnabled: '', thinkingEnabled: '',
      }),
    });
    const report = runStartupSelfCheck(DOUBAO_URL, adapter);
    expect(findCheck(report, 'prompt-path-roundtrip').passed).toBe(false);
    expect(findCheck(report, 'augmentation-executes').passed).toBe(false);
  });

  it('detects malformed mapping path syntax', () => {
    const adapter = stubAdapter({
      getRequestBodyFields: () => ({
        prompt: 'messages.0.content_block.0.content.text_block.text',
        parentMessageId: '.bad.path.', chatSessionId: 'a..b', refFileIds: '',
        modelType: '', searchEnabled: '', thinkingEnabled: '',
      }),
    });
    const report = runStartupSelfCheck(DOUBAO_URL, adapter);
    const check = findCheck(report, 'mapping-compat');
    expect(check.passed).toBe(false);
    // 非 prompt 字段的映射问题只降级对应能力，不阻断核心链路
    expect(check.severity).toBe('warn');
    expect(check.detail).toContain('parentMessageId');
    expect(check.detail).toContain('chatSessionId');
  });

  it('never throws even when the adapter itself throws', () => {
    const adapter = stubAdapter({
      getPaths: () => { throw new Error('boom'); },
      getRequestBodyFields: () => { throw new Error('boom'); },
    });
    const report = runStartupSelfCheck(DOUBAO_URL, adapter);
    expect(report.passed).toBe(false);
    expect(report.checks).toHaveLength(5);
    for (const id of ['chat-path-match', 'prompt-path-roundtrip', 'augmentation-executes', 'mapping-compat']) {
      expect(findCheck(report, id).passed).toBe(false);
    }
  });
});

describe('runAndReportStartupSelfCheck: DEV gating and logging', () => {
  beforeEach(() => {
    setActiveHostId('doubao');
    clearDevDiagnostics();
  });
  afterEach(() => {
    delete (globalThis as Record<string, unknown>)['__DOUBAO_WPLUS_E2E__'];
    clearDevDiagnostics();
    vi.restoreAllMocks();
  });

  it('is a no-op in production (gate off)', () => {
    const warnSpy = vi.spyOn(console, 'warn');
    const infoSpy = vi.spyOn(console, 'info');
    expect(runAndReportStartupSelfCheck(DOUBAO_URL)).toBeNull();
    expect(readDevDiagnostics()).toBeNull();
    expect(warnSpy.mock.calls.filter((c) => String(c[0]).includes('SELFCHECK'))).toEqual([]);
    expect(infoSpy.mock.calls.filter((c) => String(c[0]).includes('SELFCHECK'))).toEqual([]);
  });

  it('writes report to __DWPLUS_DIAG__.selfCheck and logs one info line when passing', () => {
    (globalThis as Record<string, unknown>)['__DOUBAO_WPLUS_E2E__'] = '1';
    const infoSpy = vi.spyOn(console, 'info');
    const report = runAndReportStartupSelfCheck(DOUBAO_URL);
    expect(report?.passed).toBe(true);
    expect(readDevDiagnostics()?.selfCheck?.passed).toBe(true);
    const selfCheckLogs = infoSpy.mock.calls.filter((c) => String(c[0]).includes('[DWPLUS-SELFCHECK]'));
    expect(selfCheckLogs).toHaveLength(1);
    expect(String(selfCheckLogs[0][0])).toContain('全部 5 项自检通过');
  });

  it('logs severity-graded developer messages for failed checks', () => {
    (globalThis as Record<string, unknown>)['__DOUBAO_WPLUS_E2E__'] = '1';
    const errorSpy = vi.spyOn(console, 'error');
    const report = runAndReportStartupSelfCheck('https://unknown.example.com/');
    expect(report?.passed).toBe(false);
    const errors = errorSpy.mock.calls.map((c) => String(c[0])).filter((s) => s.includes('[DWPLUS-SELFCHECK]'));
    // 每个 ERROR 级失败一行 console.error + 汇总一行
    expect(errors.some((s) => s.includes('ERROR host-detection'))).toBe(true);
    expect(errors.some((s) => s.includes('自检未通过'))).toBe(true);
    expect(readDevDiagnostics()?.selfCheck?.passed).toBe(false);
    expect(readDevDiagnostics()?.selfCheck?.errorCount).toBeGreaterThan(0);
  });
});
