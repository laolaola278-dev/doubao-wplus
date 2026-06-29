# doubao_wplus 可执行迁移方案

**项目代号：** doubao_wplus（豆包 WPlus）  
**源项目：** deepseek-pp v0.7.5  
**工作目录：** `D:\xjx\MCP\doubao-wplus`  
**版本：** v0.1.0  
**日期：** 2026-06-29  
**文档版本：** v2.0（根据评审反馈重写）

---

## 一、目标与非目标

### 1.1 目标

将现有 DeepSeek WPlus 浏览器扩展改造为**以豆包网页为默认宿主、兼容 DeepSeek 的多宿主 AI Agent 工作台**，支持：

- 对话增强（记忆注入、Skill 触发、系统提示词预设）
- 对话导出（HTML / Markdown / PDF）
- 任务管理（自动化调度、项目上下文）
- 宠物交互（悬浮精灵）
- 历史会话处理（DOM 增强 + 接口拦截）
- 浏览器控制（受控标签页操作）
- MCP 工具调用

### 1.2 非目标

- ❌ 第一阶段不追求覆盖豆包所有实验性功能
- ❌ 不主动绕过平台安全机制（如 a_bogus 签名逆向）
- ❌ 不保证对豆包未来 DOM 改版的永久兼容
- ❌ 不处理移动端网页
- ❌ 不接入第三个宿主（除非架构已验证稳定）
- ❌ 不开发独立的豆包 API 客户端（优先网页增强模式）

### 1.3 产品定位

**网页增强型 Agent 工作台**，不是某个平台的私有 API 客户端。

核心路线：
1. 先保证 DOM 层可用，再增强接口层能力
2. 先建立 HostAdapter，再做具体宿主适配
3. 先有降级策略，再追求完整能力
4. 先保证权限和迁移安全，再做体验美化

---

## 二、模块责任边界图

```
┌─────────────────────────────────────────────────────────────────────┐
│                      Browser Extension                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────┐    ┌──────────────────┐    ┌──────────────────┐  │
│  │ Content Script│◄──►│ Main World Script│    │  Sidepanel UI    │  │
│  │ (ISOLATED)    │    │ (MAIN)           │    │  (React)         │  │
│  └──────┬───────┘    └────────┬─────────┘    └────────┬─────────┘  │
│         │                     │                        │            │
│         ▼                     ▼                        ▼            │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    Core Runtime                             │   │
│  │                                                             │   │
│  │  ┌─────────────────────────────────────────────────────┐   │   │
│  │  │              Host Registry (NEW)                     │   │   │
│  │  │  ┌──────────────┐    ┌──────────────────┐           │   │   │
│  │  │  │ DoubaoAdapter │    │ DeepSeekAdapter  │           │   │   │
│  │  │  │ - selectors   │    │ - selectors      │           │   │   │
│  │  │  │ - urlParser   │    │ - urlParser      │           │   │   │
│  │  │  │ - reqMatcher  │    │ - reqMatcher     │           │   │   │
│  │  │  │ - normalizer  │    │ - normalizer     │           │   │   │
│  │  │  └──────────────┘    └──────────────────┘           │   │   │
│  │  └─────────────────────────────────────────────────────┘   │   │
│  │         │                                                    │   │
│  │         ▼                                                    │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐   │   │
│  │  │ Fetch Hook   │  │ Storage Layer│  │ Export Layer     │   │   │
│  │  │ (拦截/增强)  │  │ (迁移管理)   │  │ (HTML/MD/PDF)    │   │   │
│  │  └──────────────┘  └──────────────┘  └──────────────────┘   │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐   │   │
│  │  │ Memory       │  │ Skill System │  │ MCP / Tools      │   │   │
│  │  └──────────────┘  └──────────────┘  └──────────────────┘   │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**核心原则：** 宿主差异收敛到 HostAdapter，不散落在业务模块里。content.ts、fetch-hook.ts、export.ts、storage.ts 只调用 adapter 接口，不直接判断宿主。

---

## 三、HostAdapter 抽象设计

### 3.1 接口定义

```typescript
// core/hosts/types.ts

export type HostId = 'doubao' | 'deepseek';

export interface HostSelectors {
  messageList: string[];        // 消息列表容器（数组 = fallback 链）
  assistantMessage: string[];   // 助手消息
  userMessage: string[];        // 用户消息
  inputBox: string[];           // 文本输入框
  sendButton: string[];         // 发送按钮
  loadingIndicator: string[];   // 生成中指示器
  actionRow: string[];          // 操作按钮行
}

export interface HostAdapter {
  readonly id: HostId;
  readonly name: string;
  readonly matchPatterns: string[];  // content script matches

  // URL 匹配
  matchUrl(url: string): boolean;
  isChatStreamUrl(url: string): boolean;
  isHistoryUrl(url: string): boolean;

  // 会话识别
  getSessionId(location: Location): string | null;
  getConversationTitle(doc: Document): string;

  // DOM 选择器
  getSelectors(): HostSelectors;

  // 请求路径
  getPaths(): {
    completion: string;
    regenerate: string;
    history: string;
  };

  // 消息规范化
  normalizeMessage(raw: unknown): NormalizedMessage | null;

  // 页面状态
  detectPageState(doc: Document): PageState;
}

export type PageState =
  | 'logged_out'
  | 'empty_conversation'
  | 'idle'
  | 'generating'
  | 'network_error';

export interface NormalizedMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  parentId: string | null;
  createdAt: number;
}
```

### 3.2 目录结构

```
core/hosts/
├── types.ts                  # HostAdapter 接口 + 公共类型
├── registry.ts               # 宿主注册表 + 自动检测
├── doubao/
│   └── adapter.ts            # 豆包适配器实现
├── deepseek/
│   └── adapter.ts            # DeepSeek 适配器实现
└── shared/
    ├── selector-utils.ts     # queryFirst() fallback 工具
    ├── url-utils.ts          # parseSessionId() 可测试模块
    └── migration.ts          # storage 迁移管理
```

### 3.3 Selector Fallback 工具

```typescript
// core/hosts/shared/selector-utils.ts

export function queryFirst(
  selectors: string[],
  root: ParentNode = document,
): Element | null {
  for (const selector of selectors) {
    const el = root.querySelector(selector);
    if (el) return el;
  }
  return null;
}

export function queryAll(
  selectors: string[],
  root: ParentNode = document,
): Element[] {
  for (const selector of selectors) {
    const els = root.querySelectorAll(selector);
    if (els.length > 0) return Array.from(els);
  }
  return [];
}
```

### 3.4 URL Session 解析（可测试模块）

```typescript
// core/hosts/shared/url-utils.ts

export function parseSessionId(url: string, host: HostId): string | null {
  try {
    const parsed = new URL(url);
    switch (host) {
      case 'deepseek':
        // /a/chat/s/{sessionId}  或  /chat/s/{sessionId}
        const dsMatch = parsed.pathname.match(/\/(?:a\/)?chat\/s\/([^/?#]+)/);
        return dsMatch?.[1] ? decodeURIComponent(dsMatch[1]) : null;

      case 'doubao':
        // TODO: 待 DOM 调研后补充豆包 URL 规则
        // 占位：/chat/{sessionId}
        const dbMatch = parsed.pathname.match(/\/chat\/([^/?#]+)/);
        return dbMatch?.[1] ? decodeURIComponent(dbMatch[1]) : null;

      default:
        return null;
    }
  } catch {
    return null;
  }
}
```

**测试用例矩阵：**

| 场景 | 输入 URL | Host | 预期输出 |
|------|----------|------|----------|
| DeepSeek 历史会话 | `https://chat.deepseek.com/a/chat/s/abc123` | deepseek | `abc123` |
| DeepSeek 无 session | `https://chat.deepseek.com/` | deepseek | `null` |
| DeepSeek 带 query | `https://chat.deepseek.com/a/chat/s/abc?ref=home` | deepseek | `abc` |
| 豆包普通会话 | `https://www.doubao.com/chat/xxx` | doubao | `xxx`（待确认） |
| 豆包新建会话 | `https://www.doubao.com/chat` | doubao | `null` |
| 非目标页面 | `https://www.google.com/` | doubao | `null` |
| 分享页 | `https://www.doubao.com/share/xxx` | doubao | `null`（待确认） |

---

## 四、降级策略

| 功能 | 首选方案 | 降级方案 |
|------|----------|----------|
| 获取助手回复 | 拦截 stream 响应 | 从 DOM 提取最终文本 |
| 获取历史会话 | 调用历史 API | 当前页面 DOM 解析 |
| 导出会话 ID | URL 解析 | 生成临时 local session id |
| 消息状态 | 接口事件判断 | DOM loading indicator 判断 |
| 导出标题 | API 会话标题 | 页面标题 / 首条用户消息 |
| 多宿主识别 | HOST_CONFIG 匹配 | 当前 location fallback |
| 请求签名 | 复用浏览器登录态 | DOM 增强模式（不发起独立请求） |
| 宠物精灵 | 宿主品牌精灵图 | 通用默认精灵 |

---

## 五、Storage 迁移方案

### 5.1 数据分类

| 数据类型 | 策略 | 示例 |
|----------|------|------|
| 通用配置 | 共享，直接迁移 | 主题、快捷键、导出格式、语言偏好 |
| 宿主相关 | 按 host 隔离 | selector 缓存、会话状态、接口路径 |
| 旧版数据 | 迁移后保留，不立即删除 | 回滚兼容 |

### 5.2 存储键设计

```
doubao_wplus:settings:global              # 通用配置
doubao_wplus:settings:host:doubao         # 豆包宿主配置
doubao_wplus:settings:host:deepseek       # DeepSeek 宿主配置
doubao_wplus:migration:version            # 迁移版本号
doubao_wplus:memories                     # 记忆（通用）
doubao_wplus:skills                       # Skill（通用）
doubao_wplus:presets                      # 预设（通用）
```

### 5.3 迁移流程

```typescript
// core/hosts/shared/migration.ts

const CURRENT_MIGRATION_VERSION = 1;

export async function runMigration(): Promise<void> {
  const stored = await chrome.storage.local.get('doubao_wplus:migration:version');
  const version = stored['doubao_wplus:migration:version'] ?? 0;

  if (version >= CURRENT_MIGRATION_VERSION) return;

  if (version === 0) {
    // 从 deepseek_pp_* 迁移到 doubao_wplus:*
    await migrateFromDeepSeekPP();
  }

  await chrome.storage.local.set({
    'doubao_wplus:migration:version': CURRENT_MIGRATION_VERSION,
  });
}

async function migrateFromDeepSeekPP(): Promise<void> {
  const all = await chrome.storage.local.get(null);
  const mappings: Record<string, string> = {
    // 通用配置：直接重命名
    'deepseek_pp_locale_preference': 'doubao_wplus:settings:global:locale',
    'deepseek_pp_chat_enabled': 'doubao_wplus:settings:global:chatEnabled',
    // ... 更多映射
  };

  for (const [oldKey, newKey] of Object.entries(mappings)) {
    if (oldKey in all) {
      await chrome.storage.local.set({ [newKey]: all[oldKey] });
      // 保留旧 key，不删除（回滚兼容）
    }
  }
}
```

---

## 六、品牌替换扫描清单

| 类型 | 位置 | 当前值 | 目标值 | 状态 |
|------|------|--------|--------|------|
| manifest name | `_locales/*/messages.json` | DeepSeek++ | 豆包 WPlus | ✅ 已完成 |
| 导出文件名 | `core/export/artifact-filename.ts` | `deepseek-conversations-` | `doubao-conversations-` | 🔲 待做 |
| 导出 HTML 标题 | `core/export/artifact-html.ts` | `DeepSeek Conversation Export` | `豆包对话导出` | 🔲 待做 |
| 导出 MD 标题 | `core/export/artifact-markdown.ts` | `# DeepSeek Conversation Export` | `# 豆包对话导出` | 🔲 待做 |
| 导出 PDF 标题 | `core/export/artifact-pdf.ts` | `DeepSeek Conversation Export` | `豆包对话导出` | 🔲 待做 |
| 错误提示 | `core/browser-control/service.ts` | `DeepSeek++ side panel` | `豆包 WPlus 侧边栏` | 🔲 待做 |
| 宠物精灵图 | `entrypoints/content.ts` | `pet/deepseek-whale-pet-states.png` | 豆包吉祥物精灵 | 🔲 待做（需资源） |
| PoW WASM | `entrypoints/content.ts` | `deepseek/sha3_wasm_bg.wasm` | doubao 模式不需要 | 🔲 待做 |
| 代码目录 | `core/deepseek/` | 保留但迁入 `core/hosts/deepseek/` | `core/hosts/deepseek/` | 🔲 待做 |
| Storage key | 多处 | `deepseek_pp_*` | `doubao_wplus:*` | 🔲 迁移方案已设计 |
| README | 根目录 | DeepSeek++ 文案 | 豆包 WPlus 文案 | 🔲 待做 |
| 图标/favicon | `public/icon/*` | DeepSeek 图标 | 豆包 WPlus 图标 | 🔲 待做（需资源） |

---

## 七、权限风险评估

### 7.1 当前权限清单

| 权限 | 用途 | 风险等级 | 建议 |
|------|------|----------|------|
| `*://www.doubao.com/*` | 豆包网页注入 | 中 | 保留，核心功能必需 |
| `*://*.doubao.com/*` | 豆包子域（bot/image 等） | 中 | 需确认是否所有子域都需要 |
| `https://*.volces.com/*` | 豆包搜索/联网后端 | 低 | 可缩小到具体 API 域名 |
| `*://chat.deepseek.com/*` | DeepSeek 通道 | 中 | 保留，可选宿主 |
| `https://api.deepseek.com/*` | DeepSeek 官方 API | 中 | 保留，可选宿主 |
| `*://cn.bing.com/*` / `*://www.bing.com/*` | Bing 搜索 | 低 | 考虑改为 optional |
| `storage` / `alarms` | 数据存储 / 定时任务 | 低 | 标准权限 |
| `offscreen` / `debugger` / `tabs` / `downloads` | 浏览器控制 | 高 | Chromium only，需说明用途 |
| `sidePanel` | 侧边栏 | 低 | 标准权限 |
| `contextMenus` | 右键菜单 | 低 | 标准权限 |
| `nativeMessaging` | 本地通信 | 高 | 需说明用途 |

### 7.2 建议

1. `*://*.doubao.com/*` 确认是否可缩小为 `*://www.doubao.com/*` + 具体子域
2. `https://*.volces.com/*` 缩小到 `https://lf-bot-studio.volces.com/*` 等具体域名
3. Bing 搜索改为 optional_host_permissions，用户主动授权
4. README 中增加权限用途说明（发布商店必需）

---

## 八、风险评估

| 风险 | 影响 | 概率 | 应对 |
|------|------|------|------|
| 豆包 DOM class 动态变化 | 功能失效 | 高 | 多 selector fallback + MutationObserver |
| 接口签名或鉴权限制 | 请求拦截受限 | 中 | 优先 DOM 增强，接口能力可选 |
| 多宿主逻辑分散 | 维护困难 | 中 | HostAdapter 统一抽象 |
| 权限过宽 | 发布审核风险 | 中 | 最小权限 + optional permissions |
| storage 迁移失败 | 用户配置丢失 | 低 | migration version + 备份旧 key |
| DeepSeek 回归破坏 | 旧用户体验下降 | 中 | 保留自动化回归测试 |
| 流式响应格式不同 | Agent 状态识别异常 | 中 | 统一 normalize 层 |
| 豆包接口变更 | 功能降级 | 高 | 降级策略 + DOM fallback |

---

## 九、测试计划

| 测试类型 | 覆盖内容 | 工具 |
|----------|----------|------|
| 单元测试 | URL 解析、host 匹配、storage migration、selector fallback | vitest |
| 集成测试 | fetch-hook 是否正确识别 stream/history 请求 | vitest + mock |
| E2E 测试 | 打开豆包网页 → 发送消息 → 识别回复 → 导出对话 | 手动 / Playwright |
| 回归测试 | DeepSeek 旧功能是否仍然可用 | 手动 |
| 迁移测试 | 旧版 deepseek_pp_* 数据正确迁移 | vitest |

**关键回归项：**
- [ ] DeepSeek 消息拦截正常
- [ ] DeepSeek 记忆注入正常
- [ ] DeepSeek 对话导出正常
- [ ] DeepSeek 宠物精灵正常
- [ ] DeepSeek 自动化正常

---

## 十、版本路线图

| 版本 | 目标 | 里程碑 |
|------|------|--------|
| **v0.1.0** ✅ | 品牌替换、基础豆包页面注入、双宿主识别 | 当前版本，构建通过 |
| **v0.2.0** | HostAdapter 抽象、豆包 DOM 适配、选择器 fallback | 豆包网页可发送消息并看到增强 |
| **v0.3.0** | 历史会话、stream 识别、storage 迁移 | 完整对话增强链路 |
| **v0.4.0** | 稳定性优化、降级策略、DeepSeek 回归验证 | 双宿主稳定运行 |
| **v1.0.0** | 功能稳定、文档完整、权限审查、可发布版本 | Chrome Web Store 发布 |

---

## 十一、任务优先级（修订版）

| 优先级 | 任务 | 原因 | 验收标准 |
|--------|------|------|----------|
| **P0** | 豆包 DOM 调研 | 没有 DOM 结构无法做 content 层适配 | 产出完整选择器表 + 页面状态机文档 |
| **P0** | HostAdapter 抽象 | 多宿主基础架构，不应拖后 | `core/hosts/` 目录建立，doubao/deepseek adapter 实现 |
| **P0** | URL/session 解析测试 | 会话 ID 是导出、历史、状态管理的基础 | `parseSessionId()` 独立模块 + 单元测试通过 |
| **P1** | CSS selector fallback | 豆包 DOM 变动风险高 | `queryFirst()` 工具函数 + 每个选择器至少 3 个 fallback |
| **P1** | storage migration | 越早做越不容易产生脏数据 | 旧用户升级后配置完整保留 |
| **P1** | DeepSeek 回归验证 | 防止双宿主改造破坏旧能力 | 回归测试清单全部通过 |
| **P2** | 请求拦截多宿主化 | DOM 路线稳定后再深化接口层 | doubao 请求正确拦截 + 签名处理 |
| **P2** | 历史接口适配 | 依赖登录态、接口稳定性 | 历史列表正确加载 + 降级到 DOM |
| **P3** | 宠物和品牌资源替换 | 体验增强，不影响主链路 | 豆包品牌精灵图显示 |
| **P3** | 导出视觉优化 | 核心功能稳定后做 | 导出文件名/标题全部替换 |

---

## 十二、P0 任务详细验收标准

### 12.1 豆包 DOM 调研

| 调研项 | 产出 |
|--------|------|
| 消息列表容器 | 用户消息、助手消息、系统提示、加载中状态的稳定选择器 |
| 输入框 | 文本输入、换行、发送按钮、禁用状态、附件入口 |
| 会话 ID | 新会话、历史会话、分享会话 URL 的解析规则 |
| 流式响应 | 请求路径、响应格式、终止信号、错误响应结构 |
| 页面状态 | 登录态、未登录态、网络错误、空会话、生成中 |

**产出文件：** `docs/doubao-dom-research.md`

### 12.2 HostAdapter 抽象

| 验收项 | 标准 |
|--------|------|
| 目录结构 | `core/hosts/types.ts` + `core/hosts/registry.ts` + `core/hosts/doubao/adapter.ts` + `core/hosts/deepseek/adapter.ts` |
| 接口完整 | HostAdapter 接口覆盖 URL 匹配、会话识别、选择器、请求路径、消息规范化 |
| 自动检测 | `registry.ts` 根据 `location.href` 自动选择正确 adapter |
| 业务解耦 | content.ts / fetch-hook.ts 不再直接判断宿主 |

### 12.3 URL/session 解析

| 验收项 | 标准 |
|--------|------|
| 独立模块 | `core/hosts/shared/url-utils.ts` |
| 单元测试 | 覆盖 DeepSeek + 豆包 + 边界情况（见 3.4 测试矩阵） |
| 集成 | content.ts 中 `getCurrentChatSessionId()` 调用新模块 |

---

## 十三、下一步执行清单

1. ✅ 完成豆包 DOM 调研文档，记录稳定 selector、易变 selector、页面状态
2. ✅ 新建 `core/hosts/` 目录，拆分 `doubaoAdapter` 和 `deepseekAdapter`
3. ✅ 把 URL session 解析从业务逻辑中抽出，并补充测试用例
4. ✅ 建立 selector fallback 工具函数，避免硬编码单一选择器
5. 🔲 设计 storage migration version，确保旧用户无感升级
6. 🔲 检查 host permissions 是否可以缩小范围
7. 🔲 做 DeepSeek 旧功能回归，确认双宿主改造没有破坏原功能
8. 🔲 将接口层能力设为增强能力，而不是唯一依赖路径

### 13.1 架构守卫

已上线 `tests/architecture/no-host-hardcoding.test.ts`（4 个测试），代码硬阻断 + 注释软警告，防止宿主专属选择器重新引入共享内容层。

---

## 附录：阶段一已完成改动

| 文件 | 改动 |
|------|------|
| `package.json` | name → `doubao-wplus`，version → `0.1.0` |
| `wxt.config.ts` | host_permissions 新增 doubao 域，gecko id 更新 |
| `core/constants.ts` | 新增 HOST_CONFIG 多宿主映射，后续迁移至 `core/hosts/registry` |
| `core/interceptor/fetch-hook.ts` | 多宿主动态路由，使用 `getActiveAdapter().getPaths()` |
| `core/hosts/types.ts` | **新增** `HostAdapter` 接口与 `HostSelectors`/`HostPaths`/`PageState` 公共类型 |
| `core/hosts/registry.ts` | **新增** `getActiveAdapter()` / `detectHost()` / `setActiveHostId()` 注册表 |
| `core/hosts/doubao/adapter.ts` | **新增** 豆包专属 adapter，含 DOM 选择器 fallback 数组 |
| `core/hosts/deepseek/adapter.ts` | **新增** DeepSeek 专属 adapter，从现有代码提取 |
| `core/hosts/shared/selector-utils.ts` | **新增** `queryFirst()` / `queryAll()` fallback 工具 |
| `core/hosts/shared/url-utils.ts` | **新增** `parseSessionId()` 可测试 URL 解析 |
| `entrypoints/content.ts` | matches 扩展 doubao.com；动态选择器函数 `getAssistantResponseSelector()` 等；检测宿主 + 切换 active host |
| `entrypoints/main-world.content.ts` | matches 扩展 doubao.com；启动时自动检测宿主 |
| `public/_locales/zh_CN/messages.json` | 品牌文案 |
| `public/_locales/en/messages.json` | 品牌文案 |
| `tests/host-url-parser.test.ts` | **新增** URL parser 单元测试 |
| `tests/host-selector-utils.test.ts` | **新增** selector fallback 工具测试 |
| `tests/host-adapter.test.ts` | **新增** adapter 集成测试 |
| `tests/architecture/no-host-hardcoding.test.ts` | **新增** 架构守卫（4 个测试） |
| `docs/doubao-pp-proposal.md` | v0.2 企划案 |

**构建验证：** ✅ Chrome MV3 构建通过（5s）
**测试验证：** ✅ `vitest run` 55 个测试文件，300 个测试通过
