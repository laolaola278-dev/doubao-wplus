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
  /** 停止生成按钮（生成中可见） */
  stopButton?: string[];

  // ===== 容器与导航 =====
  /** 主聊天容器（消息列表 + 输入区的最外层） */
  mainContainer?: string[];
  /** 会话列表容器（侧边栏整体） */
  conversationList?: string[];
  /** 当前激活的会话条目 */
  currentConversation?: string[];
  /** 主题模式标记（html/body 上的 class 或 data 属性） */
  themeMarker?: string[];

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

/**
 * 请求体字段路径映射。
 * 不同宿主用不同结构承载相同语义的数据，adapter 通过此映射声明字段位置，
 * 业务层（request-augmentation / fetch-hook）不再硬编码 DeepSeek 字段名。
 *
 * 字段值为「点分路径」，通过 core/hosts/shared/body-fields.ts 的
 * readBodyField / writeBodyField 读写：
 *   - 单段路径（如 'prompt'）等价于顶层字段名 —— DeepSeek 全部字段属于此类，行为与旧版一致
 *   - 多段路径穿透嵌套对象与数组下标，如豆包的
 *     'messages.0.content_block.0.content.text_block.text'（2026-07-16 真机抓包确认）
 *   - 空字符串 '' 表示该宿主请求体中不存在此语义字段（读为 undefined，写为 no-op）
 */
export interface RequestBodyFieldMapping {
  /** 用户输入的 prompt 字段路径 */
  prompt: string;
  /** 父消息标识字段路径（值为 null/缺失 表示首条消息） */
  parentMessageId: string;
  /** 会话 ID 字段路径 */
  chatSessionId: string;
  /** 引用文件 ID 列表字段路径 */
  refFileIds: string;
  /** 模型类型字段路径 */
  modelType: string;
  /** 是否启用搜索的字段路径 */
  searchEnabled: string;
  /** 是否启用思考模式的字段路径（布尔 true 或数字 1 均视为开启） */
  thinkingEnabled: string;
}

/**
 * 单个选择器的探测结果。
 */
export interface SelectorProbe {
  /** 选择器键名（如 inputBox / sendButton） */
  key: keyof HostSelectors;
  /** 是否在当前页面找到至少一个匹配元素 */
  found: boolean;
  /** 命中的具体 selector（用于调试，回显匹配规则） */
  matchedSelector: string | null;
  /** 命中元素数量 */
  matchCount: number;
}

/**
 * 选择器健康检查 4 档状态。
 * - full: 关键 + 辅助选择器全部命中，DOM 接管能力完整
 * - partial: 关键选择器全部命中，但部分辅助选择器缺失，核心路径可用、部分增强降级
 * - fallback: 部分关键选择器缺失，降级为基础模式（仅记忆/Skill 注入，不接管 DOM）
 * - unsupported: 全部关键选择器缺失，无法接管当前页面
 */
export type SelectorHealthStatus = 'full' | 'partial' | 'fallback' | 'unsupported';

/**
 * 选择器健康检查报告。
 * 业务层在初始化、URL 变化、关键操作失败时调用 detectSelectors 获取此报告，
 * 缺失关键选择器时降级为基础模式并 console.warn 提示用户。
 */
export interface SelectorHealthReport {
  /** 宿主 id */
  hostId: HostId;
  /** 时间戳 */
  timestamp: number;
  /** 探测结果列表 */
  probes: SelectorProbe[];
  /** 关键选择器（inputBox / sendButton / messageList）是否全部命中（向后兼容字段，等价于 status !== 'fallback' && status !== 'unsupported'） */
  healthy: boolean;
  /** 4 档状态：full / partial / fallback / unsupported */
  status: SelectorHealthStatus;
  /** 缺失的关键选择器键名列表 */
  missingCritical: string[];
  /** 缺失的辅助选择器键名列表（非关键，但影响完整体验） */
  missingEssential: string[];
  /** 探测时的页面 URL */
  pageUrl: string;
}

/**
 * Adapter 元数据 — 维护与兼容性跟踪用（RC 阶段引入）。
 * 全部为声明式静态信息，不参与运行时逻辑；
 * 每次真机回归后更新 lastVerifiedAt / verifiedBodyStructures。
 */
export interface HostAdapterMeta {
  /** 宿主显示名称（与 adapter.name 一致） */
  hostName: string;
  /** Adapter 版本 — 独立于扩展版本，映射/路径/选择器等对宿主契约的修改时递增 */
  adapterVersion: string;
  /** 最近一次真机验证日期（ISO，如 2026-07-16） */
  lastVerifiedAt: string;
  /** 已验证的页面 URL（真机回归覆盖的入口） */
  verifiedPages: string[];
  /** 已验证的请求体数据结构（场景 → 结构要点） */
  verifiedBodyStructures: string[];
  /** 验证证据（报告 / 抓包 JSON 的仓库相对路径） */
  evidence: string[];
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
  /** 返回此宿主的请求体字段名映射 */
  getRequestBodyFields(): RequestBodyFieldMapping;

  /** 检测页面状态 */
  detectPageState(doc: Document): PageState;

  /**
   * 探测当前页面所有选择器的命中情况。
   * 业务层在初始化、URL 变化、关键操作失败时调用，
   * 缺失关键选择器时降级为基础模式并 console.warn 提示用户。
   */
  detectSelectors(doc: Document): SelectorHealthReport;

  /** 返回此宿主支持的 feature flags（仅供业务层查询能力） */
  getFeatures(): HostFeatureFlags;

  /** 返回 adapter 元数据（版本 / 最近验证日期 / 已验证结构），用于维护与诊断导出 */
  getMeta(): HostAdapterMeta;
}

/**
 * Feature flags — 由 host adapter 声明业务层能启用的宿主专属能力。
 * 业务层调用 `getActiveAdapter().getFeatures().xxx` 决定是否启用某个功能。
 * 这样业务层不需 import 任何具体 host 模块。
 */
export interface HostFeatureFlags {
  /** 历史会话组织（搜索增强 / 标签 / 状态提示） */
  historyOrganizer: boolean;
  /** 项目侧边栏管理（将历史对话按项目分组） */
  projectSidebarOrganizer: boolean;
  /** 主题同步（侦测站点暗色/亮色模式并同步到扩展） */
  themeSync: boolean;
  /** 是否注入宿主专属 CSS（用于 DOM 增强样式）。doubao 模式下不加载 deepseek 专属 CSS，反之亦然 */
  hostSpecificCssInjection: boolean;
}

export type PageState =
  | 'logged_out'
  | 'empty_conversation'
  | 'idle'
  | 'generating'
  | 'network_error';
