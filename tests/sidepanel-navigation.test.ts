import { readFileSync } from 'node:fs';
import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../entrypoints/sidepanel/App';
import LibraryPage from '../entrypoints/sidepanel/pages/LibraryPage';
import CapabilitiesPage from '../entrypoints/sidepanel/pages/CapabilitiesPage';
import SettingsPage from '../entrypoints/sidepanel/pages/SettingsPage';

let container: HTMLDivElement;
let root: Root | null;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = null;

  vi.stubGlobal('chrome', {
    runtime: {
      getManifest: vi.fn(() => ({ version: '0.7.0' })),
      sendMessage: vi.fn(async (message: { type?: string }) => {
        if (message.type === 'GET_AUTH_STATUS') return { available: true, provider: 'doubao-web' };
        if (message.type === 'GET_VOICE_SETTINGS') return {};
        return null;
      }),
      onMessage: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    },
    storage: {
      local: {
        get: vi.fn(async (key: string) => (
          key === 'deepseek_pp_chat_enabled'
            ? { deepseek_pp_chat_enabled: true }
            : {}
        )),
        remove: vi.fn(async () => {}),
      },
      onChanged: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    },
  });
});

afterEach(() => {
  if (root) {
    act(() => root?.unmount());
  }
  container.remove();
  vi.unstubAllGlobals();
});

describe('sidepanel navigation', () => {
  it('keeps memory/saved under Library and preset/automation under Capabilities', async () => {
    await renderApp();

    const topLabels = navButtonLabels('侧栏导航');
    expect(topLabels).toEqual(['对话', '资料', '项目', '能力', 'Studio', '设置']);

    unmountRoot();
    await renderElement(React.createElement(LibraryPage, { onInsertPrompt: vi.fn() }));
    expect(navButtonLabels('资料子导航')).toEqual(['记忆', '保存']);

    unmountRoot();
    await renderElement(React.createElement(CapabilitiesPage));
    expect(navButtonLabels('能力子导航')).toEqual(['Skill', 'MCP', '工具', '浏览器', '预设', '自动化', '规则']);
  });

  it('keeps the pet custom icon surface reachable from Settings', async () => {
    await renderElement(React.createElement(SettingsPage));

    expect(container.textContent).toContain('宠物');
    expect(container.textContent).toContain('上传图标');
  });

  it('keeps the top navigation from shrinking behind long settings content', () => {
    const css = readFileSync('entrypoints/sidepanel/style.css', 'utf8');
    const navBlock = getCssBlock(css, '.side-tabs');
    const mainBlock = getCssBlock(css, '.ds-app-main');

    expect(navBlock).toContain('flex: 0 0 44px');
    expect(navBlock).toContain('min-height: 44px');
    expect(mainBlock).toContain('flex: 1 1 0');
  });
});

async function renderApp() {
  await renderElement(React.createElement(App));
}

async function renderElement(element: React.ReactElement) {
  await act(async () => {
    root = createRoot(container);
    root.render(element);
  });
}

function navButtonLabels(label: string): string[] {
  const nav = container.querySelector(`nav[aria-label="${label}"]`);
  expect(nav).toBeTruthy();
  return Array.from(nav!.querySelectorAll('button')).map((button) => button.textContent ?? '');
}

function unmountRoot() {
  if (root) {
    act(() => root?.unmount());
    root = null;
    container.innerHTML = '';
  }
}

function getCssBlock(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{(?<body>[^}]*)\\}`));
  expect(match?.groups?.body).toBeTruthy();
  return match!.groups!.body;
}
