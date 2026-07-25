# Doubao WPlus 项目完整分析报告

## 1. 项目概述

### 1.1 项目目标
**Doubao WPlus** 是一个开源浏览器扩展（MV3），为豆包网页版（primary host）和 DeepSeek 网页版（secondary host）提供 AI 工作台增强，将网页版 AI 平台扩展成具有以下能力的系统：
- 跨会话长期记忆管理
- 可复用工作流 (Skill) 系统
- MCP 工具集成与自动执行
- 浏览器自动化控制 (Chrome DevTools Protocol)
- 对话自动化与定时任务调度
- 对话导出与产物生成
- 国际化支持（中文 / English）

### 1.2 项目主要功能

#### 核心功能模块
| 功能 | 描述 | 状态 |
|-----|------|------|
| **侧边栏对话** | 在扩展侧边栏与 AI 进行独立对话，支持多轮交互 | ✅ 完成 |
| **记忆系统** | 自动保存和注入长期记忆（user/feedback/topic/reference） | ✅ 完成 |
| **Skill 工作流** | 内置 + 自定义 + GitHub 导入的工作流系统 | ✅ 完成 |
| **MCP 工具** | Model Context Protocol 工具集成与管理 | ✅ 完成 |
| **浏览器控制** | CDP 驱动的页面自动化（点击、输入、导航等） | ✅ 完成 |
| **对话导出** | HTML/Markdown/PDF/JSON 格式导出 | ✅ 完成 |
| **自动化任务** | 定时执行任务，支持 cron 表达式 | ✅ 完成 |
| **项目上下文** | 组织对话和记忆到项目，自动注入项目指令 | ✅ 完成 |
| **Web 工具** | 联网搜索、网页获取内容 | ✅ 完成 |
| **多宿主支持** | 同时支持 Doubao 和 DeepSeek 网页版 | ✅ 完成 |
| **国际化** | 中文/English 界面和运行时语言切换 | ✅ 完成 |

#### 当前开发完成度
- **已实现**: 所有核心功能基本完成
- **开发中**: 根据 git status 显示，当前分支（test/doubao-real-page-baseline）正在进行以下工作：
  - 宿主适配器重构与规范化
  - 架构守护测试（no-host-hardcoding guard）
  - Content script 清理与架构分离
- **质量控制**: 完整的 E2E 测试、单元测试、CI/CD 流程

### 1.3 项目业务流程

#### 用户交互主流程

```
用户操作
    ↓
Content Script 检测 (content.ts)
    ├─ 匹配宿主 (doubao.com / deepseek.com)
    ├─ 注册 DOM 选择器健康检查
    └─ 启用 fetch hook
    ↓
Background Service Worker (background.ts)
    ├─ 初始化扩展存储 (IndexedDB + Storage API)
    ├─ 加载用户配置（记忆、Skills、Preset、MCP等）
    └─ 启动消息路由与工具执行器
    ↓
Fetch Hook 拦截 (fetch-hook.ts)
    ├─ 拦截 /chat/completion / /api/v0/chat/completion
    ├─ Request 增强：注入记忆、Skill、System Prompt
    └─ Response 处理：
        ├─ SSE 流式解析
        ├─ 工具调用识别 (<tool_name>JSON</tool_name>)
        ├─ 工具执行 (MCP / 内置 / Web)
        └─ 结果回传到同一会话续跑
    ↓
UI 更新
    ├─ Sidepanel (React) 展示结果
    ├─ Inline Agent 渲染工具块
    └─ 修改 DOM（工具结果、工具调用折叠等）
```

#### 自动化执行流程

```
用户创建自动化任务
    ↓
Automation Store 保存 (automation/store.ts)
    ↓
Automation Scheduler 计时 (automation/scheduler.ts)
    ├─ 解析 Cron 表达式（rrule）
    └─ 在指定时间触发
    ↓
Automation Runner (automation/runner.ts)
    ├─ 在 DOM 中查找或创建目标标签页
    ├─ 建立 PostMessage Bridge
    └─ 发送 DWPLUS_AUTOMATION_CONTENT_RUN 消息到 content script
    ↓
Content Script 执行（main-world.content.ts）
    ├─ 接收自动化请求
    ├─ 调用同一个 fetch-hook 流程
    └─ 通过 Bridge 返回结果给 background
    ↓
Automation Store 记录运行历史
    └─ 更新 lastRunAt, nextRunAt, lastError 等状态
```

#### MCP 工具执行流程

```
AI 输出 tool call (<tool_name>JSON</tool_name>)
    ↓
fetch-hook 识别工具调用
    ├─ 解析 XML 标签
    └─ 提取参数 JSON
    ↓
Tool Execution Router
    ├─ 内置工具 (memory_save, memory_update, etc.)
    │   └─ 直接执行
    ├─ MCP 工具
    │   ├─ 查询 MCP Server 工具列表
    │   ├─ 通过 MCP Transport (HTTP/SSE/stdio bridge/native messaging)
    │   └─ 执行工具
    └─ Web 工具 (web_search, web_fetch)
        ├─ 校验权限
        └─ 执行请求
    ↓
结果序列化
    ├─ 成功结果组装为文本
    └─ 错误包装为错误消息
    ↓
自动续跑
    ├─ 将结果回传到同一会话
    ├─ 按 10s 间隔等待防止限流
    └─ AI 继续生成
```

### 1.4 技术栈分析

#### 前端框架
- **WXT** (v0.20.26) - Chrome 扩展开发框架，自动处理 manifest、打包等
- **React** (v19.2.4) - UI 框架
- **TypeScript** (v5.9.3) - 类型安全
- **Tailwind CSS** (v4.2.4) - 样式框架
- **React Markdown** (v10.1.0) - Markdown 渲染

#### 存储 & 数据库
- **Dexie** (v4.4.2) - IndexedDB 包装库，用于存储：
  - 记忆 (memories)
  - Skills
  - 自动化任务
  - 项目上下文
  - 保存项 (saved items)
  - MCP 服务器配置
  - WebDAV 同步配置
- **Chrome Storage API** - 存储用户配置、主题、语言等

#### 运行时 & 沙箱
- **Pyodide** (v314.0.0) - WebAssembly Python 运行时，用于：
  - 在 Sandbox Worker 中执行 Python 代码
  - 提供 artifact 代码执行能力

#### 其他工具
- **Vitest** (v4.1.8) - 单元测试框架
- **Playwright** (v1.49.0) - E2E 测试框架
- **sucrase** (v3.35.1) - TypeScript 代码转换

#### 支持的浏览器
- Chrome (Chromium-based)
- Microsoft Edge
- Firefox (MV3)

---

## 2. 项目目录结构详解

```
doubao-wplus/
├── core/                          # 核心业务逻辑层
│   ├── automation/                # 自动化任务与调度
│   ├── browser-control/           # CDP 浏览器控制
│   ├── chat/                      # 官方 API 配置
│   ├── deepseek/                  # DeepSeek 宿主适配
│   ├── export/                    # 对话导出与格式化
│   ├── hosts/                     # 宿主适配器（Doubao/DeepSeek）
│   ├── i18n/                      # 国际化资源
│   ├── inline-agent/              # 页面内联 Agent 渲染
│   ├── interceptor/               # Fetch 拦截与请求增强
│   ├── mcp/                       # Model Context Protocol 客户端
│   ├── memory/                    # 长期记忆系统
│   ├── platform/                  # 浏览器能力抽象层
│   ├── preset/                    # 系统提示词预设
│   ├── project/                   # 项目上下文管理
│   ├── prompt/                    # 提示词注入与可见性控制
│   ├── sandbox/                   # Python 代码沙箱
│   ├── saved-items/               # 保存项 (书签/代码片段)
│   ├── shell/                     # Native Shell 工具与 Shell MCP
│   ├── skill/                     # Skill 工作流系统
│   ├── sync/                      # WebDAV 同步与数据导入导出
│   ├── theme/                     # 主题管理
│   ├── tool/                      # 工具执行框架与内置工具
│   ├── tool-loop/                 # 工具循环执行引擎
│   ├── ui/                        # UI 辅助（主题注入、弹窗等）
│   ├── constants.ts               # 全局常量与 system prompt 模板
│   ├── messaging.ts               # 消息传递协议定义
│   ├── types.ts                   # 核心类型定义
│   └── version.ts                 # 版本管理
│
├── entrypoints/                   # 扩展入口点（WXT 约定目录）
│   ├── background.ts              # Service Worker 后台脚本
│   ├── content.ts                 # Content Script 主入口
│   ├── main-world.content.ts      # Main World Content Script（沙箱环保）
│   ├── sidepanel/                 # 侧边栏 UI (React)
│   │   ├── App.tsx
│   │   ├── pages/
│   │   │   ├── ChatPage.tsx       # 对话页
│   │   │   ├── McpPage.tsx        # MCP 管理页
│   │   │   ├── SkillPage.tsx      # Skill 管理页
│   │   │   ├── MemoryPage.tsx     # 记忆管理页
│   │   │   ├── SettingsPage.tsx   # 设置页
│   │   │   └── ...
│   │   └── components/            # React 组件库
│   ├── sandbox-runner/            # Sandbox HTML + Python Worker
│   ├── sandbox-offscreen/         # Offscreen Document (Chromium)
│   └── content/
│       └── features/              # 按宿主组织的 DOM 增强特性
│           ├── doubao/
│           ├── deepseek/
│           └── shared/
│
├── .wxt/                          # WXT 生成的类型与配置
├── dist/                          # 构建输出目录
├── public/                        # 静态资源 (icons, etc.)
├── assets/                        # 项目文档图片
├── android/                       # Android WebView 适配
├── scripts/                       # 构建脚本
├── tests/                         # 测试文件
├── playwright-results/            # E2E 测试结果
│
├── package.json                   # 依赖与 npm scripts
├── wxt.config.ts                  # WXT 构建配置
├── tsconfig.json                  # TypeScript 配置
├── vitest.config.ts               # Vitest 配置
├── playwright.config.ts           # Playwright 配置
│
├── README.md                      # 中文文档
├── README_EN.md                   # English 文档
├── CONTRIBUTING.md                # 贡献指南
├── AGENTS.md                      # AI Agent 工作手册
└── ...
```

### 核心目录职责说明

#### core/automation/
**自动化任务调度与执行系统**
- `types.ts` - Automation/AutomationRun 类型定义
- `store.ts` - 自动化任务持久化 (Dexie)
- `scheduler.ts` - Cron 表达式解析与定时触发
- `runner.ts` - 自动化执行器，通过 PostMessage Bridge 驱动任务
- `messages.ts` - 自动化消息协议
- `pow.ts` - Proof-of-Work 相关（可能用于限流）
- `schedule.ts` - 调度逻辑

#### core/interceptor/
**Fetch 拦截与请求增强**
- `fetch-hook.ts` - 核心拦截点，修改 request body/headers，处理 response
- `request-augmentation.ts` - 注入记忆、Skill、System Prompt
- `sse-parser.ts` - 流式 SSE 响应解析
- `streaming-tool-call-parser.ts` - 流式工具调用识别
- `tool-parser.ts` - 完整工具调用解析
- `streaming-tool-text.ts` - 工具调用文本积累
- `token-speed.ts` - token/s 速度计算
- `history-cleanup.ts` - 清除历史记录中的工具调用痕迹
- `header-borrowing.ts` - 从页面请求借用 headers 保持身份认证

#### core/mcp/
**MCP 协议客户端实现**
- `types.ts` - MCP 配置与工具定义
- `client.ts` - MCP 客户端主体
- `discovery.ts` - 工具发现与列表
- `store.ts` - MCP 服务器配置存储
- `transports/` - 传输层
  - `http.ts` - HTTP 传输
  - `sse.ts` - Server-Sent Events
  - `native.ts` - Native Messaging (Shell MCP)
  - `bridge.ts` - PostMessage Bridge
  - `stdio_bridge.ts` - Stdio 通道（用于外部进程）

#### core/export/
**对话导出与格式化**
- `types.ts` - 导出类型定义
- `service.ts` - 导出主服务
- `artifact-*.ts` - 不同格式处理 (HTML/Markdown/PDF/JSON/TXT)
- `normalize.ts` - 数据归一化
- `sanitize.ts` - 清理敏感信息
- `attachments.ts` - 附件处理
- `secondary-artifacts.ts` - 辅助产物 (image manifest)

#### core/hosts/
**宿主适配器抽象**
- `types.ts` - HostAdapter 接口定义
- `registry.ts` - 宿主注册表与自动检测
- `doubao/adapter.ts` - 豆包适配器
- `deepseek/adapter.ts` - DeepSeek 适配器
- `shared/` - 共享工具函数

#### core/skill/
**工作流系统**
- `types.ts` - Skill 类型（从 core/types.ts 导出）
- `registry.ts` - Skill 存储与管理
- `builtin.ts` - 内置 Skill (shell, memory, ultra-think, /officecli)
- `github-importer.ts` - GitHub 导入与更新检查
- `local-importer.ts` - 本地文件导入
- `parser.ts` - Skill 元数据解析
- `officecli-library.ts` - OfficeCLI 第三方 Skill 库
- `creator-tool.ts` - Skill 创建工具

#### core/tool/
**工具执行框架**
- `types.ts` - ToolDescriptor/ToolCall/ToolResult 类型
- `invocation.ts` - 工具目录与调用模式
- `runtime.ts` - 运行时工具执行
- `memory.ts` - 记忆工具 (memory_save/update/delete)
- `web-search.ts` - 联网搜索实现
- `history.ts` - 工具调用历史存储
- `execution-restore.ts` - 工具调用恢复
- `sidepanel.ts` - 侧边栏工具过滤
- `xml-tags.ts` - XML 工具标签处理

---

## 3. 核心模块深度分析

### 3.1 多宿主适配系统

#### 设计模式：Strategy Pattern

```typescript
// core/hosts/registry.ts
const adapters: Map<HostId, HostAdapter> = new Map();

// 在 getActiveAdapter(url) 时自动检测宿主
function getActiveAdapter(url?: string): HostAdapter {
  if (url) {
    const detected = detectHost(url);
    if (detected) return detected;
  }
  return adapters.get(activeHostId)!;
}
```

#### 宿主适配器接口（HostAdapter）

每个宿主适配器需实现：
- `matchUrl(url)` - URL 匹配
- `isChatStreamUrl(url)` - 流式聊天请求判断
- `isHistoryUrl(url)` - 历史消息请求判断
- `getSelectors()` - 返回 DOM 选择器配置
- `getPaths()` - 返回 API 路径 (completion/regenerate/history)
- `getRequestBodyFields()` - 返回请求体字段名映射
- `detectPageState(doc)` - 页面状态检测 (logged_out/idle/generating)
- `detectSelectors(doc)` - 选择器健康检查

#### 现有宿主适配

**DoubaoAdapter** (core/hosts/doubao/adapter.ts)
```
URL Pattern: www.doubao.com/chat/*
API Endpoint: https://www.doubao.com/chat/completion
Request Body Fields: 
  - prompt: "prompt" 
  - chatSessionId: "chat_session_id"
  - parentMessageId: "parent_message_id"
  - ...
```

**DeepSeekAdapter** (core/hosts/deepseek/adapter.ts)
```
URL Pattern: chat.deepseek.com
API Endpoint: https://chat.deepseek.com/api/v0/chat/completion
Request Body Fields:
  - prompt: "prompt"
  - chatSessionId: "chat_session_id"
  - parentMessageId: "parent_message_id"
  - ...
```

#### 选择器健康检查

`SelectorHealthReport` 的四档状态：
- **full** - 关键 + 辅助选择器全部命中，DOM 接管完整
- **partial** - 关键选择器全部命中，部分辅助缺失，核心功能可用
- **fallback** - 部分关键选择器缺失，降级为基础模式（仅记忆/Skill 注入）
- **unsupported** - 全部关键选择器缺失，无法接管

### 3.2 Fetch 拦截与请求增强系统

#### 拦截入口 (fetch-hook.ts)

```typescript
interface HookState {
  toolDescriptors: ToolDescriptor[];
  onRequestBody: (body: string) => Promise<RequestBodyModification | null>;
  onHeadersCaptured: (headers: Record<string, string> | null) => void;
  onToolCallStarted: (call: ToolCall) => void;
  onToolCall: (call: ToolCall) => void;
  onResponseTokenSpeed: (progress: ResponseTokenSpeedPayload) => void;
  // ...
}
```

#### 请求流程

1. **初始化等待** (INITIAL_HOOK_STATE_WAIT_MS = 5000ms)
   - fetch hook 等待 content script 注册 HookState
   - 避免早期请求在初始化前被漏掉

2. **请求拦截**
   ```
   原始 fetch(url, options)
   ↓
   是否匹配 completion/regenerate/history 路径? 否 → 通过原始 fetch
   ↓ 是
   解析 request body (JSON)
   ↓
   调用 onRequestBody hook (request-augmentation.ts)
     - 注入记忆上下文
     - 注入 System Prompt
     - 注入预设
     - 注入 Skill
   ↓
   修改 body (RequestBodyModification)
   ↓
   执行 fetch，获取 Response
   ```

3. **响应处理**
   ```
   response.body (ReadableStream)
   ↓
   SSE 流式解析
   ↓
   提取文本片段 (extractResponseTextFromParsed)
   ↓
   识别工具调用标记 (<tool_name>JSON</tool_name>)
   ↓
   积累工具文本 (createStreamingToolTextAccumulator)
   ↓
   工具调用解析 (extractToolCalls)
   ↓
   onToolCallStarted() → 向页面通知
   ↓
   工具执行（MCP/内置/Web）
   ↓
   onToolCall() → 返回工具结果
   ↓
   续跑等待 (10s 间隔)
   ↓
   将结果注入回流，模型继续生成
   ```

#### 关键特性

| 特性 | 实现位置 | 说明 |
|-----|--------|------|
| Token 速度监控 | token-speed.ts | 每 250ms 计算一次 tok/s |
| 历史清理 | history-cleanup.ts | 从历史消息中移除工具调用痕迹，防止重复执行 |
| Header 借用 | header-borrowing.ts | 从原始请求借用 headers 保持身份认证 |
| 初始化同步 | fetch-hook.ts (L66-71) | 使用 Promise 确保 hook state 已准备 |
| 诊断模式 | dev-diagnostics.ts | 记录最后一次捕获的请求用于调试 |

### 3.3 记忆系统 (Memory System)

#### 数据模型

```typescript
interface Memory {
  id?: number;
  syncId: string;              // 用于 WebDAV 同步的全局唯一 ID
  scope: 'global' | 'project'; // 全局/项目级别
  projectId?: string;          // 若 scope='project' 则关联项目
  type: 'user' | 'feedback' | 'topic' | 'reference'; // 记忆类型
  name: string;                // 标题
  content: string;             // 内容
  description: string;         // 描述
  tags: string[];              // 标签
  pinned: boolean;             // 是否置顶
  createdAt: number;
  updatedAt: number;
  accessCount: number;         // 访问次数
  lastAccessedAt: number;      // 最后访问时间
}
```

#### 存储层 (core/memory/store.ts)

- `getAllMemories()` - 获取所有记忆
- `saveMemory(memory)` - 保存新记忆
- `updateMemory(id, update)` - 更新记忆
- `deleteMemory(id)` - 删除记忆
- `touchMemories(ids)` - 更新访问时间

#### 注入层 (core/memory/injector.ts)

在请求增强时，记忆注入流程：
1. 根据当前项目筛选记忆 (filterMemoriesByProjectScope)
2. 按访问频率与时间排序
3. 累积到 MEMORY_TOKEN_BUDGET (1500 tokens)
4. 格式化为 system prompt 中的记忆列表

#### 创建工具 (core/memory/importer.ts)

支持从其他 AI 工作流导入记忆，带有预览和验证。

### 3.4 工具执行框架 (Tool System)

#### 工具类型

```typescript
type ToolProviderKind = 'builtin' | 'mcp' | 'web' | 'browser-control';

interface ToolDescriptor {
  id: ToolDescriptorId;
  name: string;                      // 工具名
  description: string;
  provider: ToolProvider;
  invocationName: string;            // XML 标签名
  inputSchema: ToolDescriptorSchema;
  risk: ToolRiskLevel;
  execution?: ToolDescriptorExecution;
}

interface ToolCall {
  id?: ToolCallId;
  name: string;
  arguments: Record<string, unknown>;
  source?: ToolCallSource;
}

interface ToolResult {
  ok: boolean;
  output?: JsonValue;
  error?: ToolError;
  summary?: string;
  detail?: string;
}
```

#### 工具来源与执行

| 来源 | 执行方式 | 例子 |
|-----|--------|------|
| **builtin** | 直接在 background 执行 | memory_save, memory_update, memory_delete |
| **mcp** | 通过 MCP Transport 调用 | 任何 MCP 服务器工具 |
| **web** | Fetch API | web_search, web_fetch |
| **browser-control** | Chrome DevTools Protocol | click, input, navigate |
| **sandbox** | Pyodide Worker | artifact 代码执行 |

#### 工具目录 (core/tool/invocation.ts)

```typescript
const DEFAULT_TOOL_DESCRIPTORS: ToolDescriptor[] = [
  // 记忆工具
  { name: 'memory_save', invocationName: 'memory_save', ... },
  { name: 'memory_update', invocationName: 'memory_update', ... },
  { name: 'memory_delete', invocationName: 'memory_delete', ... },
  // Web 工具
  { name: 'web_search', invocationName: 'web_search', ... },
  { name: 'web_fetch', invocationName: 'web_fetch', ... },
  // 浏览器控制工具
  { name: 'browser_click', invocationName: 'browser_click', ... },
  // ... 更多工具
];
```

#### 执行流程 (core/tool/runtime.ts)

```typescript
async function executeRuntimeToolCall(call: ToolCall): Promise<ToolResult> {
  const descriptor = findToolDescriptor(call.name);
  
  switch (descriptor.provider.kind) {
    case 'builtin':
      return executeBuiltinTool(call);
    case 'mcp':
      return executeViaMcp(call, descriptor);
    case 'web':
      return executeWebTool(call);
    case 'browser-control':
      return executeBrowserControl(call);
    // ...
  }
}
```

### 3.5 MCP 客户端实现

#### MCP 配置存储

```typescript
interface McpServerConfig {
  version: McpServerConfigVersion;
  id: McpServerId;
  displayName: string;
  enabled: boolean;
  transport: McpServerTransportConfig;  // HTTP/SSE/stdio_bridge/native_messaging
  headers: McpHeaderValue[];             // 自定义 HTTP headers
  secrets: McpSecretValue[];             // Bearer/Basic/Header auth
  timeouts: McpServerTimeouts;
  limits: McpServerResultLimits;
  allowlist: McpToolAllowlist;           // all/allow/deny 工具过滤
  execution: McpServerExecutionDefaults; // auto/manual 执行模式
  status: McpServerStatus;               // unknown/ready/error/disabled
  // ...
}
```

#### 传输层实现

| 传输方式 | 文件 | 用途 |
|---------|------|------|
| **HTTP** | transports/http.ts | 连接到 HTTP 服务器 |
| **SSE** | transports/sse.ts | Server-Sent Events 实时推送 |
| **Stdio Bridge** | transports/bridge.ts | 通过 stdio 与本地进程通信（需中转） |
| **Native Messaging** | transports/native.ts | Chrome Native Messaging API（Shell MCP） |

#### 工具生命周期

```typescript
// 1. 添加 MCP 服务器
createMcpServer({
  displayName: "My Tool",
  transport: { kind: 'http', url: 'http://localhost:3000' }
});

// 2. 初始化并获取工具列表
listTools() → ToolDescriptor[]

// 3. 执行工具调用
callTool({
  call: { name: 'example_tool', arguments: {...} },
  descriptor: toolDescriptor
}) → ToolResult

// 4. 结果返回到 AI 继续生成
```

### 3.6 自动化系统 (Automation)

#### 自动化任务模型

```typescript
interface Automation {
  id: AutomationId;
  name: string;
  prompt: string;                    // 执行的 prompt
  status: 'active' | 'paused' | 'archived';
  schedule: {
    kind: 'manual' | 'cron' | 'rrule'; // 触发方式
    expression: string | null;        // Cron 表达式
    timezone: string;
    enabled: boolean;
    minimumIntervalMinutes: number;   // 最小间隔
  };
  promptOptions: {
    modelType: string | null;         // 选用模型
    searchEnabled: boolean;           // 启用搜索
    thinkingEnabled: boolean;         // 启用思考
    refFileIds: string[];             // 引用文件
  };
  deepseek: {
    chatSessionId: string | null;     // DeepSeek 会话 ID
    parentMessageId: number | null;
    sessionUrl: string | null;
    lastHistorySyncedAt: number | null;
  };
  // ...
}
```

#### 调度与执行

1. **定时器** (automation/scheduler.ts)
   - 使用 Chrome Alarms API 定时触发
   - 解析 Cron 表达式（rrule 库）
   - 计算下一次运行时间

2. **执行器** (automation/runner.ts)
   - 在 DOM 中查找或创建目标标签页
   - 建立 PostMessage Bridge
   - 通过消息驱动 content script 执行任务
   - 记录执行历史与错误

3. **失败恢复**
   - 记录失败原因 (AutomationErrorState)
   - 支持重试机制 (retryable flag)
   - 在侧边栏显示最后错误

---

## 4. 数据流架构

### 4.1 用户输入到 AI 回复的完整流程

```
┌─ 用户在豆包网页版输入消息
│
├─ DOM 事件触发 (inputBox 获焦)
│  └─ Content Script 捕获 (content.ts)
│
├─ 用户点击发送
│  ├─ 页面执行原生 fetch to /chat/completion
│  └─ Fetch Hook 拦截 (fetch-hook.ts)
│
├─ Request 增强 (request-augmentation.ts)
│  ├─ 加载用户记忆
│  ├─ 加载 Active Preset
│  ├─ 加载项目上下文
│  ├─ 注入 System Prompt 模板
│  └─ 附加可用工具列表 (MCP + 内置)
│
├─ 发送修改后的请求
│
├─ 流式响应处理
│  ├─ SSE 流解析 (sse-parser.ts)
│  ├─ 识别工具调用 (<tool>JSON</tool>)
│  ├─ 工具执行 (tool/runtime.ts)
│  │  ├─ MCP 工具 → 通过 MCP Transport
│  │  ├─ 内置工具 → 直接执行（memory_save 等）
│  │  └─ Web 工具 → fetch API
│  ├─ 工具结果序列化
│  └─ 注入回流，模型续跑
│
├─ 最终文本与工具调用记录
│  └─ 注入到页面 DOM (inline-agent/renderer.ts)
│
└─ 用户看到完整回复 + 工具执行结果
```

### 4.2 消息传递架构

#### 跨上下文通信（Content Script ↔ Background）

```typescript
// 在 background service worker 中监听
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const action = message as MessageAction;
  // 根据 type 路由到不同 handler
  // 返回 Promise 或调用 sendResponse
});

// Content script 发送
chrome.runtime.sendMessage(message)
  .then(response => { ... })
  .catch(error => { ... });
```

#### 自动化消息 (PostMessage Bridge)

```typescript
// Content Script 监听 main-world 的消息
window.addEventListener('message', (event) => {
  if (event.data.type === 'DWPLUS_AUTOMATION_CONTENT_RUN') {
    const request = event.data.payload;
    // 执行自动化任务
    // 通过 bridge 返回结果到 background
  }
});
```

### 4.3 状态管理流

```
IndexedDB (Dexie)
├─ memories (Memory[])
├─ skills (Skill[])
├─ automations (Automation[])
├─ automationRuns (AutomationRun[])
├─ mcpServers (McpServerConfig[])
├─ projectContexts (ProjectContext[])
└─ savedItems (SavedItem[])

Storage API (Chrome Storage)
├─ theme (deepseek-dark / deepseek-light)
├─ locale (browser / zh-CN / en)
├─ modelType (expert / null)
├─ promptInjectionSettings (PromptInjectionSettings)
└─ ...

在 Fetch Hook 中加载状态：
request-augmentation.ts
├─ getAllMemories() → Dexie
├─ getActivePreset() → Dexie
├─ getProjectForConversation() → Dexie
└─ getRuntimeToolDescriptors() → MCP 实时查询
```

---

## 5. API 与协议分析

### 5.1 豆包网页版 API (Doubao Host)

**Base URL:** `https://www.doubao.com`

#### 聊天补全接口

**Endpoint:** `/chat/completion`  
**Method:** `POST`  
**Headers:** 需要有效的 session cookies

**Request Body (豆包格式):**
```json
{
  "prompt": "用户输入",
  "chat_session_id": "会话ID",
  "parent_message_id": 最后一条消息ID或null,
  "model_type": "doubao-pro-32k" 或类似,
  "search_enabled": true/false,
  "thinking_enabled": true/false,
  "ref_file_ids": ["file_id1", "file_id2"]
}
```

**Response:** Server-Sent Events (SSE)
```
event: message
data: {"type":"text","text":"回复内容"}
event: done
data: {}
```

#### 历史消息接口

**Endpoint:** `/chat/history`  
**Method:** `GET` / `POST`  
**Query/Body:** 会话 ID、分页参数

**Response:**
```json
{
  "messages": [
    {
      "id": "msg_id",
      "role": "user" | "assistant",
      "content": "...",
      "created_at": timestamp
    }
  ]
}
```

### 5.2 DeepSeek 网页版 API (DeepSeek Host)

**Base URL:** `https://chat.deepseek.com`

#### 聊天补全接口

**Endpoint:** `/api/v0/chat/completion`  
**Method:** `POST`  
**Headers:** 同 Doubao

**Request Body (DeepSeek 格式):**
```json
{
  "prompt": "用户输入",
  "chat_session_id": "会话ID",
  "parent_message_id": 最后一条消息ID或null,
  "model_type": "deepseek-chat",
  "search_enabled": true/false,
  "thinking_enabled": true/false,
  "ref_file_ids": []
}
```

**Response:** SSE (同 Doubao)

### 5.3 MCP 协议

#### JSON-RPC 2.0 请求 / 响应

**Request:**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/list",
  "params": {}
}
```

**Response:**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "tools": [
      {
        "name": "tool_name",
        "description": "...",
        "inputSchema": { ... }
      }
    ]
  }
}
```

#### 工具调用

**Request:**
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "tool_name",
    "arguments": { ... }
  }
}
```

**Response:**
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "执行结果"
      }
    ]
  }
}
```

### 5.4 内置工具协议

#### 工具调用格式 (XML-style)

```xml
<tool_name>
{"param1": "value1", "param2": "value2"}
</tool_name>
```

**示例 - 记忆保存:**
```xml
<memory_save>
{"type": "user", "name": "用户职业", "content": "前端开发工程师", "tags": ["前端"]}
</memory_save>
```

**示例 - Web 搜索:**
```xml
<web_search>
{"query": "2024年AI发展现状", "limit": 5}
</web_search>
```

#### 工具列表

| 工具名 | 参数 | 返回值 | 说明 |
|------|------|--------|------|
| **memory_save** | {type, name, content, tags} | {ok, id} | 保存新记忆 |
| **memory_update** | {id, type, name, content, tags} | {ok} | 更新记忆 |
| **memory_delete** | {id} | {ok} | 删除记忆 |
| **web_search** | {query, limit?} | {ok, results[]} | 搜索互联网 |
| **web_fetch** | {url, selector?} | {ok, content} | 获取网页内容 |
| **browser_click** | {selector} | {ok} | 点击页面元素 |
| **browser_input** | {selector, text} | {ok} | 输入文本 |
| **browser_navigate** | {url} | {ok} | 导航到 URL |
| ... | | | |

### 5.5 Chrome Extension 消息协议

#### Message Types (core/types.ts)

```typescript
type MessageAction =
  // 记忆操作
  | { type: 'GET_MEMORIES' }
  | { type: 'SAVE_MEMORY'; payload: NewMemory }
  | { type: 'UPDATE_MEMORY'; payload: Memory }
  | { type: 'DELETE_MEMORY'; payload: { id: number } }
  
  // Skill 操作
  | { type: 'GET_SKILLS' }
  | { type: 'SAVE_SKILL'; payload: SaveSkillPayload }
  | { type: 'DELETE_SKILL'; payload: { name: string } }
  
  // MCP 操作
  | { type: 'GET_MCP_SERVERS' }
  | { type: 'CREATE_MCP_SERVER'; payload: McpServerCreateInput }
  | { type: 'EXECUTE_TOOL_CALL'; payload: ToolCall }
  
  // 工具相关
  | { type: 'GET_TOOL_DESCRIPTORS' }
  | { type: 'REFRESH_TOOL_DESCRIPTORS' }
  
  // 项目相关
  | { type: 'CREATE_PROJECT_CONTEXT'; payload: ProjectContextCreateInput }
  | { type: 'ADD_CONVERSATION_TO_PROJECT'; payload: {...} }
  
  // 导出
  | { type: 'GET_ARTIFACT'; payload: { id: string } }
  
  // 配置
  | { type: 'GET_CONFIG' }
  | { type: 'GET_DEEPSEEK_THEME' }
  | { type: 'SAVE_VOICE_SETTINGS'; payload: Partial<VoiceSettings> }
  
  // ... 更多类型
```

---

## 6. 配置分析

### 6.1 WXT 配置 (wxt.config.ts)

```typescript
// Manifest 权限
{
  permissions: ['storage', 'alarms', 'nativeMessaging', 'contextMenus'],
  optional_host_permissions: ['http://*/*', 'https://*/*'],
  host_permissions: [
    '*://www.doubao.com/*',      // 豆包主域
    '*://*.doubao.com/*',        // 豆包子域
    '*://chat.deepseek.com/*',   // DeepSeek
    'https://api.deepseek.com/*', // DeepSeek API
    '*://cn.bing.com/*',         // Bing 搜索（可选）
  ]
}

// Vite 配置
{
  plugins: [
    tailwindcss(),
    pyodideAssetsPlugin(),  // 包含 Python WASM
    asciiJavaScriptOutputPlugin() // 转义非 ASCII 字符
  ],
  alias: {
    '@wxt-dev/browser': 'core/browser/safe-wxt-browser.ts',
    'wxt/browser': 'core/browser/safe-wxt-browser.ts'
  }
}

// 定义编译时常量
{
  __DOUBAO_WPLUS_E2E__: process.env.DOUBAO_WPLUS_E2E === '1' ? '1' : undefined,
  __DOUBAO_WPLUS_DEV__: env.mode === 'development' ? 'true' : 'false'
}
```

### 6.2 TypeScript 配置 (tsconfig.json)

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "lib": ["ES2020", "DOM", "DOM.Iterable", "WebWorker"],
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "moduleResolution": "bundler"
  }
}
```

### 6.3 Vitest 配置 (vitest.config.ts)

```typescript
export default defineConfig({
  test: {
    environment: 'jsdom',
    // 单元测试配置
  }
});
```

### 6.4 Playwright 配置 (playwright.config.ts)

```typescript
{
  use: {
    // E2E 测试浏览器与选项
  },
  webServer: {
    // 启动开发服务器
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
  }
}
```

### 6.5 环境变量

| 变量 | 用途 | 值 |
|-----|-----|-----|
| `DOUBAO_WPLUS_E2E` | 启用 E2E 诊断标记 | '1' 或未设置 |
| `CI` | 持续集成环境 | 由 CI/CD 系统设置 |
| `DEBUG` | 开发调试 | 用户设置 |

---

## 7. 依赖分析

### 7.1 核心依赖

```json
{
  "dependencies": {
    "dexie": "^4.4.2",              // IndexedDB 包装，存储用户数据
    "pyodide": "^314.0.0",          // Python 沙箱执行
    "react": "^19.2.4",             // UI 框架
    "react-dom": "^19.2.4",         // React DOM 渲染
    "react-markdown": "^10.1.0",    // Markdown 渲染
    "sucrase": "^3.35.1"            // TypeScript 转换
  },
  "devDependencies": {
    "@playwright/test": "^1.49.0",  // E2E 测试
    "@tailwindcss/vite": "^4.2.4",  // Tailwind 构建
    "@types/chrome": "^0.1.42",     // Chrome API 类型
    "@types/react": "^19.2.14",     // React 类型
    "@wxt-dev/module-react": "^1.1.5", // WXT React 模块
    "jsdom": "^29.1.1",             // DOM 模拟（测试）
    "tailwindcss": "^4.2.4",        // CSS 框架
    "typescript": "^5.9.3",         // 类型系统
    "vitest": "^4.1.8",             // 单元测试
    "wxt": "^0.20.26"               // 扩展框架
  }
}
```

### 7.2 未在 package.json 中但被使用的库

| 库 | 用途 | 来源 |
|----|-----|------|
| rrule | Cron 表达式解析 | 可能通过其他包依赖 |
| ava-assert / vitest assert | 单元测试断言 | vitest 内置 |
| posthog / analytics | 分析（可能） | 未找到，可能未启用 |

### 7.3 浏览器 API 使用

```typescript
// Chrome 扩展 API
chrome.runtime
chrome.storage
chrome.alarms
chrome.nativeMessaging
chrome.contextMenus
chrome.tabs
chrome.downloads
chrome.debugger        // 浏览器控制
chrome.devtools        // DevTools Protocol

// Web API
fetch
JSON
IndexedDB (via Dexie)
SharedWorker / Worker
EventSource (SSE)
WebSocket (potential MCP)
```

---

## 8. 代码质量评估

### 8.1 架构优势

✅ **多宿主适配器模式** - 通过 Strategy Pattern 清晰隔离 Doubao/DeepSeek 差异
✅ **Fetch Hook 拦截** - 核心设计优雅，支持无缝的请求/响应增强
✅ **工具执行框架** - 统一的工具定义与执行接口，支持多种来源（MCP/Web/内置）
✅ **类型安全** - 完整的 TypeScript 类型定义，包括 Union types
✅ **存储分层** - IndexedDB (结构化) + Storage API (配置) 的合理分离
✅ **消息传递** - 清晰的 Chrome runtime message 协议定义
✅ **状态隔离** - Project scope 隔离全局和项目级记忆

### 8.2 潜在问题

⚠️ **Fetch Hook 复杂度过高** (fetch-hook.ts ~700+ lines)
   - 建议：分离 SSE parsing / tool parsing / continuation logic

⚠️ **缺少错误恢复机制** 
   - MCP 连接断开时无自动重连
   - 工具执行超时无重试机制

⚠️ **内存泄漏风险**
   - SSE 流处理中的 ReadableStream listener 未显式清理
   - 工具循环续跑的 Promise chain 可能积累

⚠️ **缺少请求去重**
   - 快速连续点击发送可能产生重复请求

⚠️ **选择器硬编码**
   - 虽然有 adapter 抽象，但宿主 UI 变化时需快速适配

### 8.3 TODO & FIXME 标记

根据 git status，以下文件可能含有待办事项（需进一步检查）：
- core/automation/* - 自动化系统可能有完善性 TODO
- core/mcp/* - MCP 传输层可能有边界情况 TODO
- core/export/* - 导出系统对大对话的优化 TODO

### 8.4 测试覆盖

- ✅ E2E 测试（Playwright）
- ✅ 单元测试（Vitest）
- ✅ Smoke 测试：
  - `npm run smoke:mcp` - MCP 功能测试
  - `npm run smoke:shell` - Shell 工具测试
  - `npm run smoke:pow` - PoW 机制测试
  - `npm run smoke:web` - Web 工具测试
- ✅ 质量检查：
  - `npm run verify:automation` - 自动化合约校验
  - `npm run verify:i18n` - 国际化覆盖率
  - `npm run verify:manifest-policy` - Manifest 策略校验

---

## 9. 后续开发建议

### 9.1 优先级高的优化方向

#### 1. Fetch Hook 重构（高风险，中优先级）
当前 fetch-hook.ts 约 700+ 行，集合了：
- SSE 流解析
- 工具调用识别
- 工具执行路由
- 结果续跑

**建议分离：**
```
fetch-hook.ts
  ├─ request.ts - 请求拦截与增强
  ├─ response.ts - 响应处理主流程
  ├─ streaming.ts - SSE 流式解析与工具识别
  └─ continuation.ts - 续跑与结果回传
```

#### 2. MCP 自动重连（中风险，中优先级）
```typescript
// core/mcp/client.ts 中添加
interface McpClientOptions {
  maxRetries: number;
  retryDelayMs: number;
  autoReconnect: boolean;
}

async function connectWithRetry(config: McpServerConfig, options: McpClientOptions) {
  for (let attempt = 0; attempt < options.maxRetries; attempt++) {
    try {
      return await connect(config);
    } catch (error) {
      if (attempt < options.maxRetries - 1) {
        await sleep(options.retryDelayMs * Math.pow(2, attempt)); // exponential backoff
      } else {
        throw error;
      }
    }
  }
}
```

#### 3. 工具执行超时与重试（低风险，中优先级）
```typescript
// core/tool/runtime.ts 中添加
interface ToolExecutionOptions {
  timeoutMs: number;
  maxRetries: number;
  retryableErrors: string[]; // 可重试的错误类型
}

async function executeWithTimeout(call: ToolCall, options: ToolExecutionOptions) {
  // 使用 Promise.race() 实现 timeout
  // 实现重试机制（仅对网络错误、超时等）
}
```

#### 4. 大对话导出优化（低风险，中优先级）
当前导出全量对话到内存，大对话（1000+ 条消息）可能导致 OOM。
```typescript
// core/export/service.ts
// 实现流式导出，逐条消息处理而不是全量加载
async function* streamConversationExport(sessionId: string) {
  const pageSize = 50;
  for (let page = 0; ; page++) {
    const messages = await fetchHistoryPage(sessionId, page, pageSize);
    if (messages.length === 0) break;
    for (const msg of messages) {
      yield normalizeMessage(msg);
    }
  }
}
```

### 9.2 新功能建议

#### 1. 多文件工具调用支持（中优先级）
当前工具调用为单个，建议支持批量工具调用：
```xml
<batch_tools>
  <web_search>{"query": "..."}  </web_search>
  <web_fetch>{"url": "..."}  </web_fetch>
</batch_tools>
```

#### 2. 工具结果缓存（中优先级）
相同参数的工具调用可使用缓存，减少重复执行：
```typescript
// core/tool/cache.ts
interface ToolResultCache {
  key: string; // hash(toolName + JSON.stringify(arguments))
  result: ToolResult;
  expiresAt: number;
}
```

#### 3. 离线记忆搜索（中优先级）
当前记忆注入是线性遍历，大量记忆时性能下降。建议：
- 使用 Dexie 全文搜索索引
- 实现向量化记忆相似度搜索（嵌入向量）

#### 4. 项目间记忆共享（低优先级）
当前记忆是项目隔离，建议支持：
- 全局记忆标记为"共享"
- 项目级记忆跨项目继承链

### 9.3 性能优化

| 优化项 | 当前状态 | 建议 |
|------|--------|------|
| 初始化加载 | 冷启动 5s | 延迟加载非核心模块 |
| 记忆检索 | O(n) 线性 | 添加索引，O(1) 查询 |
| 工具执行 | 顺序执行 | 支持并行执行（web_search + web_fetch） |
| DOM 更新 | 全量重排 | 使用 React Virtual List |
| SSE 流处理 | 逐字符解析 | Batch 解析，减少 parsing 频率 |

### 9.4 安全加固

| 风险 | 当前措施 | 建议 |
|-----|--------|------|
| CSRF | - | 在请求头中添加 CSRF token |
| XSS | 部分 sanitize | 完整的 HTML sanitizer (DOMPurify) |
| 敏感信息泄露 | 导出时清理 | 添加 password/token 检测黑名单 |
| MCP 沙箱逃逸 | 依赖浏览器沙箱 | 进程隔离 + 权限最小化 |
| 恶意 Skill 代码执行 | 用户导入时需注意 | 签名验证 + 代码审查建议 |

---

## 10. 项目知识库（Knowledge Base）

### 10.1 记忆系统模块

**涉及文件：**
- core/memory/store.ts - 存储层
- core/memory/injector.ts - 注入层
- core/memory/scope.ts - 作用域隔离
- core/memory/selector.ts - 记忆筛选
- core/memory/importer.ts - 导入工具
- core/tool/memory.ts - 记忆工具定义
- entrypoints/sidepanel/pages/MemoryPage.tsx - UI

**核心函数：**
- `saveMemory(memory)` - 保存
- `updateMemory(id, update)` - 更新
- `deleteMemory(id)` - 删除
- `getMemoriesForInjection(projectId?)` - 获取注入列表
- `injectMemoriesIntoPrompt(memories)` - 格式化为 prompt

**工具调用：**
- `memory_save` - XML 标签调用
- `memory_update` - XML 标签调用
- `memory_delete` - XML 标签调用

**数据库表：**
```typescript
dexie.memories = {
  primaryKey: 'id',
  indexes: ['syncId', 'scope', 'projectId', 'tags', 'pinned']
}
```

### 10.2 MCP 工具系统

**涉及文件：**
- core/mcp/client.ts - 客户端
- core/mcp/discovery.ts - 工具发现
- core/mcp/store.ts - 配置存储
- core/mcp/transports/* - 传输层（HTTP/SSE/Native/Bridge）
- core/tool/runtime.ts - 执行路由

**核心类/接口：**
```typescript
class McpProtocolClient {
  initialize(): Promise<McpInitializeResult>
  listTools(): Promise<ToolDescriptor[]>
  callTool(options: McpCallToolOptions): Promise<ToolResult>
}

interface McpServerConfig {
  id, displayName, transport, headers, secrets, ...
}
```

**传输方式：**
| 方式 | 文件 | 何时使用 |
|-----|-----|--------|
| HTTP | transports/http.ts | 连接到 HTTP 服务器 |
| SSE | transports/sse.ts | 实时推送工具结果 |
| Native Messaging | transports/native.ts | Shell MCP / 本机工具 |
| Bridge | transports/bridge.ts | 子进程通信 |

**生命周期：**
1. 用户在 MCP 页添加服务器
2. McpServerConfig 存入 Dexie
3. 首次列表工具时，建立连接
4. 工具调用时，路由到对应 transport
5. 结果返回 ToolResult

### 10.3 自动化系统

**涉及文件：**
- core/automation/store.ts - 自动化存储
- core/automation/scheduler.ts - Cron 调度
- core/automation/runner.ts - 执行器
- entrypoints/sidepanel/pages/AutomationPage.tsx - UI

**核心流程：**
```
创建 Automation → 保存到 Dexie
         ↓
Scheduler 解析 Cron，计算 nextRunAt
         ↓
Chrome Alarms API 定时触发
         ↓
Runner 在 DOM 中查找标签页
         ↓
通过 Bridge 消息驱动 content script
         ↓
返回 AutomationRunnerResult 到 Dexie
```

**状态机：**
```
pending → (schedule matches) → queued → (start) → running 
  → (success) → succeeded / (failure) → failed / (timeout) → timeout
```

### 10.4 Skill 工作流

**涉及文件：**
- core/skill/registry.ts - Skill 注册表
- core/skill/builtin.ts - 内置 Skill（shell, memory, ultra-think, /officecli）
- core/skill/github-importer.ts - GitHub 导入
- core/skill/local-importer.ts - 本地文件导入
- core/skill/parser.ts - 元数据解析
- entrypoints/sidepanel/pages/SkillPage.tsx - UI

**Skill 来源：**
| 来源 | 文件 | 说明 |
|-----|-----|------|
| builtin | builtin.ts | 硬编码到扩展中 |
| custom | registry.ts | 用户手工编辑 |
| github | github-importer.ts | 从 GitHub 导入 |
| local | local-importer.ts | 从本地文件导入 |

**内置 Skill 列表：**
1. **shell** - 通过 Native Messaging 执行本机命令
2. **memory** - 记忆管理工作流
3. **ultra-think** - 极致深度思考（reasoning effort max）
4. **/officecli*** - Office 文档工具（第三方库）

**触发机制：**
```
用户输入 "/skill-name ..." 
  ↓
Fetch Hook 识别 Skill Trigger (SKILL_TRIGGER_REGEX)
  ↓
替换 prompt 为对应 Skill.instructions
  ↓
执行修改后的 prompt
```

### 10.5 导出系统

**涉及文件：**
- core/export/service.ts - 导出协调
- core/export/artifact-*.ts - 格式化处理
- core/export/normalize.ts - 数据归一化
- core/export/sanitize.ts - 清理敏感信息
- core/export/attachments.ts - 附件处理

**导出格式：**
| 格式 | 文件 | 支持内容 |
|-----|-----|---------|
| HTML | artifact-html.ts | 完整会话 + 样式 |
| Markdown | artifact-markdown.ts | 纯文本 + 代码块 |
| PDF | artifact-pdf.ts | 可打印格式 |
| JSON | artifact-json.ts | 结构化数据 |
| TXT | artifact-txt.ts | 纯文本 |
| Image Manifest | secondary-artifacts.ts | 图片清单 |

**导出流程：**
```
用户点击导出
  ↓
runConversationExport(request)
  ├─ 列表会话 (listSessions)
  ├─ 逐会话获取历史 (fetchHistory)
  ├─ 收集附件 (fetchFiles)
  ├─ 归一化数据 (normalizeDeepSeekHistory)
  ├─ 清理敏感信息 (sanitizeConversationExport)
  ├─ 按格式生成产物
  └─ 返回 ConversationExport
```

---

## 11. 核心文件索引

### 11.1 高优先级文件（核心业务）

| 文件 | 行数 | 作用 | 依赖关系 |
|-----|-----|------|--------|
| core/interceptor/fetch-hook.ts | ~800 | Fetch 拦截与工具执行 | 核心驱动 |
| core/hosts/registry.ts | ~78 | 宿主适配器注册与检测 | 所有 adapter |
| core/automation/scheduler.ts | ~150 | 自动化定时调度 | Chrome Alarms |
| core/mcp/client.ts | ~400 | MCP 协议客户端 | transports/* |
| core/memory/injector.ts | ~100 | 记忆注入到 prompt | memory/store |
| core/tool/runtime.ts | ~200 | 工具执行路由器 | MCP/web/sandbox |
| core/export/service.ts | ~200 | 对话导出协调 | artifact-* |
| entrypoints/background.ts | ~300 | Service Worker 主线程 | 所有 core 模块 |

### 11.2 中优先级文件（功能支撑）

| 文件 | 作用 |
|-----|------|
| core/memory/store.ts | IndexedDB 记忆存储 |
| core/skill/registry.ts | Skill 注册与管理 |
| core/preset/store.ts | System Prompt 预设管理 |
| core/project/store.ts | 项目上下文管理 |
| core/prompt/index.ts | System prompt 建构 |
| core/i18n/index.ts | 国际化资源加载 |
| core/platform/index.ts | 浏览器能力检测 |
| entrypoints/sidepanel/App.tsx | React 主应用入口 |

### 11.3 低优先级文件（辅助工具）

| 文件 | 作用 |
|-----|------|
| core/diagnostics/dev-diagnostics.ts | 开发调试支持 |
| core/sync/webdav-client.ts | WebDAV 同步客户端 |
| core/shell/index.ts | Shell 工具集成 |
| core/sandbox/python-worker.ts | Python 沙箱 worker |
| core/ui/injected-theme.ts | 页面内主题注入 |

---

## 12. 架构决策与权衡

### 12.1 为什么选择 Fetch Hook 而不是直接调用 API？

**优势：**
- 无需修改页面 UI 代码
- 可以透明地增强所有请求
- 支持热切换宿主（Doubao ↔ DeepSeek）

**劣势：**
- 需要维护 DOM 选择器
- Fetch Hook 复杂度高
- 对页面刷新不友好（需要重新拦截）

### 12.2 为什么使用 IndexedDB 而不是 localStorage？

**选择 IndexedDB 的原因：**
- ✅ 支持大数据量（localStorage 通常 5MB 限制）
- ✅ 结构化查询（key-value 对象）
- ✅ 索引支持（加速搜索）
- ✅ 异步 API（不阻塞 UI）

**缺点：**
- 浏览器 API 复杂度较高（通过 Dexie 缓解）
- 无跨浏览器同步（通过 WebDAV 缓解）

### 12.3 为什么使用 PostMessage Bridge 而不是 chrome.tabs.executeScript？

**选择 Bridge 的原因：**
- ✅ 支持长时间运行的任务
- ✅ 可双向通信（background ↔ content）
- ✅ 事件驱动，易于扩展

**缺点：**
- 需要额外的消息协议定义
- 难以追踪复杂消息链

### 12.4 为什么支持多个 MCP Transport？

**设计考虑：**
- HTTP - 远程服务器（标准协议）
- SSE - 实时推送（简化架构）
- Native Messaging - 本机工具（安全边界）
- Stdio Bridge - 容器环境（灵活适配）

**好处：** 一套 MCP 协议，支持多种部署场景

---

## 13. 开发工作流建议

### 13.1 首次阅读顺序

1. **理解宿主适配** (30 min)
   - core/hosts/types.ts - 接口定义
   - core/hosts/registry.ts - 注册表
   - core/hosts/doubao/adapter.ts - 具体实现

2. **理解 Fetch Hook** (1 hour)
   - core/interceptor/fetch-hook.ts - 核心流程
   - core/interceptor/request-augmentation.ts - 请求增强
   - core/interceptor/sse-parser.ts - 响应解析

3. **理解工具执行** (1 hour)
   - core/tool/types.ts - 类型定义
   - core/tool/invocation.ts - 工具目录
   - core/tool/runtime.ts - 执行路由

4. **理解数据存储** (30 min)
   - core/types.ts - 数据模型
   - core/memory/store.ts - 记忆存储
   - core/automation/store.ts - 自动化存储

5. **理解消息传递** (30 min)
   - entrypoints/background.ts - Service Worker
   - core/messaging.ts - 消息协议
   - entrypoints/sidepanel/App.tsx - UI 入口

### 13.2 修改工作流

#### 要修改宿主适配
1. 编辑 `core/hosts/{doubao,deepseek}/adapter.ts`
2. 在 `getSelectors()` 中更新 CSS 选择器
3. 运行 `npm run dev`，在扩展配置页测试选择器健康检查
4. 若修改了 API 路径，更新 `getPaths()`

#### 要添加新工具
1. 编辑 `core/tool/invocation.ts` 的 `DEFAULT_TOOL_DESCRIPTORS`
2. 编辑 `core/tool/runtime.ts` 的 `executeRuntimeToolCall` 添加 case
3. 若是内置工具，在 `core/tool/` 下新建文件实现逻辑
4. 若是 MCP 工具，工具会自动从 MCP 服务器列表中发现

#### 要修改记忆注入策略
1. 编辑 `core/memory/injector.ts` 的 `injectMemoriesIntoPrompt()`
2. 修改排序、过滤或格式化逻辑
3. 编辑 `core/constants.ts` 的 `SYSTEM_TEMPLATE_*` 调整 system prompt

#### 要添加新的自动化特性
1. 编辑 `core/automation/types.ts` 扩展数据模型
2. 编辑 `core/automation/runner.ts` 添加执行逻辑
3. 编辑 `entrypoints/sidepanel/pages/AutomationPage.tsx` 添加 UI

### 13.3 调试技巧

**启用开发诊断：**
```typescript
// core/diagnostics/dev-diagnostics.ts
export function isDevDiagnosticsEnabled(): boolean {
  return __DOUBAO_WPLUS_DEV__ === 'true';
}

// 查看最后捕获的请求
const lastRequest = getLastCapturedRequest();
console.log(lastRequest);
```

**查看 IndexedDB 内容：**
```javascript
// 在浏览器控制台
const db = new Dexie('doubao-wplus');
const memories = await db.memories.toArray();
console.log(memories);
```

**监听消息：**
```typescript
// 在 background service worker 中
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  console.log('received:', msg);
  // ... handler logic
});
```

---

## 14. 风险分析与缓解方案

### 14.1 架构风险

| 风险 | 等级 | 影响 | 缓解方案 |
|-----|-----|------|--------|
| Fetch Hook 过度复杂 | 🔴 高 | 难以维护与扩展 | 分离 SSE/Tool/Continuation 逻辑 |
| DOM 选择器易失效 | 🔴 高 | 功能降级或完全失效 | 自动选择器检测 + 备选方案 |
| 宿主 API 变化 | 🔴 高 | 扩展失效 | 版本检测 + 多 API 版本支持 |
| MCP 连接不稳定 | 🟡 中 | 工具执行失败 | 自动重连 + 超时重试 |
| IndexedDB 数据损坏 | 🟡 中 | 数据丢失 | 定期备份 + WebDAV 同步 |

### 14.2 安全风险

| 风险 | 等级 | 影响 | 缓解方案 |
|-----|-----|------|--------|
| 恶意 Skill 代码执行 | 🔴 高 | 系统被入侵 | 代码签名验证 + 用户审批 |
| MCP 工具权限过大 | 🔴 高 | 隐私泄露 | 权限白名单 + 用户授权 |
| 记忆敏感信息泄露 | 🔴 高 | 隐私暴露 | 导出清理 + 加密存储选项 |
| CSRF 攻击 | 🟡 中 | 非授权操作 | CSRF token 验证 |
| XSS 攻击 | 🟡 中 | 脚本注入 | HTML Sanitizer + CSP |

### 14.3 性能风险

| 风险 | 等级 | 影响 | 缓解方案 |
|-----|-----|------|--------|
| 大量记忆导致加载缓慢 | 🟡 中 | 首次加载 > 5s | 索引优化 + 延迟加载 |
| SSE 流处理占用 CPU | 🟡 中 | 页面卡顿 | 批量解析 + Worker 处理 |
| 大对话导出 OOM | 🟡 中 | 浏览器崩溃 | 流式导出 + 分页处理 |
| 工具循环无限续跑 | 🟡 中 | 消耗配额 | 最大续跑步数限制 |

---

## 15. 最终总结

### 项目定位
**Doubao WPlus** 是一个为豆包网页版设计的、具有企业级功能的浏览器扩展，通过 **Fetch Hook + Multi-Host Adapter** 的架构，为 AI 工作流注入了记忆、工具执行、自动化和导出能力。

### 核心架构
```
多宿主适配 (Doubao/DeepSeek)
    ↓
Fetch Hook 拦截 & 请求增强
    ↓
工具执行框架 (MCP/内置/Web)
    ↓
IndexedDB 数据存储 + WebDAV 同步
    ↓
React Sidepanel UI + 页面内联渲染
```

### 核心模块
1. **Fetch Hook** - 透明的请求/响应增强
2. **Host Adapter** - 多宿主统一接口
3. **Tool Runtime** - 多源工具执行
4. **Memory System** - 跨会话记忆管理
5. **Automation Engine** - 定时任务调度
6. **MCP Client** - 协议工具集成
7. **Export Service** - 多格式对话导出

### 最重要的文件
1. `core/interceptor/fetch-hook.ts` - 核心驱动
2. `core/hosts/registry.ts` - 宿主适配
3. `entrypoints/background.ts` - Service Worker
4. `core/tool/runtime.ts` - 工具执行
5. `core/memory/injector.ts` - 记忆注入

### 开发重点
- 保持 Fetch Hook 的可维护性
- 快速响应宿主 UI 变化
- 增强工具执行的稳定性
- 优化大规模数据处理

### 后续开发建议
1. **立即做** - Fetch Hook 分离，MCP 自动重连
2. **短期做** - 工具缓存，离线记忆搜索
3. **长期做** - 向量记忆搜索，多文件工具调用
4. **持续做** - 性能优化，安全加固，测试覆盖

---

## 附录

### A. 快速参考：常用 API

```typescript
// 获取所有记忆
const memories = await getAllMemories();

// 保存新记忆
await saveMemory({
  type: 'user',
  name: '我的职业',
  content: '前端开发工程师',
  tags: ['职业'],
  pinned: false
});

// 获取 MCP 服务器列表
const servers = await getMcpServers();

// 执行工具调用
const result = await executeRuntimeToolCall({
  name: 'web_search',
  arguments: { query: '...' }
});

// 创建自动化任务
await createAutomation({
  name: '每日报告',
  prompt: '总结今日新闻',
  schedule: {
    kind: 'cron',
    expression: '0 9 * * *',
    timezone: 'Asia/Shanghai'
  }
});

// 获取当前活跃宿主
const host = getActiveAdapter();
console.log(host.name); // 'doubao' or 'deepseek'
```

### B. 环境变量

```bash
# 启用 E2E 诊断标记
export DOUBAO_WPLUS_E2E=1

# 运行开发服务器
npm run dev

# 运行单元测试
npm run test

# 运行 E2E 测试
npm run test:e2e

# 构建生产版本
npm run build:all

# WebDAV 同步测试
npm run smoke:web
```

### C. 常见问题解答

**Q: 为什么我的工具调用没有执行？**  
A: 检查：
1. 工具是否在 `DEFAULT_TOOL_DESCRIPTORS` 中定义
2. MCP 服务器是否已启用并连接
3. 权限中是否允许该工具

**Q: 记忆注入后为什么没有生效？**  
A: 检查：
1. 记忆是否属于当前项目（若有项目限制）
2. 记忆是否被 project scope 过滤排除
3. 记忆总大小是否超过 MEMORY_TOKEN_BUDGET

**Q: 自动化任务为什么没有定时触发？**  
A: 检查：
1. Automation 状态是否为 'active'
2. Schedule.enabled 是否为 true
3. Chrome Alarms 权限是否被授予
4. nextRunAt 时间是否已过期

---

**报告生成时间：** 2026-07-16  
**项目版本：** 0.1.0  
**分析范围：** 完整源代码（159 TypeScript 文件）

此报告可作为新 AI 开发者快速上手的参考，无需重新阅读整个项目。
