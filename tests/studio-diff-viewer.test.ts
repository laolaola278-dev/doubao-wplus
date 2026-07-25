// DiffViewer 组件测试：复用 prompt-diff 引擎的 +/-/~ 行渲染与折叠。
import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import DiffViewer from '../entrypoints/sidepanel/components/studio/DiffViewer';

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
});

async function render(props: { oldText: string; newText: string; collapseContext?: number }) {
  await act(async () => {
    root = createRoot(container);
    root.render(React.createElement(DiffViewer, props));
  });
}

describe('DiffViewer', () => {
  it('渲染新增/删除行并输出统计摘要', async () => {
    await render({ oldText: 'a\nb', newText: 'a\nb\nc' });

    expect(container.querySelector('[data-testid="studio-diff-summary"]')?.textContent).toContain('+1 / -0 / ~0');
    const added = container.querySelectorAll('[data-diff-kind="added"]');
    expect(added).toHaveLength(1);
    expect(added[0].textContent).toContain('c');
  });

  it('相邻 -/+ 合并为修改行（~），展示旧→新', async () => {
    await render({ oldText: 'hello world', newText: 'hello there' });

    const changed = container.querySelectorAll('[data-diff-kind="changed"]');
    expect(changed).toHaveLength(1);
    expect(changed[0].textContent).toContain('hello world → hello there');
  });

  it('折叠长段相同行', async () => {
    const same = Array.from({ length: 20 }, (_, i) => `line-${i}`).join('\n');
    await render({ oldText: same, newText: `${same}\nnew-tail`, collapseContext: 2 });

    const collapsed = container.querySelector('[data-testid="studio-diff-collapsed"]');
    expect(collapsed).toBeTruthy();
    expect(collapsed?.textContent).toContain('16');
  });
});
