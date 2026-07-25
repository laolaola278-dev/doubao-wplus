// tests/memory-studio-page.test.ts
// Memory Studio 页面交互 — jsdom 测试（模式沿用 projects-page.test.ts）
//
// 验证：
//   - 列表渲染全字段元数据（来源/命中次数/时间）
//   - 全文搜索过滤、排序切换
//   - 批量选择 + DELETE_MEMORIES 消息
//   - 命中分析面板端到端（输入 prompt → 展示入选与原因）

import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MemoryStudioPage from '../entrypoints/sidepanel/pages/MemoryStudioPage';
import type { Memory } from '../core/types';

let container: HTMLDivElement;
let root: Root | null;

function memoryFixture(overrides: Partial<Memory>): Memory {
  return {
    id: 1,
    syncId: 'sync-1',
    scope: 'global',
    type: 'reference',
    name: 'Fixture',
    content: 'fixture content',
    description: 'd',
    tags: [],
    pinned: false,
    createdAt: Date.now() - 86_400_000,
    updatedAt: Date.now(),
    accessCount: 3,
    lastAccessedAt: Date.now(),
    ...overrides,
  };
}

const MEMORIES: Memory[] = [
  memoryFixture({ id: 1, syncId: 's1', name: 'TypeScript 偏好', content: '偏好 typescript 严格模式', tags: ['typescript'], accessCount: 9, source: 'ai-tool' }),
  memoryFixture({ id: 2, syncId: 's2', name: '烘焙笔记', content: '戚风蛋糕 六寸配方', tags: ['烘焙'], accessCount: 1 }),
];

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = null;
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function renderStudio(sendMessage: ReturnType<typeof vi.fn>) {
  vi.stubGlobal('chrome', {
    runtime: {
      sendMessage,
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
    },
  });
  await act(async () => {
    root = createRoot(container);
    root.render(React.createElement(MemoryStudioPage));
  });
}

function defaultSendMessage() {
  return vi.fn(async (message: { type: string }) => {
    if (message.type === 'GET_MEMORIES') return MEMORIES;
    return { ok: true };
  });
}

async function setInput(testId: string, value: string) {
  const input = container.querySelector(`[data-testid="${testId}"]`) as HTMLInputElement;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function click(el: Element | null) {
  expect(el).not.toBeNull();
  await act(async () => {
    (el as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

describe('MemoryStudioPage', () => {
  it('renders rows with source, hits, and time metadata', async () => {
    await renderStudio(defaultSendMessage());
    const rows = container.querySelectorAll('[data-testid="studio-row"]');
    expect(rows).toHaveLength(2);
    expect(container.textContent).toContain('TypeScript 偏好');
    expect(container.textContent).toContain('AI 保存');   // source=ai-tool
    expect(container.textContent).toContain('手动');       // 无 source 默认
    expect(container.textContent).toContain('命中 9 次');
    expect(container.textContent).toContain('#typescript');
  });

  it('full-text search filters rows', async () => {
    await renderStudio(defaultSendMessage());
    await setInput('studio-search', '戚风');
    const rows = container.querySelectorAll('[data-testid="studio-row"]');
    expect(rows).toHaveLength(1);
    expect(container.textContent).toContain('烘焙笔记');
    expect(container.textContent).not.toContain('TypeScript 偏好');
  });

  it('sort by hits puts the most-hit memory first', async () => {
    await renderStudio(defaultSendMessage());
    const select = container.querySelector('[data-testid="studio-sort"]') as HTMLSelectElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')!.set!;
      setter.call(select, 'hits');
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const names = [...container.querySelectorAll('[data-testid="studio-row"]')]
      .map((row) => row.textContent ?? '');
    expect(names[0]).toContain('TypeScript 偏好'); // 9 hits > 1 hit
  });

  it('bulk delete sends DELETE_MEMORIES with the selected ids', async () => {
    const sendMessage = defaultSendMessage();
    vi.stubGlobal('confirm', vi.fn(() => true));
    await renderStudio(sendMessage);

    await click(container.querySelector('[data-testid="studio-select-all"]'));
    await click(container.querySelector('[data-testid="studio-bulk-delete"]'));

    expect(sendMessage).toHaveBeenCalledWith({
      type: 'DELETE_MEMORIES',
      payload: { ids: expect.arrayContaining([1, 2]) },
    });
  });

  it('hit analysis explains selection end-to-end', async () => {
    await renderStudio(defaultSendMessage());
    await click(container.querySelector('[data-testid="studio-analysis-toggle"]'));
    await setInput('studio-analysis-input', '帮我配置 typescript 严格模式');
    await click(container.querySelector('[data-testid="studio-analysis-run"]'));

    const result = container.querySelector('[data-testid="studio-analysis-result"]');
    expect(result).not.toBeNull();
    expect(result!.textContent).toContain('TypeScript 偏好');
    // 命中的记忆展示注入内容行
    expect(result!.textContent).toContain('注入内容');
    // 关键词解释可见
    expect(result!.textContent).toContain('typescript');
  });

  it('health check runs and renders a report', async () => {
    await renderStudio(defaultSendMessage());
    await click(container.querySelector('[data-testid="studio-health-toggle"]'));
    await click(container.querySelector('[data-testid="studio-health-run"]'));
    const result = container.querySelector('[data-testid="studio-health-result"]');
    expect(result).not.toBeNull();
    // 两条互不相似的记忆 → 无问题
    expect(result!.textContent).toContain('未发现问题');
  });
});
