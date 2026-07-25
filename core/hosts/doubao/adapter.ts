// core/hosts/doubao/adapter.ts
// 豆包 HostAdapter 实现
// DOM 结构基于 2026-06-29 调研（Semi Design + Tailwind + dbx- 自定义前缀）
// 选择器策略：属性优先（[data-testid] / [aria-label] / [placeholder]）+ 类名兜底，
// 并通过 detectSelectors() 在运行期做健康检查，缺失关键元素时降级并 console.warn

import type {
  HostAdapter,
  HostAdapterMeta,
  HostFeatureFlags,
  HostPaths,
  RequestBodyFieldMapping,
  HostSelectors,
  PageState,
  SelectorHealthReport,
} from '../types';
import { computeSelectorHealth } from '../shared/selector-utils';

const DOUBAO_HOST_ID = 'doubao' as const;
const DOUBAO_HOST_NAME = '豆包 (Doubao)';

/**
 * Adapter 元数据 — 维护与兼容性跟踪。
 * adapterVersion 在映射/路径/选择器等宿主契约修改时递增；
 * lastVerifiedAt / verifiedBodyStructures 每次真机回归后更新。
 */
const DOUBAO_ADAPTER_META: HostAdapterMeta = {
  hostName: DOUBAO_HOST_NAME,
  // 1.0.0: 2026-07-16 P0 修复（真实 completion 路径 + 嵌套 prompt 点分路径映射）
  adapterVersion: '1.0.0',
  lastVerifiedAt: '2026-07-16',
  verifiedPages: [
    'https://www.doubao.com/chat/',
    'https://www.doubao.com/chat/{conversationId}',
  ],
  verifiedBodyStructures: [
    '新会话首条：conversation_id="" + last_message_index=null + option.need_create_conversation=true',
    '多轮（第2/3条）：conversation_id=数字 ID + last_message_index=数字',
    'Skill 命令：/command 文本位于 messages[0].content_block[0].content.text_block.text（与普通消息同构）',
    '长文本（2824 字实测）：仍为单 content_block（block_type=10000）',
    '签名：a_bogus/msToken/fp 在 URL query，不绑定 body hash（修改 body 后服务端接受）',
  ],
  evidence: [
    'docs/progress/doubao-phase2-real-browser-2026-07-16.md',
    'playwright-results/phase2-06-body-structures.json',
    'playwright-results/phase2-06b-longtext.json',
    'playwright-results/phase2-07-augmentation-verify.json',
  ],
};

const DOUBAO_MATCH_PATTERNS = [
  '*://www.doubao.com/*',
  '*://*.doubao.com/*',
];

/**
 * 关键选择器键名 —— 这些元素缺失时认为豆包 DOM 接管能力不可用，
 * 业务层应降级为基础模式（仅记忆/Skill 注入，不接管 DOM）。
 */
const CRITICAL_SELECTOR_KEYS: ReadonlyArray<keyof HostSelectors> = [
  'inputBox',
  'sendButton',
  'messageList',
];

/**
 * 辅助选择器键名 —— 缺失不影响核心路径（记忆/Skill 注入），
 * 但会影响完整 DOM 接管体验（停止生成、会话切换、主题同步等增强）。
 */
const ESSENTIAL_SELECTOR_KEYS: ReadonlyArray<keyof HostSelectors> = [
  'stopButton',
  'userMessage',
  'assistantMessage',
  'conversationList',
  'currentConversation',
  'mainContainer',
  'themeMarker',
];

// ============================================================
// 选择器（fallback 数组，按稳定性排列）
// ============================================================

const DOUBAO_SELECTORS: HostSelectors = {
  // 对话容器 — 真实 DOM 使用 flow-scrollbar + overflow-y-auto 的滚动容器
  messageList: [
    'div[class*="flow-scrollbar"]',
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

  // 用户消息气泡 — 优先用 data 属性，再兜底背景色类
  userMessage: [
    'div[data-testid="user-message"]',
    'div[class*="user-message"]',
    'div.bg-g-send',
  ],

  // AI 消息气泡 — 优先用 data 属性，再兜底 whitespace-pre-wrap
  assistantMessage: [
    'div[data-testid="assistant-message"]',
    'div[class*="assistant-message"]',
    'div.my-0.w-full.mx-auto div.whitespace-pre-wrap:not(.bg-g-send)',
  ],

  // 文本输入框 — 优先用 Semi Design data 属性和 placeholder，再兜底 class
  inputBox: [
    'textarea[data-testid="chat-input"]',
    'textarea[placeholder*="发消息"]',
    'textarea[placeholder*="给豆包发消息"]',
    'textarea.semi-input-textarea',
    'textarea[class*="input-textarea"]',
  ],

  // 发送按钮 — 真实 DOM（2026-07 实测）：按钮无 type attribute（仅 JS property），
  // 无 aria-label/data-testid；唯一稳定锚点是父容器 .send-btn-wrapper
  sendButton: [
    'div[class*="send-btn-wrapper"] button',
    'button[data-testid="send-button"]',
    'button[aria-label*="发送"]',
    'button[aria-label*="Send"]',
    'div[class*="send-btn"] button',
  ],

  // 停止生成按钮 — 生成中可见，data-testid 优先
  stopButton: [
    'button[data-testid="stop-button"]',
    'button[aria-label*="停止"]',
    'button[aria-label*="Stop"]',
    'button[class*="stop-button"]',
    'button[class*="stop-generation"]',
  ],

  // 主聊天容器（消息列表 + 输入区的最外层）
  mainContainer: [
    'main[class*="chat-main"]',
    'div[class*="chat-container"]',
    'div[class*="chat-main"]',
    'div[class*="conversation-container"]',
    'div[class*="chat-page"]',
  ],

  // 会话列表容器（侧边栏整体）
  conversationList: [
    'nav[class*="conversation-list"]',
    'div[class*="conversation-list"]',
    'aside[class*="sidebar"] nav',
    'div[class*="chat-sidebar"] nav',
    'div[class*="history-sidebar"]',
  ],

  // 当前激活的会话条目
  currentConversation: [
    'div[class*="conversation-item"][class*="active"]',
    'div[class*="conversation-item"][class*="selected"]',
    'a[href*="/chat/"][class*="active"]',
    'a[href*="/chat/"][aria-current="page"]',
    'div[class*="history-item"][class*="active"]',
  ],

  // 主题模式标记 — html/body 上的 class 或 data 属性
  themeMarker: [
    'html[data-theme="dark"]',
    'html[data-theme="light"]',
    'html.dark',
    'html.light',
    'body[data-theme="dark"]',
    'body[data-theme="light"]',
    'body[class*="theme-dark"]',
    'body[class*="theme-light"]',
    'html[color-mode="dark"]',
    'html[color-mode="light"]',
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
  // 流式/生成中指示器（语义同 loadingIndicator，业务层优先使用此字段）
  streamingIndicator: [
    'div[class*="generating"]',
    'div[class*="loading"]',
    'div[class*="typing"]',
  ],

  // 工具块容器（插件注入的 dpp 工具块）
  toolBlock: [
    '#dwplus-tool-block',
    '[data-dwplus-tool-block="true"]',
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
// 请求路径（2026-07-16 真实浏览器 CDP 抓包确认，见
// docs/progress/doubao-phase2-real-browser-2026-07-16.md 与
// playwright-results/phase2-06-body-structures.json）
// ============================================================

const DOUBAO_PATHS: HostPaths = {
  // 真实聊天端点。签名（msToken / a_bogus / fp）在 URL query 中，路径本身稳定
  completion: '/chat/completion',
  // 豆包没有独立的 regenerate 端点：重新生成复用 /chat/completion，
  // 以 body 中 option.is_regen=true 区分。与 completion 同值即可让两类请求都命中
  regenerate: '/chat/completion',
  // 历史会话实际走 /im/chain/recent_conv（cmd=3200 信封结构），
  // 但 history-cleanup 的清洗逻辑目前只认 DeepSeek 的响应结构，
  // 在适配豆包结构前故意保持不命中（占位值），避免误改历史响应
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

  /**
   * 豆包请求体字段路径映射（2026-07-16 真机抓包确认）。
   * 值为点分路径，经 core/hosts/shared/body-fields.ts 读写，数字段为数组下标。
   *
   * 真实 body 结构（新会话 / 多轮 / Skill / 长文本四类场景实测一致）：
   * ```json
   * {
   *   "client_meta": { "conversation_id": "", "bot_id": "..." },
   *   "messages": [{ "content_block": [{ "block_type": 10000,
   *     "content": { "text_block": { "text": "<用户输入>" } } }] }],
   *   "option": { "need_create_conversation": true, "need_deep_think": 0, ... }
   * }
   * ```
   * - messages 数组每次请求只含 1 条新消息（历史不随请求重发），下标 0 稳定
   * - 新会话判定：conversation_id === ""（配合 option.need_create_conversation）。
   *   isFirstMessage 语义靠 parentMessageId 路径指向 conversation_id 实现：
   *   空串不是 string 类型缺失，但 request-augmentation 只判 null/undefined，
   *   故此处指向 last_message_index（新会话为 null，多轮为数字），语义正好对齐
   * - 豆包无 ref_file_ids / model_type / search_enabled 对应字段（附件与联网
   *   由服务端配置，不在此请求中表达），映射为空路径 —— 读 undefined、写 no-op
   */
  getRequestBodyFields(): RequestBodyFieldMapping {
    return {
      prompt: 'messages.0.content_block.0.content.text_block.text',
      parentMessageId: 'client_meta.last_message_index',
      chatSessionId: 'client_meta.conversation_id',
      refFileIds: '',
      modelType: '',
      searchEnabled: '',
      thinkingEnabled: 'option.need_deep_think',
    };
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

  /**
   * 探测当前页面所有选择器的命中情况，输出 4 档状态。
   *
   * 任何选择器探测异常都被吞掉，绝不向上抛出 —— 保证页面不会因为某个选择器写错就报错。
   *
   * - full: 关键 + 辅助全部命中，完整 DOM 接管可用
   * - partial: 关键全部命中，部分辅助缺失，核心路径可用、增强降级
   * - fallback: 部分关键缺失，降级为基础模式（仅记忆/Skill 注入，不接管 DOM）
   * - unsupported: 关键全部缺失，无法接管当前页面
   *
   * 业务层据此决定是否启用 DOM 接管类 feature。
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
            `[DWPLUS] 豆包选择器健康检查 status=${report.status}，缺失关键元素: ${report.missingCritical.join(', ') || '(无)'}。` +
            `插件将降级为基础模式（仅记忆/Skill 注入，不接管 DOM）。页面: ${pageUrl}`,
          );
        }
      } else if (report.status === 'partial' && typeof console !== 'undefined' && console.info) {
        console.info(
          `[DWPLUS] 豆包选择器健康检查 status=partial，缺失辅助元素: ${report.missingEssential.join(', ')}。` +
          `核心路径可用，部分增强降级。页面: ${pageUrl}`,
        );
      }

      return report;
    } catch (err) {
      // 防御性兜底：探测过程中任何意外异常都不应让页面报错
      if (typeof console !== 'undefined' && console.error) {
        console.error('[DWPLUS] 豆包选择器健康检查异常，降级为 unsupported', err);
      }
      return {
        hostId: this.id,
        timestamp: Date.now(),
        probes: [],
        healthy: false,
        status: 'unsupported',
        missingCritical: [...CRITICAL_SELECTOR_KEYS] as string[],
        missingEssential: [...ESSENTIAL_SELECTOR_KEYS] as string[],
        pageUrl,
      };
    }
  }

  /**
   * 豆包专属 feature flags
   * 业务层根据这些 flag 决定是否启用。豆包版 DOM 增强 feature 已复刻自 DeepSeek++。
   */
  getFeatures(): HostFeatureFlags {
    return DOUBAO_FEATURES;
  }

  getMeta(): HostAdapterMeta {
    return DOUBAO_ADAPTER_META;
  }
}

const DOUBAO_FEATURES: HostFeatureFlags = {
  historyOrganizer: true,
  projectSidebarOrganizer: true,
  themeSync: true,
  hostSpecificCssInjection: true,
};
