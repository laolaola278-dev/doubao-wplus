// core/hosts/deepseek/adapter.ts
// DeepSeek HostAdapter 实现（从现有 core/deepseek/ 提取）

import type { HostAdapter, HostAdapterMeta, HostFeatureFlags, HostPaths, HostSelectors, PageState, RequestBodyFieldMapping, SelectorHealthReport } from '../types';
import { computeSelectorHealth } from '../shared/selector-utils';

const DEEPSEEK_HOST_ID = 'deepseek' as const;
const DEEPSEEK_HOST_NAME = 'DeepSeek';

/**
 * Adapter 元数据 — 维护与兼容性跟踪。
 * DeepSeek 契约继承自上游生产基线（0.7.5 前长期生产验证），
 * 点分路径重构后由单元契约测试锁定平面字段行为不变。
 */
const DEEPSEEK_ADAPTER_META: HostAdapterMeta = {
  hostName: DEEPSEEK_HOST_NAME,
  // 1.0.0: 提取为 HostAdapter；映射值继承上游生产版本
  adapterVersion: '1.0.0',
  lastVerifiedAt: '2026-07-16',
  verifiedPages: [
    'https://chat.deepseek.com/',
    'https://chat.deepseek.com/a/chat/s/{sessionId}',
  ],
  verifiedBodyStructures: [
    '平面顶层字段：prompt / parent_message_id / chat_session_id / ref_file_ids / model_type / search_enabled / thinking_enabled',
    '首消息判定：parent_message_id=null；thinking_enabled 为布尔',
    '顶层允许新建键（model_type 写入依赖此语义）',
  ],
  evidence: [
    'tests/body-fields.test.ts（adapter mapping contract）',
    'tests/request-augmentation.test.ts（平面 body 用例）',
    'docs/releases/0.7.5.md（上游生产基线）',
  ],
};

const DEEPSEEK_MATCH_PATTERNS = [
  '*://chat.deepseek.com/*',
];

// ============================================================
// 选择器（基于上游生产版本）
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
  // 流式/生成中指示器（语义同 loadingIndicator，业务层优先使用此字段）
  streamingIndicator: [
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
    '#dwplus-tool-block',
    '[data-dwplus-tool-block="true"]',
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

/**
 * 关键选择器键名 —— 这些元素缺失时认为 DeepSeek DOM 接管能力不可用，
 * 业务层应降级为基础模式（仅记忆/Skill 注入，不接管 DOM）。
 */
const CRITICAL_SELECTOR_KEYS: ReadonlyArray<keyof HostSelectors> = [
  'inputBox',
  'sendButton',
  'messageList',
];

/**
 * DeepSeek 暂不声明辅助选择器（stopButton / conversationList 等）。
 * 状态会落在 full / fallback / unsupported 三档；partial 由未来扩展触发。
 */
const ESSENTIAL_SELECTOR_KEYS: ReadonlyArray<keyof HostSelectors> = [];

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

  /**
   * DeepSeek 请求体字段名映射。
   * 业务层（request-augmentation）通过此映射读取字段名，不硬编码。
   */
  getRequestBodyFields(): RequestBodyFieldMapping {
    return {
      prompt: 'prompt',
      parentMessageId: 'parent_message_id',
      chatSessionId: 'chat_session_id',
      refFileIds: 'ref_file_ids',
      modelType: 'model_type',
      searchEnabled: 'search_enabled',
      thinkingEnabled: 'thinking_enabled',
    };
  }

  /**
   * 探测当前页面所有选择器的命中情况，输出 4 档状态（与 doubao 一致）。
   * 任何异常都不向上抛出 —— 保证页面不会因为某个选择器写错就报错。
   */
  detectSelectors(doc: Document): SelectorHealthReport {
    const pageUrl = doc.location?.href ?? '';
    try {
      const report = computeSelectorHealth(
        this.id,
        this.getSelectors(),
        doc,
        CRITICAL_SELECTOR_KEYS,
        ESSENTIAL_SELECTOR_KEYS,
        pageUrl,
      );

      if (report.status === 'fallback' || report.status === 'unsupported') {
        if (typeof console !== 'undefined' && console.warn) {
          console.warn(
            `[DWPLUS] DeepSeek 选择器健康检查 status=${report.status}，缺失关键元素: ${report.missingCritical.join(', ') || '(无)'}。` +
            `插件将降级为基础模式（仅记忆/Skill 注入，不接管 DOM）。页面: ${pageUrl}`,
          );
        }
      }

      return report;
    } catch (err) {
      if (typeof console !== 'undefined' && console.error) {
        console.error('[DWPLUS] DeepSeek 选择器健康检查异常，降级为 unsupported', err);
      }
      return {
        hostId: this.id,
        timestamp: Date.now(),
        probes: [],
        healthy: false,
        status: 'unsupported',
        missingCritical: [...CRITICAL_SELECTOR_KEYS] as string[],
        missingEssential: [],
        pageUrl,
      };
    }
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

  /**
   * DeepSeek 专属 feature flags
   * 业务层（content.ts / content/features/deepseek/*）根据这些 flag 决定是否启用。
   */
  getFeatures(): HostFeatureFlags {
    return DEEPSEEK_FEATURES;
  }

  getMeta(): HostAdapterMeta {
    return DEEPSEEK_ADAPTER_META;
  }
}

const DEEPSEEK_FEATURES: HostFeatureFlags = {
  historyOrganizer: true,
  projectSidebarOrganizer: true,
  themeSync: true,
  hostSpecificCssInjection: true,
};
