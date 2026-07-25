// tests/prompt-inspector-panel.test.ts
// Prompt Inspector UI 面板 — jsdom 单元测试
//
// 验证：
//   - 门控关闭时 install/open 均为 no-op（无 DOM、无监听）
//   - 开启时 Ctrl+Shift+P 懒创建面板并切换显隐
//   - Timeline 渲染 5 个阶段节点；节点点击展开/折叠
//   - 快照选择与刷新

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  destroyPromptInspectorPanel,
  getPromptInspectorPanelElement,
  installPromptInspectorPanel,
  openPromptInspectorPanel,
  togglePromptInspectorPanel,
} from '../core/ui/prompt-inspector-panel';
import {
  buildPromptSnapshot,
  clearPromptSnapshots,
  recordPromptSnapshot,
} from '../core/diagnostics/prompt-inspector';
import { augmentRequestBody } from '../core/interceptor/request-augmentation';
import { setActiveHostId } from '../core/hosts/registry';

function setDevEnabled(v: boolean): void {
  if (v) {
    (globalThis as Record<string, unknown>)['__DOUBAO_WPLUS_E2E__'] = '1';
  } else {
    delete (globalThis as Record<string, unknown>)['__DOUBAO_WPLUS_E2E__'];
  }
}

function recordOneSnapshot(prompt: string): void {
  const result = augmentRequestBody(
    JSON.stringify({ prompt, parent_message_id: null, thinking_enabled: false }),
    {
      memories: [], skills: [], activePreset: null, modelType: null,
      toolDescriptors: [], messageCount: 0, locale: 'en', captureInspection: true,
    },
  );
  recordPromptSnapshot(buildPromptSnapshot({
    inspection: result!.inspection!,
    usedMemoryIds: result!.usedMemoryIds,
    augmentDurationMs: 1,
  }));
}

beforeEach(() => {
  setActiveHostId('deepseek');
  clearPromptSnapshots();
  destroyPromptInspectorPanel();
  document.getElementById('dwplus-prompt-inspector-css')?.remove();
});
afterEach(() => {
  setDevEnabled(false);
  clearPromptSnapshots();
  destroyPromptInspectorPanel();
});

describe('gating', () => {
  it('production: open/toggle are no-ops, no DOM created', () => {
    setDevEnabled(false);
    installPromptInspectorPanel(document);
    openPromptInspectorPanel(document);
    togglePromptInspectorPanel(document);
    expect(getPromptInspectorPanelElement()).toBeNull();
    expect(document.getElementById('dwplus-prompt-inspector')).toBeNull();
    expect(document.getElementById('dwplus-prompt-inspector-css')).toBeNull();
  });
});

describe('panel behavior (dev enabled)', () => {
  beforeEach(() => setDevEnabled(true));

  it('lazily creates the panel on open and injects styles once', () => {
    expect(getPromptInspectorPanelElement()).toBeNull();
    openPromptInspectorPanel(document);
    const panel = getPromptInspectorPanelElement()!;
    expect(panel).not.toBeNull();
    expect(panel.style.display).toBe('flex');
    openPromptInspectorPanel(document);
    // 幂等：不重复建面板/样式
    expect(document.querySelectorAll('#dwplus-prompt-inspector')).toHaveLength(1);
    expect(document.querySelectorAll('#dwplus-prompt-inspector-css')).toHaveLength(1);
  });

  it('Ctrl+Shift+P toggles visibility after install', () => {
    installPromptInspectorPanel(document);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'P', ctrlKey: true, shiftKey: true }));
    expect(getPromptInspectorPanelElement()!.style.display).toBe('flex');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'P', ctrlKey: true, shiftKey: true }));
    expect(getPromptInspectorPanelElement()!.style.display).toBe('none');
  });

  it('renders empty hint without snapshots, and 5 stage nodes with one', () => {
    openPromptInspectorPanel(document);
    expect(getPromptInspectorPanelElement()!.querySelector('.dwplus-pi-empty')).not.toBeNull();

    recordOneSnapshot('panel render test');
    openPromptInspectorPanel(document); // open 触发 refresh
    const stages = getPromptInspectorPanelElement()!.querySelectorAll('.dwplus-pi-stage');
    expect(stages).toHaveLength(5);
    const labels = [...stages].map((s) => s.querySelector('.dwplus-pi-stage-label')!.textContent);
    expect(labels).toEqual(['Raw Input', 'Skill', 'Memory / System', 'Preset', 'Final Prompt']);
  });

  it('clicking a stage head expands its body with prompt text and diff', () => {
    recordOneSnapshot('expand me');
    openPromptInspectorPanel(document);
    const panel = getPromptInspectorPanelElement()!;
    const finalStage = panel.querySelectorAll('.dwplus-pi-stage')[4];
    const head = finalStage.querySelector('.dwplus-pi-stage-head') as HTMLElement;
    const body = finalStage.querySelector('.dwplus-pi-stage-body') as HTMLElement;
    expect(body.style.display).toBe('none');
    head.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(body.style.display).toBe('block');
    expect(body.querySelector('.dwplus-pi-prompt')!.textContent).toContain('expand me');
    // final 节点有与上一阶段的 diff
    expect(body.querySelector('.dwplus-pi-diff')).not.toBeNull();
    head.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(body.style.display).toBe('none');
  });

  it('snapshot selector lists entries newest-first', () => {
    recordOneSnapshot('older');
    recordOneSnapshot('newer');
    openPromptInspectorPanel(document);
    const select = getPromptInspectorPanelElement()!.querySelector('.dwplus-pi-select') as HTMLSelectElement;
    expect(select.options).toHaveLength(2);
    expect(select.options[0].value).toBe('2'); // 最新 seq 在前且默认选中
    expect(select.value).toBe('2');
  });
});
