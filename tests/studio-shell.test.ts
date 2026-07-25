// Studio 壳层导航测试：默认 Overview、七个子 tab、切换懒挂载。
import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import StudioPage from '../entrypoints/sidepanel/studio/StudioPage';
import { createEmptyInsightsState } from '../core/insights/types';

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

function defaultSendMessage() {
  return vi.fn(async (message: { type: string }) => {
    switch (message.type) {
      case 'GET_MEMORIES': return [];
      case 'GET_INSIGHTS_STATE': return createEmptyInsightsState();
      case 'GET_RULE_EXECUTION_LOG': return [];
      case 'GET_RULE_ENGINE_CONFIG': return { rules: [], variables: {} };
      case 'GET_STUDIO_HOST_DIAGNOSTICS':
        return { ok: true, hostTabAvailable: false, promptInspector: null, selfCheck: null };
      default: return { ok: true };
    }
  });
}

async function waitForTestId(testId: string) {
  for (let i = 0; i < 30; i++) {
    if (container.querySelector(`[data-testid="${testId}"]`)) return;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
  }
}

async function renderStudio(sendMessage: ReturnType<typeof vi.fn>) {
  vi.stubGlobal('chrome', {
    runtime: {
      sendMessage,
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
    },
  });
  await act(async () => {
    root = createRoot(container);
    root.render(React.createElement(StudioPage));
  });
  await waitForTestId('studio-overview');
}

async function clickTab(key: string) {
  const el = container.querySelector(`[data-testid="studio-tab-${key}"]`);
  expect(el).toBeTruthy();
  await act(async () => {
    el?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

describe('StudioPage shell', () => {
  it('渲染七个子 tab，默认打开 Overview', async () => {
    await renderStudio(defaultSendMessage());

    const keys = ['overview', 'prompt', 'memory', 'insights', 'rules', 'diagnostics', 'settings'];
    for (const key of keys) {
      expect(container.querySelector(`[data-testid="studio-tab-${key}"]`)).toBeTruthy();
    }
    expect(container.querySelector('[data-testid="studio-overview"]')).toBeTruthy();
  });

  it('切换到 Memory / Insights / Rules 复用既有页面组件', async () => {
    await renderStudio(defaultSendMessage());

    await clickTab('memory');
    await waitForTestId('memory-studio');
    expect(container.querySelector('[data-testid="memory-studio"]')).toBeTruthy();

    await clickTab('insights');
    await waitForTestId('insights-page');
    expect(container.querySelector('[data-testid="insights-page"]')).toBeTruthy();

    await clickTab('rules');
    await waitForTestId('rule-engine');
    expect(container.querySelector('[data-testid="rule-engine"]')).toBeTruthy();
  });

  it('切换到 Diagnostics / Settings 新子页', async () => {
    await renderStudio(defaultSendMessage());

    await clickTab('diagnostics');
    await waitForTestId('studio-diagnostics');
    expect(container.querySelector('[data-testid="studio-diagnostics"]')).toBeTruthy();

    await clickTab('settings');
    await waitForTestId('studio-settings');
    expect(container.querySelector('[data-testid="studio-settings"]')).toBeTruthy();
  });

  it('Prompt 页无宿主 tab 时显示空态', async () => {
    await renderStudio(defaultSendMessage());
    await clickTab('prompt');
    await waitForTestId('studio-prompt-no-host');
    expect(container.querySelector('[data-testid="studio-prompt-no-host"]')).toBeTruthy();
  });
});
