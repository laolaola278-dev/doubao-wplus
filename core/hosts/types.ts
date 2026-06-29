// core/hosts/types.ts
// HostAdapter 统一接口 + 公共类型

export type HostId = 'doubao' | 'deepseek';

export interface HostSelectors {
  // ===== 消息读取主链路 =====
  /** 消息列表容器（fallback 数组，按优先级排列） */
  messageList: string[];
  /** 消息行（用户+AI 混在一起的每一行） */
  messageRow: string[];
  /** 消息 ID 在 DOM 上的属性名（用于内联 agent 的 trace 还原） */
  messageIdAttribute: string[];
  /** 用户消息气泡 */
  userMessage: string[];
  /** 助手消息气泡 */
  assistantMessage: string[];
  /** 最新一条助手消息（加速查询） */
  latestAssistantMessage: string[];
  /** 加载 / 生成中指示器（兼容命名：有些代码用 streamingIndicator 引用） */
  loadingIndicator: string[];
  /** 生成中 / 流式指示器（语义同 loadingIndicator，优先使用此字段） */
  streamingIndicator: string[];

  // ===== 输入与发送 =====
  /** 文本输入框 */
  inputBox: string[];
  /** 发送按钮 */
  sendButton: string[];

  // ===== 功能增强 =====
  /** 工具块容器（插件注入的 dpp 工具块） */
  toolBlock: string[];
  /** 代码块 */
  codeBlock: string[];
  /** 复制按钮 */
  copyButton: string[];
  /** 重新生成按钮 */
  regenerateButton: string[];
  /** 对话标题 */
  conversationTitle: string[];

  // ===== 操作按钮 =====
  /** 操作按钮行（复制/重新生成/点赞等） */
  actionRow: string[];

  // ===== 边缘状态 =====
  /** 侧边栏/历史条目 */
  historyItem: string[];
  /** 错误态提示 */
  errorState: string[];
  /** 空会话提示 */
  emptyState: string[];
  /** 登录引导态 */
  loginState: string[];
  /** 限流提示 */
  rateLimitState: string[];
  /** 禁用输入态 */
  disabledInput: string[];
}

export interface HostPaths {
  /** 流式聊天补全端点路径 */
  completion: string;
  /** 重新生成端点路径 */
  regenerate: string;
  /** 历史消息端点路径 */
  history: string;
}

export interface HostAdapter {
  readonly id: HostId;
  readonly name: string;
  readonly matchPatterns: string[];

  /** 当前 URL 是否匹配此宿主 */
  matchUrl(url: string): boolean;
  /** 是否为流式聊天请求 URL */
  isChatStreamUrl(url: string): boolean;
  /** 是否为历史消息请求 URL */
  isHistoryUrl(url: string): boolean;

  /** 从 location 解析会话 ID */
  getSessionId(location: Location): string | null;
  /** 获取当前对话标题 */
  getConversationTitle(doc: Document): string;

  /** 返回此宿主的选择器配置 */
  getSelectors(): HostSelectors;
  /** 返回此宿主的请求路径配置 */
  getPaths(): HostPaths;

  /** 检测页面状态 */
  detectPageState(doc: Document): PageState;
}

export type PageState =
  | 'logged_out'
  | 'empty_conversation'
  | 'idle'
  | 'generating'
  | 'network_error';
