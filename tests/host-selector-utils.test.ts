// tests/host-selector-utils.test.ts
// 选择器 fallback 工具函数测试

import { describe, expect, it, beforeEach } from 'vitest';
import { queryFirst, queryAll, computeSelectorHealth } from '../core/hosts/shared/selector-utils';
import type { HostSelectors } from '../core/hosts/types';

function makeRoot(html: string): HTMLElement {
  const div = document.createElement('div');
  div.innerHTML = html;
  document.body.appendChild(div);
  return div;
}

describe('queryFirst', () => {
  it('返回第一个命中的元素', () => {
    const root = makeRoot('<div class="a"></div><div class="b"></div>');
    const el = queryFirst(['.a', '.b'], root);
    expect(el?.className).toBe('a');
  });

  it('首选不命中则回退到下一个', () => {
    const root = makeRoot('<div class="b"></div>');
    const el = queryFirst(['.a', '.b'], root);
    expect(el?.className).toBe('b');
  });

  it('全部不命中返回 null', () => {
    const root = makeRoot('<div></div>');
    expect(queryFirst(['.a', '.b'], root)).toBeNull();
  });

  it('跳过非法选择器', () => {
    const root = makeRoot('<div class="real"></div>');
    const el = queryFirst([':::invalid:::', '.real'], root);
    expect(el).not.toBeNull();
    expect(el?.className).toBe('real');
  });

  it('空数组返回 null', () => {
    const root = makeRoot('<div></div>');
    expect(queryFirst([], root)).toBeNull();
  });
});

describe('queryAll', () => {
  it('返回第一个有结果的数组（按优先级）', () => {
    const root = makeRoot('<span class="x"></span><span class="y"></span>');
    const els = queryAll(['.none', '.x', '.y'], root);
    expect(els).toHaveLength(1);
    expect(els[0]?.className).toBe('x');
  });

  it('全部不命中返回空数组', () => {
    const root = makeRoot('<div></div>');
    expect(queryAll(['.a', '.b'], root)).toEqual([]);
  });

  it('跳过非法选择器', () => {
    const root = makeRoot('<i class="ok"></i>');
    const els = queryAll([':::bad:::', '.ok'], root);
    expect(els).toHaveLength(1);
  });
});

describe('选择器稳定性 — 豆包 DOM 改版 fallback', () => {
  it('首选选择器失效时，回退到通用选择器', () => {
    // 模拟豆包改版：data-testid 选择器失效，回退到属性包含
    const root = makeRoot('<textarea class="semi-input-textarea"></textarea>');
    const el = queryFirst(
      [
        'textarea[data-testid="new-version"]',  // 新版，未命中
        'textarea.semi-input-textarea',         // 旧版，命中
      ],
      root,
    );
    expect(el).not.toBeNull();
    expect(el?.tagName.toLowerCase()).toBe('textarea');
  });
});

// ============================================================
// computeSelectorHealth — 4 档状态测试
// ============================================================

const TEST_SELECTORS: HostSelectors = {
  messageList: ['div.message-list'],
  messageRow: ['div.message-row'],
  messageIdAttribute: ['data-message-id'],
  userMessage: ['div.user-message'],
  assistantMessage: ['div.assistant-message'],
  latestAssistantMessage: ['div.assistant-message:last-of-type'],
  loadingIndicator: ['div.loading'],
  streamingIndicator: ['div.loading'],
  inputBox: ['textarea.chat-input'],
  sendButton: ['button.send-button'],
  stopButton: ['button.stop-button'],
  mainContainer: ['main.chat-main'],
  conversationList: ['nav.conversation-list'],
  currentConversation: ['a.active-conversation'],
  themeMarker: ['html[data-theme="dark"]', 'html[data-theme="light"]'],
  toolBlock: ['#dwplus-tool-block'],
  codeBlock: ['pre code'],
  copyButton: ['button[aria-label*="复制"]'],
  regenerateButton: ['button[aria-label*="重新生成"]'],
  conversationTitle: ['h1.conversation-title'],
  actionRow: ['div.action-row'],
  historyItem: ['div.history-item'],
  errorState: ['div.error-message'],
  emptyState: ['div.empty-state'],
  loginState: ['a[href*="login"]'],
  rateLimitState: ['div.rate-limit'],
  disabledInput: ['textarea[disabled]'],
};

const CRITICAL_KEYS: ReadonlyArray<keyof HostSelectors> = ['inputBox', 'sendButton', 'messageList'];
const ESSENTIAL_KEYS: ReadonlyArray<keyof HostSelectors> = [
  'stopButton',
  'userMessage',
  'assistantMessage',
  'conversationList',
  'currentConversation',
  'mainContainer',
  'themeMarker',
];

function setBodyHtml(html: string): void {
  document.body.innerHTML = html;
}

describe('computeSelectorHealth — 4 档状态', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    document.documentElement.removeAttribute('data-theme');
  });

  it('status=full when 关键 + 辅助 全部命中', () => {
    setBodyHtml(`
      <main class="chat-main">
        <div class="message-list">
          <div class="message-row">
            <div class="user-message">hi</div>
            <div class="assistant-message">hello</div>
          </div>
        </div>
        <textarea class="chat-input"></textarea>
        <button class="send-button">发送</button>
        <button class="stop-button">停止</button>
        <nav class="conversation-list">
          <a class="active-conversation" href="/chat/abc">会话1</a>
        </nav>
      </main>
    `);
    document.documentElement.setAttribute('data-theme', 'dark');

    const report = computeSelectorHealth(
      'doubao',
      TEST_SELECTORS,
      document,
      CRITICAL_KEYS,
      ESSENTIAL_KEYS,
      'https://www.doubao.com/chat/abc',
    );

    expect(report.status).toBe('full');
    expect(report.healthy).toBe(true);
    expect(report.missingCritical).toEqual([]);
    expect(report.missingEssential).toEqual([]);
  });

  it('status=partial when 关键全部命中，部分辅助缺失', () => {
    // 缺 stopButton / conversationList / currentConversation / themeMarker
    setBodyHtml(`
      <main class="chat-main">
        <div class="message-list">
          <div class="user-message">hi</div>
          <div class="assistant-message">hello</div>
        </div>
        <textarea class="chat-input"></textarea>
        <button class="send-button">发送</button>
      </main>
    `);

    const report = computeSelectorHealth(
      'doubao',
      TEST_SELECTORS,
      document,
      CRITICAL_KEYS,
      ESSENTIAL_KEYS,
      'https://www.doubao.com/chat/abc',
    );

    expect(report.status).toBe('partial');
    expect(report.healthy).toBe(true); // 关键仍在
    expect(report.missingCritical).toEqual([]);
    expect(report.missingEssential).toEqual(expect.arrayContaining([
      'stopButton',
      'conversationList',
      'currentConversation',
      'themeMarker',
    ]));
  });

  it('status=fallback when 部分关键缺失', () => {
    // 缺 inputBox + sendButton（关键缺失2/3）
    setBodyHtml(`
      <main class="chat-main">
        <div class="message-list">
          <div class="user-message">hi</div>
          <div class="assistant-message">hello</div>
        </div>
        <button class="stop-button">停止</button>
        <nav class="conversation-list"></nav>
        <a class="active-conversation" href="/chat/x"></a>
      </main>
    `);
    document.documentElement.setAttribute('data-theme', 'light');

    const report = computeSelectorHealth(
      'doubao',
      TEST_SELECTORS,
      document,
      CRITICAL_KEYS,
      ESSENTIAL_KEYS,
      'https://www.doubao.com/chat/abc',
    );

    expect(report.status).toBe('fallback');
    expect(report.healthy).toBe(false);
    expect(report.missingCritical).toEqual(expect.arrayContaining(['inputBox', 'sendButton']));
    expect(report.missingCritical).not.toContain('messageList');
  });

  it('status=unsupported when 全部关键缺失', () => {
    // 页面上完全没有豆包 DOM 结构
    setBodyHtml('<div>some random page</div>');

    const report = computeSelectorHealth(
      'doubao',
      TEST_SELECTORS,
      document,
      CRITICAL_KEYS,
      ESSENTIAL_KEYS,
      'https://example.com/',
    );

    expect(report.status).toBe('unsupported');
    expect(report.healthy).toBe(false);
    expect(report.missingCritical).toEqual(expect.arrayContaining([
      'inputBox',
      'sendButton',
      'messageList',
    ]));
  });

  it('probes 含 matchedSelector 用于调试回显', () => {
    setBodyHtml('<textarea class="chat-input"></textarea>');
    const report = computeSelectorHealth(
      'doubao',
      TEST_SELECTORS,
      document,
      CRITICAL_KEYS,
      ESSENTIAL_KEYS,
      'https://www.doubao.com/',
    );
    const inputProbe = report.probes.find(p => p.key === 'inputBox');
    expect(inputProbe).toBeDefined();
    expect(inputProbe!.found).toBe(true);
    expect(inputProbe!.matchedSelector).toBe('textarea.chat-input');
    expect(inputProbe!.matchCount).toBe(1);
  });

  it('optional 选择器未定义时不报错（deepseek 场景）', () => {
    const deepseekLikeSelectors: HostSelectors = {
      ...TEST_SELECTORS,
      stopButton: undefined as unknown as string[],
      conversationList: undefined as unknown as string[],
      currentConversation: undefined as unknown as string[],
      mainContainer: undefined as unknown as string[],
      themeMarker: undefined as unknown as string[],
    };
    setBodyHtml(`
      <div class="message-list"></div>
      <textarea class="chat-input"></textarea>
      <button class="send-button">发送</button>
    `);

    const report = computeSelectorHealth(
      'deepseek',
      deepseekLikeSelectors,
      document,
      CRITICAL_KEYS,
      [], // deepseek 没有 essential keys
      'https://chat.deepseek.com/',
    );

    expect(report.status).toBe('full');
    expect(report.missingEssential).toEqual([]);
  });

  it('非法选择器不抛错', () => {
    const badSelectors: HostSelectors = {
      ...TEST_SELECTORS,
      inputBox: [':::invalid:::', 'textarea.chat-input'],
    };
    setBodyHtml('<textarea class="chat-input"></textarea>');

    expect(() => {
      computeSelectorHealth(
        'doubao',
        badSelectors,
        document,
        CRITICAL_KEYS,
        ESSENTIAL_KEYS,
        'https://www.doubao.com/',
      );
    }).not.toThrow();
  });
});
