// Studio Provider 去重测试 —— 关键不变量：双消费者只触发一次 GET_MEMORIES。
import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StudioDataProvider, useStudioInsights, useStudioMemories } from '../entrypoints/sidepanel/studio/data-provider';
import { createEmptyInsightsState } from '../core/insights/types';

let container: HTMLDivElement;
let root: Root | null;
let runtimeListeners: Array<(message: unknown) => void>;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = null;
  runtimeListeners = [];
});

afterEach(() => {
  if (root) {
    act(() => root?.unmount());
  }
  container.remove();
  vi.unstubAllGlobals();
});

const MEMORIES = [
  { id: 1, name: 'M1', content: 'c', description: '', type: 'user', tags: [], pinned: false, scope: 'global', syncId: 's1', createdAt: 1, updatedAt: 1, accessCount: 0, lastAccessedAt: 1 },
];

function stubChrome(sendMessage: ReturnType<typeof vi.fn>) {
  vi.stubGlobal('chrome', {
    runtime: {
      sendMessage,
      onMessage: {
        addListener: vi.fn((listener: (message: unknown) => void) => { runtimeListeners.push(listener); }),
        removeListener: vi.fn((listener: (message: unknown) => void) => {
          runtimeListeners = runtimeListeners.filter((item) => item !== listener);
        }),
      },
    },
  });
}

function MemoriesConsumer({ id }: { id: string }) {
  const [memories] = useStudioMemories();
  return React.createElement('div', { 'data-testid': `consumer-${id}` }, String(memories.length));
}

function InsightsConsumer() {
  const [state] = useStudioInsights();
  return React.createElement('div', { 'data-testid': 'insights-consumer' }, String(state.total.promptCount));
}

async function render(element: React.ReactElement) {
  await act(async () => {
    root = createRoot(container);
    root.render(element);
  });
}

describe('StudioDataProvider', () => {
  it('两个消费者共享缓存：GET_MEMORIES 只发送一次', async () => {
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === 'GET_MEMORIES') return MEMORIES;
      if (message.type === 'GET_INSIGHTS_STATE') return createEmptyInsightsState();
      return { ok: true };
    });
    stubChrome(sendMessage);

    await render(
      React.createElement(StudioDataProvider, null,
        React.createElement(MemoriesConsumer, { id: 'a' }),
        React.createElement(MemoriesConsumer, { id: 'b' }),
      ),
    );

    const memoryCalls = sendMessage.mock.calls.filter((call) => (call[0] as { type: string }).type === 'GET_MEMORIES');
    expect(memoryCalls).toHaveLength(1);
    expect(container.querySelector('[data-testid="consumer-a"]')?.textContent).toBe('1');
    expect(container.querySelector('[data-testid="consumer-b"]')?.textContent).toBe('1');
  });

  it('STATE_UPDATED 广播推送到所有消费者（不重新取数）', async () => {
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === 'GET_MEMORIES') return MEMORIES;
      return { ok: true };
    });
    stubChrome(sendMessage);

    await render(
      React.createElement(StudioDataProvider, null,
        React.createElement(MemoriesConsumer, { id: 'a' }),
      ),
    );
    expect(container.querySelector('[data-testid="consumer-a"]')?.textContent).toBe('1');

    await act(async () => {
      for (const listener of runtimeListeners) {
        listener({ type: 'STATE_UPDATED', memories: [...MEMORIES, { ...MEMORIES[0], id: 2, syncId: 's2' }] });
      }
    });

    expect(container.querySelector('[data-testid="consumer-a"]')?.textContent).toBe('2');
    // 推送更新，不应触发第二次 GET_MEMORIES
    const memoryCalls = sendMessage.mock.calls.filter((call) => (call[0] as { type: string }).type === 'GET_MEMORIES');
    expect(memoryCalls).toHaveLength(1);
  });

  it('Provider 缺席时 hook 退化为直取（既有单页测试兼容）', async () => {
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === 'GET_MEMORIES') return MEMORIES;
      if (message.type === 'GET_INSIGHTS_STATE') return createEmptyInsightsState();
      return { ok: true };
    });
    stubChrome(sendMessage);

    await render(React.createElement(MemoriesConsumer, { id: 'solo' }));
    expect(container.querySelector('[data-testid="consumer-solo"]')?.textContent).toBe('1');
  });

  it('insights 缓存独立于 memories 缓存', async () => {
    const seeded = createEmptyInsightsState();
    seeded.total.promptCount = 7;
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === 'GET_MEMORIES') return MEMORIES;
      if (message.type === 'GET_INSIGHTS_STATE') return seeded;
      return { ok: true };
    });
    stubChrome(sendMessage);

    await render(
      React.createElement(StudioDataProvider, null,
        React.createElement(InsightsConsumer),
        React.createElement(InsightsConsumer),
      ),
    );

    const insightsCalls = sendMessage.mock.calls.filter((call) => (call[0] as { type: string }).type === 'GET_INSIGHTS_STATE');
    expect(insightsCalls).toHaveLength(1);
    expect(container.querySelector('[data-testid="insights-consumer"]')?.textContent).toBe('7');
  });
});
