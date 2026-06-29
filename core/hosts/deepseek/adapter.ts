// core/hosts/deepseek/adapter.ts
// DeepSeek HostAdapter 实现（从现有 core/deepseek/ 提取）

import type { HostAdapter, HostPaths, HostSelectors, PageState } from '../types';

const DEEPSEEK_HOST_ID = 'deepseek' as const;
const DEEPSEEK_HOST_NAME = 'DeepSeek';

const DEEPSEEK_MATCH_PATTERNS = [
  '*://chat.deepseek.com/*',
];

// ============================================================
// 选择器（基于原 deepseek-pp 项目）
// ============================================================

const DEEPSEEK_SELECTORS: HostSelectors = {
  messageList: [
    'div[class*="message-list"]',
    'div.ds-message-list',
  ],
  messageRow: [
    'div.my-0.w-full.mx-auto',
    'div.ds-message-row',
  ],
  // 消息 ID 在 DOM 上的属性名（DeepSeek 使用 data-ds-message-id）
  messageIdAttribute: [
    'data-ds-message-id',
    'data-message-id',
    'data-messageid',
    'data-id',
    'id',
  ],
  // DeepSeek 用户消息：有 ._74c0879 类（CSS Modules 随机）
  userMessage: [
    'div._74c0879',
    'div[class*="user-message"]',
  ],
  // DeepSeek 助手消息
  assistantMessage: [
    'div.ds-assistant-message-main-content',
    'div[class*="assistant-message"]',
  ],
  // DeepSeek 输入框
  inputBox: [
    'textarea.ds-textarea',
    'textarea[placeholder*="输入"]',
    'textarea[class*="chat-input"]',
  ],
  // DeepSeek 发送按钮
  sendButton: [
    'button.ds-button',
    'button[class*="send-button"]',
    'button[aria-label*="发送"]',
  ],
  // DeepSeek 加载指示器
  loadingIndicator: [
    'div.ds-loading',
    'div[class*="generating"]',
  ],
  // 最新一条助手消息
  latestAssistantMessage: [
    '.ds-message:last-child .ds-assistant-message-main-content',
    'div[class*="assistant-message"]:last-of-type',
  ],
  // 工具块容器（插件注入的 dpp 工具块）
  toolBlock: [
    '#dpp-tool-block',
    '[data-dpp-tool-block="true"]',
  ],
  // 代码块
  codeBlock: [
    'pre code',
    'pre.ds-code-block',
    'div[class*="code-block"]',
  ],
  // 复制按钮
  copyButton: [
    'button.ds-button[aria-label*="复制"]',
    'button[aria-label*="Copy"]',
    'button[data-testid="copy"]',
  ],
  // 重新生成按钮
  regenerateButton: [
    'button.ds-button[aria-label*="重新生成"]',
    'button[aria-label*="Regenerate"]',
    'button[data-testid="regenerate"]',
  ],
  // 对话标题
  conversationTitle: [
    'div[class*="conversation-title"]',
    'h1.ds-conversation-title',
  ],
  // 操作按钮行
  actionRow: [
    'div.ds-message-actions',
    'div[class*="action-row"]',
  ],
  // 侧边栏/历史条目
  historyItem: [
    'div.ds-history-item',
    'a[href*="/a/chat/s/"]',
  ],
  // 错误态提示
  errorState: [
    'div.ds-error-message',
    'div[role="alert"]',
  ],
  // 空会话提示
  emptyState: [
    'div.ds-empty-state',
    'div[class*="welcome"]',
  ],
  // 登录引导态
  loginState: [
    'button.ds-button-login',
    'a[href*="login"]',
  ],
  // 限流提示
  rateLimitState: [
    'div.ds-rate-limit',
    'div[class*="too-many-requests"]',
  ],
  // 禁用输入态
  disabledInput: [
    'textarea.ds-textarea[disabled]',
    'textarea[aria-disabled="true"]',
  ],
};

// ============================================================
// 请求路径
// ============================================================

const DEEPSEEK_PATHS: HostPaths = {
  completion: '/api/v0/chat/completion',
  regenerate: '/api/v0/chat/regenerate',
  history: '/api/v0/chat/history_messages',
};

// ============================================================
// Adapter 实现
// ============================================================

export class DeepSeekAdapter implements HostAdapter {
  readonly id = DEEPSEEK_HOST_ID;
  readonly name = DEEPSEEK_HOST_NAME;
  readonly matchPatterns = DEEPSEEK_MATCH_PATTERNS;

  matchUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      return parsed.hostname === 'chat.deepseek.com';
    } catch {
      return false;
    }
  }

  isChatStreamUrl(url: string): boolean {
    if (!this.matchUrl(url)) return false;
    return url.includes(DEEPSEEK_PATHS.completion) || url.includes(DEEPSEEK_PATHS.regenerate);
  }

  isHistoryUrl(url: string): boolean {
    if (!this.matchUrl(url)) return false;
    return url.includes(DEEPSEEK_PATHS.history);
  }

  getSessionId(location: Location): string | null {
    // /a/chat/s/{sessionId}  或  /chat/s/{sessionId}
    const match = location.pathname.match(/\/(?:a\/)?chat\/s\/([^/?#]+)/);
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
      .replace(/\s*[-|]\s*DeepSeek.*$/i, '')
      .trim();
  }

  getSelectors(): HostSelectors {
    return DEEPSEEK_SELECTORS;
  }

  getPaths(): HostPaths {
    return DEEPSEEK_PATHS;
  }

  detectPageState(doc: Document): PageState {
    const loginButton = doc.querySelector('button[class*="login"], a[href*="login"]');
    if (loginButton) return 'logged_out';

    const loading = doc.querySelector(DEEPSEEK_SELECTORS.loadingIndicator.join(','));
    if (loading) return 'generating';

    const container = doc.querySelector(DEEPSEEK_SELECTORS.messageList.join(','));
    if (!container || container.children.length === 0) return 'empty_conversation';

    return 'idle';
  }
}
