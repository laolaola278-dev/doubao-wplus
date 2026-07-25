import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import InsightsPage from '../entrypoints/sidepanel/pages/InsightsPage';
import { applyPromptEvent } from '../core/insights/aggregate';
import { createEmptyInsightsState, type InsightsState } from '../core/insights/types';
import type { InsightPromptEvent } from '../core/insights/events';

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
  vi.restoreAllMocks();
});

function makeEvent(overrides: Partial<InsightPromptEvent> = {}): InsightPromptEvent {
  return {
    timestamp: Date.now(),
    host: 'doubao',
    originalLength: 100,
    finalLength: 500,
    usedMemoryIds: [1],
    matchedSkills: ['python'],
    presetInjected: true,
    augmentDurationMs: 2,
    memorySelectDurationMs: 0.5,
    ruleDurationMs: 1,
    ...overrides,
  };
}

function seededState(): InsightsState {
  const state = createEmptyInsightsState();
  applyPromptEvent(state, makeEvent());
  applyPromptEvent(state, makeEvent({ host: 'deepseek', usedMemoryIds: [], matchedSkills: [] }));
  return state;
}

async function renderPage(sendMessage: ReturnType<typeof vi.fn>) {
  vi.stubGlobal('chrome', {
    runtime: {
      sendMessage,
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
    },
  });
  await act(async () => {
    root = createRoot(container);
    root.render(React.createElement(InsightsPage));
  });
}

function makeSendMessage(state: InsightsState) {
  return vi.fn(async (message: { type: string }) => {
    if (message.type === 'GET_INSIGHTS_STATE') return state;
    if (message.type === 'GET_MEMORIES') return [{ id: 1, name: '身份记忆', content: '', type: 'user', tags: [] }];
    if (message.type === 'CLEAR_INSIGHTS') return { ok: true };
    return { ok: true };
  });
}

async function clickTestId(testId: string) {
  const el = container.querySelector(`[data-testid="${testId}"]`);
  expect(el).toBeTruthy();
  await act(async () => {
    el?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

describe('InsightsPage', () => {
  it('渲染概览卡片与图表区（今日范围）', async () => {
    await renderPage(makeSendMessage(seededState()));

    expect(container.querySelector('[data-testid="insights-page"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="insights-cards"]')).toBeTruthy();
    expect(container.textContent).toContain('Prompt 发送次数');
    expect(container.textContent).toContain('2');
    // memory 榜显示解析出的名称
    expect(container.textContent).toContain('身份记忆');
    // host 占比图
    expect(container.querySelector('[data-testid="insights-donut-chart"]')).toBeTruthy();
    // 性能表
    expect(container.querySelector('[data-testid="insights-perf"]')).toBeTruthy();
  });

  it('空数据时显示空态', async () => {
    await renderPage(makeSendMessage(createEmptyInsightsState()));
    expect(container.querySelector('[data-testid="insights-empty"]')).toBeTruthy();
  });

  it('切换范围重新聚合（本周 → 全部）', async () => {
    await renderPage(makeSendMessage(seededState()));
    await clickTestId('insights-range-all');
    expect(container.textContent).toContain('Prompt 发送次数');
    expect(container.querySelector('[data-testid="insights-cards"]')).toBeTruthy();
  });

  it('清空需确认；确认后发送 CLEAR_INSIGHTS', async () => {
    const sendMessage = makeSendMessage(seededState());
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await renderPage(sendMessage);

    await clickTestId('insights-clear');
    expect(confirmSpy).toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalledWith({ type: 'CLEAR_INSIGHTS' });

    confirmSpy.mockReturnValue(true);
    await clickTestId('insights-clear');
    expect(sendMessage).toHaveBeenCalledWith({ type: 'CLEAR_INSIGHTS' });
  });
});
