// Studio Prompt / Diagnostics 页测试：脱敏摘要列表、空态、dev-only 提示。
import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PromptStudioPage from '../entrypoints/sidepanel/studio/PromptStudioPage';
import DiagnosticsPage from '../entrypoints/sidepanel/studio/DiagnosticsPage';
import type { PromptSnapshotSummary } from '../core/diagnostics/prompt-inspector';

let container: HTMLDivElement;
let root: Root | null;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = null;
});

afterEach(() => {
  if (root) {
    act(() => root?.unmount());
  }
  container.remove();
  vi.unstubAllGlobals();
});

const SUMMARY: PromptSnapshotSummary = {
  seq: 3,
  timestamp: Date.now(),
  host: 'doubao',
  adapterVersion: '1.0',
  originalLength: 20,
  finalLength: 400,
  stageLengths: [
    { id: 'raw-input', length: 20, changed: true },
    { id: 'skill', length: 20, changed: false },
    { id: 'memory-system', length: 300, changed: true },
    { id: 'preset', length: 300, changed: false },
    { id: 'final', length: 400, changed: true },
  ],
  memoryHit: true,
  usedMemoryCount: 2,
  matchedSkills: ['python'],
  presetInjected: false,
  augmentDurationMs: 2.5,
  augmentSucceeded: true,
  sendStatus: 'sent',
};

async function render(element: React.ReactElement, sendMessage: ReturnType<typeof vi.fn>) {
  vi.stubGlobal('chrome', {
    runtime: {
      sendMessage,
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
    },
  });
  await act(async () => {
    root = createRoot(container);
    root.render(element);
  });
}

async function click(el: Element | null) {
  expect(el).toBeTruthy();
  await act(async () => {
    el?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

describe('PromptStudioPage', () => {
  it('渲染脱敏快照列表并可展开阶段长度瀑布', async () => {
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === 'GET_STUDIO_HOST_DIAGNOSTICS') {
        return {
          ok: true,
          hostTabAvailable: true,
          promptInspector: { enabled: true, summaries: [SUMMARY] },
          selfCheck: null,
        };
      }
      return { ok: true };
    });
    await render(React.createElement(PromptStudioPage), sendMessage);

    expect(container.querySelector('[data-testid="studio-prompt-list"]')).toBeTruthy();
    expect(container.textContent).toContain('20→400');
    expect(container.textContent).toContain('2.5ms');
    expect(container.textContent).toContain('python');
    // 脱敏：页面绝不出现 prompt 全文字段
    expect(container.textContent).not.toContain('originalPrompt');

    await click(container.querySelector('[data-testid="studio-prompt-row-3"]'));
    const stages = container.querySelector('[data-testid="studio-prompt-stages"]');
    expect(stages).toBeTruthy();
    expect(stages?.textContent).toContain('memory-system');
    expect(stages?.textContent).toContain('+280');
  });

  it('宿主 tab 缺席时显示空态', async () => {
    const sendMessage = vi.fn(async () => ({ ok: true, hostTabAvailable: false, promptInspector: null, selfCheck: null }));
    await render(React.createElement(PromptStudioPage), sendMessage);
    expect(container.querySelector('[data-testid="studio-prompt-no-host"]')).toBeTruthy();
  });

  it('生产构建（inspector 关闭）显示 dev-only 提示', async () => {
    const sendMessage = vi.fn(async () => ({
      ok: true,
      hostTabAvailable: true,
      promptInspector: { enabled: false, summaries: [] },
      selfCheck: null,
    }));
    await render(React.createElement(PromptStudioPage), sendMessage);
    expect(container.querySelector('[data-testid="studio-prompt-disabled"]')).toBeTruthy();
  });
});

describe('DiagnosticsPage', () => {
  it('渲染自检明细与规则日志', async () => {
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === 'GET_STUDIO_HOST_DIAGNOSTICS') {
        return {
          ok: true,
          hostTabAvailable: true,
          promptInspector: null,
          selfCheck: {
            hostId: 'doubao',
            timestamp: Date.now(),
            passed: false,
            errorCount: 1,
            warnCount: 0,
            checks: [
              { id: 'host-detect', severity: 'info', label: '宿主识别', passed: true },
              { id: 'prompt-path', severity: 'error', label: 'Prompt 路径', passed: false, detail: 'path missing' },
            ],
          },
        };
      }
      if (message.type === 'GET_RULE_EXECUTION_LOG') return [];
      return { ok: true };
    });
    await render(React.createElement(DiagnosticsPage), sendMessage);

    const selfCheck = container.querySelector('[data-testid="studio-diagnostics-selfcheck"]');
    expect(selfCheck?.textContent).toContain('1 错误');
    expect(selfCheck?.textContent).toContain('宿主识别');
    expect(selfCheck?.textContent).toContain('path missing');
  });

  it('无自检报告（生产构建）显示 dev-only 空态', async () => {
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === 'GET_STUDIO_HOST_DIAGNOSTICS') {
        return { ok: true, hostTabAvailable: true, promptInspector: null, selfCheck: null };
      }
      if (message.type === 'GET_RULE_EXECUTION_LOG') return [];
      return { ok: true };
    });
    await render(React.createElement(DiagnosticsPage), sendMessage);
    expect(container.querySelector('[data-testid="studio-diagnostics-dev-only"]')).toBeTruthy();
  });
});
