// Studio Overview 页测试：今日指标卡 / Health 占位 / 最近诊断。
import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OverviewPage from '../entrypoints/sidepanel/studio/OverviewPage';
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
});

function makeEvent(overrides: Partial<InsightPromptEvent> = {}): InsightPromptEvent {
  return {
    timestamp: Date.now(),
    host: 'doubao',
    originalLength: 100,
    finalLength: 500,
    usedMemoryIds: [1, 2],
    matchedSkills: ['python'],
    presetInjected: false,
    augmentDurationMs: 2,
    memorySelectDurationMs: 0.5,
    ruleDurationMs: null,
    ...overrides,
  };
}

function seededState(): InsightsState {
  const state = createEmptyInsightsState();
  applyPromptEvent(state, makeEvent());
  applyPromptEvent(state, makeEvent({ usedMemoryIds: [], matchedSkills: [] }));
  return state;
}

async function renderOverview(sendMessage: ReturnType<typeof vi.fn>) {
  vi.stubGlobal('chrome', {
    runtime: {
      sendMessage,
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
    },
  });
  await act(async () => {
    root = createRoot(container);
    root.render(React.createElement(OverviewPage));
  });
}

describe('Studio OverviewPage', () => {
  it('渲染今日指标：Prompt 数 / 记忆命中 / Skill / Host / Health 占位', async () => {
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === 'GET_INSIGHTS_STATE') return seededState();
      if (message.type === 'GET_RULE_EXECUTION_LOG') return [];
      if (message.type === 'GET_STUDIO_HOST_DIAGNOSTICS') {
        return { ok: true, hostTabAvailable: false, promptInspector: null, selfCheck: null };
      }
      return { ok: true };
    });
    await renderOverview(sendMessage);

    const cards = container.querySelectorAll('[data-testid="studio-stat-card"]');
    expect(cards.length).toBe(6);
    expect(container.textContent).toContain('今日 Prompt');
    expect(container.textContent).toContain('记忆命中');
    expect(container.textContent).toContain('Skill 使用');
    expect(container.textContent).toContain('doubao 2');
    // Health Score 预留位
    expect(container.textContent).toContain('Health Score');
    expect(container.textContent).toContain('N/A');
  });

  it('展示自检结果与最近规则诊断', async () => {
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === 'GET_INSIGHTS_STATE') return seededState();
      if (message.type === 'GET_RULE_EXECUTION_LOG') {
        return [{
          timestamp: Date.now(),
          hostId: 'doubao',
          promptLengthBefore: 10,
          promptLengthAfter: 20,
          blocked: false,
          blockedReason: null,
          confirmationCount: 0,
          pinnedMemoryCount: 0,
          presetOverridden: false,
          records: [{ ruleId: 'r1', ruleName: 'R1', matched: true, appliedActions: ['append-prompt'], error: null }],
          durationMs: 1.5,
        }];
      }
      if (message.type === 'GET_STUDIO_HOST_DIAGNOSTICS') {
        return {
          ok: true,
          hostTabAvailable: true,
          promptInspector: { enabled: true, summaries: [] },
          selfCheck: { passed: true, errorCount: 0, warnCount: 0 },
        };
      }
      return { ok: true };
    });
    await renderOverview(sendMessage);

    expect(container.textContent).toContain('全部通过');
    const recent = container.querySelector('[data-testid="studio-overview-recent"]');
    expect(recent?.textContent).toContain('命中 1 条规则');
    expect(recent?.textContent).toContain('1.5ms');
  });

  it('空数据时最近诊断显示空态', async () => {
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === 'GET_INSIGHTS_STATE') return createEmptyInsightsState();
      if (message.type === 'GET_RULE_EXECUTION_LOG') return [];
      if (message.type === 'GET_STUDIO_HOST_DIAGNOSTICS') {
        return { ok: true, hostTabAvailable: false, promptInspector: null, selfCheck: null };
      }
      return { ok: true };
    });
    await renderOverview(sendMessage);

    expect(container.querySelector('[data-testid="studio-overview-recent"]')?.textContent)
      .toContain('暂无诊断记录');
  });
});
