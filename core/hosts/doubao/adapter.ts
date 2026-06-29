// core/hosts/doubao/adapter.ts
// 豆包 HostAdapter 实现
// DOM 结构基于 2026-06-29 调研（Semi Design + Tailwind + dbx- 自定义前缀）

import type { HostAdapter, HostPaths, HostSelectors, PageState } from '../types';

const DOUBAO_HOST_ID = 'doubao' as const;
const DOUBAO_HOST_NAME = '豆包 (Doubao)';

const DOUBAO_MATCH_PATTERNS = [
  '*://www.doubao.com/*',
  '*://*.doubao.com/*',
];

// ============================================================
// 选择器（fallback 数组，按稳定性排列）
// ============================================================

const DOUBAO_SELECTORS: HostSelectors = {
  // 对话容器
  messageList: [
    'div[class*="message-list"]',
    'div[data-testid="message-list"]',
  ],

  // 消息行（每一轮对话，包含用户或 AI）
  messageRow: [
    'div.my-0.w-full.mx-auto',
    'div[class*="message-row"]',
  ],
  // 消息 ID 在 DOM 上的属性名（豆包优先使用稳定 data-message-id，id 作为最终兑底）
  messageIdAttribute: [
    'data-message-id',
    'data-messageid',
    'data-id',
    'id',
  ],

  // 用户消息气泡 — 关键特征：bg-g-send 背景色类
  userMessage: [
    'div.bg-g-send',
    'div[class*="user-message"]',
  ],

  // AI 消息气泡 — 没有 bg-g-send 的 whitespace-pre-wrap 元素
  assistantMessage: [
    'div.my-0.w-full.mx-auto div.whitespace-pre-wrap:not(.bg-g-send)',
    'div[class*="assistant-message"]',
  ],

  // 文本输入框 — Semi Design 组件库
  inputBox: [
    'textarea.semi-input-textarea',
    'textarea[placeholder*="发消息"]',
    'textarea[class*="input-textarea"]',
  ],

  // 发送按钮 — dbx- 前缀 + Tailwind 特征
  sendButton: [
    'button[class*="rounded-dbx-sm"][class*="cursor-pointer"]',
    'button[data-testid="send-button"]',
    'button[aria-label*="发送"]',
  ],

  // 最新一条助手消息
  latestAssistantMessage: [
    'div.my-0.w-full.mx-auto:last-child div.whitespace-pre-wrap:not(.bg-g-send)',
    'div[class*="assistant-message"]:last-of-type',
  ],

  // 生成中指示器
  loadingIndicator: [
    'div[class*="generating"]',
    'div[class*="loading"]',
    'div[class*="typing"]',
  ],

  // 工具块容器（插件注入的 dpp 工具块）
  toolBlock: [
    '#dpp-tool-block',
    '[data-dpp-tool-block="true"]',
  ],

  // 代码块
  codeBlock: [
    'pre code',
    'pre[class*="language-"]',
    'div[class*="code-block"]',
  ],

  // 复制按钮
  copyButton: [
    'button[aria-label*="复制"]',
    'button[title*="复制"]',
    'button[data-testid="copy"]',
  ],

  // 重新生成按钮
  regenerateButton: [
    'button[aria-label*="重新生成"]',
    'button[aria-label*="Regenerate"]',
    'button[data-testid="regenerate"]',
  ],

  // 对话标题 — H1 / 特定 class
  conversationTitle: [
    'h1[class*="conversation-title"]',
    'div[class*="chat-title"]',
  ],

  // 操作按钮行
  actionRow: [
    'div[class*="action-row"]',
    'div[class*="message-actions"]',
    'div[class*="message-footer"]',
  ],

  // 侧边栏/历史条目
  historyItem: [
    'div[class*="history-item"]',
    'a[href*="/chat/"]',
  ],

  // 错误态提示
  errorState: [
    'div[class*="error-message"]',
    'div[role="alert"]',
  ],

  // 空会话提示
  emptyState: [
    'div[class*="empty-conversation"]',
    'div[class*="welcome"]',
  ],

  // 登录引导态
  loginState: [
    'button[class*="login"]',
    'a[href*="login"]',
    'div[class*="login-prompt"]',
  ],

  // 限流提示
  rateLimitState: [
    'div[class*="rate-limit"]',
    'div[class*="too-many-requests"]',
  ],

  // 禁用输入态
  disabledInput: [
    'textarea[disabled]',
    'textarea[aria-disabled="true"]',
  ],
};

// ============================================================
// 请求路径（占位值，需在运行时通过 fetch-hook 探测确认）
// ============================================================

const DOUBAO_PATHS: HostPaths = {
  completion: '/api/v1/chat/completion',
  regenerate: '/api/v1/chat/regenerate',
  history: '/api/v1/chat/history',
};

// ============================================================
// Adapter 实现
// ============================================================

export class DoubaoAdapter implements HostAdapter {
  readonly id = DOUBAO_HOST_ID;
  readonly name = DOUBAO_HOST_NAME;
  readonly matchPatterns = DOUBAO_MATCH_PATTERNS;

  matchUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      return parsed.hostname === 'www.doubao.com' || parsed.hostname.endsWith('.doubao.com');
    } catch {
      return false;
    }
  }

  isChatStreamUrl(url: string): boolean {
    if (!this.matchUrl(url)) return false;
    return url.includes(DOUBAO_PATHS.completion) || url.includes(DOUBAO_PATHS.regenerate);
  }

  isHistoryUrl(url: string): boolean {
    if (!this.matchUrl(url)) return false;
    return url.includes(DOUBAO_PATHS.history);
  }

  getSessionId(location: Location): string | null {
    // 豆包 URL 结构待确认后更新
    // 可能的格式：/chat/{sessionId}  或  /chat/bot/{botId}/conversation/{convId}
    const match = location.pathname.match(/\/chat\/(?:bot\/[^/]+\/conversation\/)?([^/?#]+)/);
    if (!match?.[1]) return null;
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return match[1];
    }
  }

  /** 返回清理过的 document.title（去除宿主品牌后缀），不提供 fallback 字符串 */
  getConversationTitle(doc: Document): string {
    return doc.title
      .replace(/\s*[-|]\s*豆包.*$/i, '')
      .replace(/\s*[-|]\s*Doubao.*$/i, '')
      .trim();
  }

  getSelectors(): HostSelectors {
    return DOUBAO_SELECTORS;
  }

  getPaths(): HostPaths {
    return DOUBAO_PATHS;
  }

  detectPageState(doc: Document): PageState {
    // 检测登录态
    const loginButton = doc.querySelector('button[class*="login"], a[href*="login"]');
    if (loginButton) return 'logged_out';

    // 检测生成中
    const loading = doc.querySelector(DOUBAO_SELECTORS.loadingIndicator.join(','));
    if (loading) return 'generating';

    // 检测空对话
    const container = doc.querySelector(DOUBAO_SELECTORS.messageList.join(','));
    if (!container || container.children.length === 0) return 'empty_conversation';

    return 'idle';
  }
}
