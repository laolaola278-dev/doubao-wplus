# 豆包真实页面适配基线实测报告

**日期：** 2026-07-12
**分支：** `test/doubao-real-page-baseline`
**目标：** 建立 Doubao HostAdapter 真实页面基线（不引入新大功能、不做品牌替换）

---

## 一、修改过的文件

### 类型与共享逻辑

| 文件 | 性质 | 改动摘要 |
|------|------|---------|
| [core/hosts/types.ts](file:///d:/xjx/MCP/doubao-wplus/core/hosts/types.ts) | 改动 | `HostSelectors` 增加 5 个 optional 字段（stopButton / mainContainer / conversationList / currentConversation / themeMarker）；新增 `SelectorHealthStatus` 类型；`SelectorHealthReport` 新增 `status` 与 `missingEssential` 字段 |
| [core/hosts/shared/selector-utils.ts](file:///d:/xjx/MCP/doubao-wplus/core/hosts/shared/selector-utils.ts) | 改动 | 新增共享 `computeSelectorHealth(hostId, selectors, doc, criticalKeys, essentialKeys, pageUrl)` helper，所有探测异常吞掉，绝不向上抛 |

### Adapter 层

| 文件 | 性质 | 改动摘要 |
|------|------|---------|
| [core/hosts/doubao/adapter.ts](file:///d:/xjx/MCP/doubao-wplus/core/hosts/doubao/adapter.ts) | 改动 | 新增 5 个选择器配置（stopButton/mainContainer/conversationList/currentConversation/themeMarker，共 35+ 候选条目）；声明 `ESSENTIAL_SELECTOR_KEYS`；`detectSelectors()` 重构为 4 档状态输出，整体 try/catch 包裹 |
| [core/hosts/deepseek/adapter.ts](file:///d:/xjx/MCP/doubao-wplus/core/hosts/deepseek/adapter.ts) | 改动 | 同步使用共享 `computeSelectorHealth` helper；`ESSENTIAL_SELECTOR_KEYS=[]`（deepseek 暂不声明辅助选择器）；status 落在 full/fallback/unsupported 三档 |

### Dev Diagnostics

| 文件 | 性质 | 改动摘要 |
|------|------|---------|
| [core/diagnostics/dev-diagnostics.ts](file:///d:/xjx/MCP/doubao-wplus/core/diagnostics/dev-diagnostics.ts) | 新增 | `window.__DWPLUS_DIAG__` 模块；暴露 host/mainWorldReady/fetchHooked/selectorHealth/lastCapturedRequest；`extractMaskedHeaderMeta` 仅返回 header 键名、布尔标记，不暴露任何值 |
| [core/interceptor/fetch-hook.ts](file:///d:/xjx/MCP/doubao-wplus/core/interceptor/fetch-hook.ts) | 改动 | 在 `hookFetch()` / `hookXHR()` 命中宿主时调用 `captureRequestForDevDiagnostics`（脱敏后写入 `__DWPLUS_DIAG__.lastCapturedRequest`）；XHR hook 增加 `xhrMethods` WeakMap 跟踪 method |
| [entrypoints/main-world.content.ts](file:///d:/xjx/MCP/doubao-wplus/entrypoints/main-world.content.ts) | 改动 | 启动时 `writeDevDiagnostics({})` 初始化；`installFetchHook()` 后 `markFetchHooked()`；桥接 ready 后 `markMainWorldReadyForDev()`；新增 `scheduleDevSelectorHealthCheck()`：DOMContentLoaded + 2s 首次探测，非 full 最多重试 6 次（间隔 5s）；暴露 `window.__DWPLUS_RUN_HEALTH_CHECK__()` 供 DevTools 手动重跑 |

### 测试

| 文件 | 性质 | 改动摘要 |
|------|------|---------|
| [tests/host-selector-utils.test.ts](file:///d:/xjx/MCP/doubao-wplus/tests/host-selector-utils.test.ts) | 改动 | 新增 7 个 `computeSelectorHealth` 4 档状态用例：full / partial / fallback / unsupported / matchedSelector 回显 / optional 字段不报错 / 非法选择器不抛 |
| [tests/dev-diagnostics.test.ts](file:///d:/xjx/MCP/doubao-wplus/tests/dev-diagnostics.test.ts) | 新增 | 15 个用例：启用门控、幂等合并、各 marker helper、production 安全、`extractMaskedHeaderMeta` 脱敏验证（不含 token / cookie / signature 值） |
| [tests/host-feature-flags.test.ts](file:///d:/xjx/MCP/doubao-wplus/tests/host-feature-flags.test.ts) | 改动 | 新增 4 个用例：doubao adapter 不含 ds-*/chat.deepseek.com 选择器；deepseek adapter 不含 dbx-/doubao.com/Semi Design 选择器；doubao 声明 5 个新选择器键；deepseek 把新键视为 optional |

---

## 二、Selector Health Report（4 档状态）

### 状态定义

| 状态 | 含义 | 业务层行为 |
|------|------|-----------|
| `full` | 关键（inputBox/sendButton/messageList）+ 辅助（stopButton/userMessage/assistantMessage/conversationList/currentConversation/mainContainer/themeMarker）全部命中 | 完整 DOM 接管，所有 feature 启用 |
| `partial` | 关键全命中，部分辅助缺失 | 核心路径可用（记忆/Skill 注入/请求增强），部分增强降级（如停止按钮、会话切换、主题同步） |
| `fallback` | 部分关键缺失（至少 1 个关键命中） | 降级为基础模式，仅记忆/Skill 注入，不接管 DOM |
| `unsupported` | 全部关键缺失 | 不接管当前页面 |

### 探测的关键选择器（3 项）

- `inputBox` — 文本输入框（5 候选）
- `sendButton` — 发送按钮（5 候选）
- `messageList` — 消息列表容器（2 候选）

### 探测的辅助选择器（7 项）

- `stopButton` — 停止生成按钮（5 候选，data-testid 优先 → aria-label → class 兜底）
- `userMessage` — 用户消息气泡（3 候选）
- `assistantMessage` — AI 消息气泡（3 候选）
- `conversationList` — 会话列表容器（5 候选，覆盖 nav/aside/history-sidebar 多种结构）
- `currentConversation` — 当前激活会话条目（5 候选，覆盖 active/selected/aria-current）
- `mainContainer` — 主聊天容器（5 候选，覆盖 main/chat-container/chat-page 等）
- `themeMarker` — 主题模式标记（10 候选，覆盖 html[data-theme]/html.dark/body[color-mode] 等）

### 探测逻辑要点

- 每个选择器都按 fallback 数组顺序尝试，首选 data-testid/aria-label，再兜底 class
- 任何选择器探测异常（如浏览器不支持某语法）都被吞掉，不向上抛
- adapter 级 try/catch 兜底：探测过程意外异常返回 `status='unsupported'`，绝不影响页面正常加载
- `__DWPLUS_DIAG__.selectorHealth` 在 DOMContentLoaded + 2s 首次写入，非 full 最多重试 6 次

---

## 三、自动验证结果（Step 14）

| 命令 | 结果 |
|------|------|
| `npm run compile` | ✅ 通过 |
| `npm test` | ✅ 347 tests passed (58 files) — 基线 321 + selector health 7 + dev-diagnostics 15 + feature isolation 4 |
| `npm run verify:automation` | ✅ Automation contract smoke passed |
| `npm run smoke:shell` | ✅ 11/11 passed |

---

## 四、Chrome MV3 扩展构建

构建命令（启用 dev diagnostics）：

```powershell
$env:DOUBAO_WPLUS_E2E = '1'
npm run build:chrome
```

产物路径：`dist/chrome-mv3/`

关键产物：
- `manifest.json` — MV3 清单，host_permissions 包含 `*://*.doubao.com/*` 和 `*://chat.deepseek.com/*`
- `content-scripts/content.js` — isolated world content script
- `content-scripts/main-world.js` — MAIN world content script（含 `__DWPLUS_DIAG__` 写入逻辑）
- `background.js` — service worker

构建已验证含 `__DWPLUS_DIAG__` 全局变量写入代码。

---

## 五、用户路径实测结果

> 以下 7 条路径需要在真实豆包页面手动实测。请按"加载与测试指引"小节操作后填写实测结果。

### 加载与测试指引

**Step 1：加载扩展**

1. 打开 Chrome，访问 `chrome://extensions/`
2. 右上角开启"开发者模式"
3. 点击"加载已解压的扩展程序"
4. 选择目录：`D:\xjx\MCP\doubao-wplus\dist\chrome-mv3`
5. 确认扩展卡片显示"Doubao WPlus"且已启用

**Step 2：验证非目标页面不误触发**

1. 打开 `https://example.com/` 或 `https://www.baidu.com/`
2. 打开 DevTools Console
3. 执行 `window.__DWPLUS_DIAG__`
4. 预期：返回 `undefined`（非目标页面不应注入 main-world 脚本）

**Step 3：验证豆包页面 detect() 命中**

1. 打开 `https://www.doubao.com/` 并登录
2. 进入聊天页（如 `https://www.doubao.com/chat/`）
3. 打开 DevTools Console
4. 执行 `window.__DWPLUS_DIAG__`
5. 预期：
   - `host: 'doubao'`
   - `mainWorldReady: true`（桥接完成后）
   - `fetchHooked: true`
   - `selectorHealth.status: 'full' | 'partial' | 'fallback'`（具体看实际 DOM 命中情况）
   - `lastCapturedRequest: null`（未发起请求时）或最近一次请求摘要

**Step 4：手动重跑 health check**

```js
// 在 DevTools Console 执行
window.__DWPLUS_RUN_HEALTH_CHECK__()
// 然后查看
window.__DWPLUS_DIAG__.selectorHealth
```

### 7 条用户路径实测表

| # | 路径 | 预期 | 实测结果 |
|---|------|------|---------|
| 1 | 刷新豆包页面 | `__DWPLUS_DIAG__.selectorHealth.status` 在 2-7s 内更新；`fetchHooked=true` | _待用户填写_ |
| 2 | 新建会话（点击"新对话"按钮） | `conversationList` / `currentConversation` 命中；`selectorHealth.status` 保持或升至 `full` | _待用户填写_ |
| 3 | 发送消息（输入文字 → 点发送） | `lastCapturedRequest.matchedHostPath='completion'`；`hasBody=true`；`bodyLength>0` | _待用户填写_ |
| 4 | 停止生成（生成中点停止） | `stopButton` 选择器在生成中可见时命中；`selectorHealth` 应包含 stopButton | _待用户填写_ |
| 5 | 切换会话（侧边栏点击另一个会话） | `currentConversation` 切换到新激活项；URL 变化触发 health check 重跑 | _待用户填写_ |
| 6 | 长对话滚动 | `messageList` 持续可见；不出现 console error | _待用户填写_ |
| 7 | 切换深色模式 | `themeMarker` 命中（`html[data-theme]` 或 `html.dark` 等）；`themeSync` feature 同步扩展主题 | _待用户填写_ |

### Network 请求观察（Step 11）

> 仅做请求上下文捕获可行性记录，**不实现主动签名算法**。

请在豆包聊天页发起一次对话，打开 Network 面板观察 `www.doubao.com` 域名下的请求，记录：

| 项目 | 观察结果 |
|------|---------|
| 聊天请求 URL 路径 | _待用户填写_（如 `/api/v1/chat/completion` 还是其他） |
| HTTP 方法 | _待用户填写_ |
| Content-Type | _待用户填写_ |
| 是否带 Authorization header | _待用户填写_（仅记录 yes/no，不记录值） |
| 是否带 Cookie header | _待用户填写_ |
| 是否检测到疑似签名 header（如 `a_bogus` / `x-tt-*` / `msToken`） | _待用户填写_ |
| 请求体字段名 | _待用户填写_（如 `prompt` / `text` / `query` / `content`） |
| 会话 ID 字段名 | _待用户填写_ |
| 父消息 ID 字段名 | _待用户填写_ |

**注意：**
- 所有敏感 header 值、cookie、token、signature 在 `__DWPLUS_DIAG__.lastCapturedRequest` 中**已脱敏**，只暴露 header 键名列表 + 布尔标记
- `__DWPLUS_DIAG__.lastCapturedRequest.headerKeys` 给出完整 header 键名列表（无值）
- `__DWPLUS_DIAG__.lastCapturedRequest.hasAuthorization` / `hasCookie` / `hasSignatureLikeHeader` 给出布尔标记

### Feature Isolation 验证（Step 9）

| 验证项 | 自动测试结果 | 真实页面预期 |
|--------|------------|------------|
| doubao adapter 不含 `ds-*` 选择器 | ✅ 自动测试通过 | 仅注入 doubao 选择器 |
| doubao adapter 不含 `chat.deepseek.com` | ✅ 自动测试通过 | — |
| deepseek adapter 不含 `dbx-*` / `doubao.com` | ✅ 自动测试通过 | — |
| doubao adapter 声明 5 个新选择器键 | ✅ 自动测试通过 | 真实页面应能命中部分或全部 |
| content.ts 通过 `getActiveFeatures()` gate 启动 feature | ✅ 自动测试通过 | doubao 页面只加载 `features/doubao/*` 模块 |
| doubao feature 模块不含 deepseek 私有选择器 | ✅ 自动测试通过 | — |

---

## 六、当前 Doubao Adapter 状态

**自动验证状态：`partial`**

理由：
- ✅ **关键选择器（3/3）已声明**：inputBox / sendButton / messageList 都有完整的 fallback 数组
- ✅ **辅助选择器（7/7）已声明**：stopButton / userMessage / assistantMessage / conversationList / currentConversation / mainContainer / themeMarker
- ✅ **4 档状态计算逻辑就绪**：单元测试覆盖 full / partial / fallback / unsupported 四档
- ✅ **dev diagnostics 完整暴露**：host / mainWorldReady / fetchHooked / selectorHealth / lastCapturedRequest
- ✅ **敏感数据脱敏**：header 值 / cookie / token / signature 均不暴露
- ⚠️ **真实页面选择器命中率未验证**：候选选择器基于 2026-06-29 调研的 DOM 结构，可能在豆包 DOM 改版后失效
- ⚠️ **请求路径为占位值**：`DOUBAO_PATHS.completion='/api/v1/chat/completion'` 需要真实抓包确认

**最终状态以用户在真实豆包页面手动执行 `window.__DWPLUS_RUN_HEALTH_CHECK__()` 后的 `selectorHealth.status` 为准。**

---

## 七、下一步必须修复的问题（具体）

### P0：必须真机验证后修复

1. **真实聊天请求 URL 路径未确认**
   - 文件：[core/hosts/doubao/adapter.ts#L218-L225](file:///d:/xjx/MCP/doubao-wplus/core/hosts/doubao/adapter.ts#L218-L225) `DOUBAO_PATHS`
   - 当前值：`/api/v1/chat/completion`（占位假设）
   - 真机抓包后需更新为豆包实际路径
   - 影响：`isChatStreamUrl()` 判断错误会导致 fetch hook 不拦截聊天请求

2. **请求体字段名映射未验证**
   - 文件：[core/hosts/doubao/adapter.ts#L282-L291](file:///d:/xjx/MCP/doubao-wplus/core/hosts/doubao/adapter.ts#L282-L291) `getRequestBodyFields()`
   - 当前值：与 DeepSeek 同名（`prompt` / `parent_message_id` / `chat_session_id` 等）
   - 真机抓包后需更新为豆包实际字段名（可能为 `text` / `query` / `content`）
   - 影响：`request-augmentation` 无法正确解析/修改请求体

3. **getSessionId URL 正则未验证**
   - 文件：[core/hosts/doubao/adapter.ts#L248-L256](file:///d:/xjx/MCP/doubao-wplus/core/hosts/doubao/adapter.ts#L248-L256) `getSessionId()`
   - 当前正则：`/\/chat\/(?:bot\/[^/]+\/conversation\/)?([^/?#]+)/`
   - 需确认豆包实际 URL 结构（`/chat/{id}` vs `/chat/bot/{botId}/conversation/{convId}`）

### P1：真机验证后可能需要调整

4. **stopButton 选择器可能在豆包 DOM 中不存在**
   - 当前候选：`button[data-testid="stop-button"]` / `button[aria-label*="停止"]` 等 5 个
   - 豆包可能用 SVG 图标按钮 + 无 aria-label
   - 若 `selectorHealth.missingEssential` 包含 `stopButton`，需追加真实选择器

5. **themeMarker 选择器命中率待验证**
   - 当前覆盖 10 种主题标记写法（html[data-theme]/html.dark/body[color-mode] 等）
   - 豆包 Semi Design 可能用其他方式标记主题
   - 若未命中，需在豆包页面用 DevTools 检查 `<html>` 和 `<body>` 的属性/类名

6. **conversationList / currentConversation 选择器可能过于宽泛**
   - 当前 `a[href*="/chat/"]` 会匹配所有会话链接
   - 豆包实际侧边栏结构需在真机上确认

### P2：观察类（不阻塞基线）

7. **豆包请求是否带签名 header（如 `a_bogus`）需记录**
   - `__DWPLUS_DIAG__.lastCapturedRequest.hasSignatureLikeHeader` 会自动检测
   - 若为 `true`，需评估 header 借用机制能否复用签名（当前 `header-borrowing.ts` 已支持，但需真机验证签名是否绑定请求体）

8. **豆包是否使用 XHR 还是 fetch 发送聊天请求**
   - 当前 `hookFetch` 和 `hookXHR` 都已加诊断捕获
   - 若豆包用 fetch，`__DWPLUS_DIAG__.lastCapturedRequest` 会更新
   - 若用 XHR，需确认 `xhrMethods` WeakMap 正确传递 method

---

## 八、回归验证

最终 4 项验证命令在所有代码改动后再次运行：

| 命令 | 结果 |
|------|------|
| `npm run compile` | ✅ 通过 |
| `npm test` | ✅ 347 passed (0 failed) |
| `npm run verify:automation` | ✅ Automation contract smoke passed |
| `npm run smoke:shell` | ✅ 11/11 passed |

**无回归。**

---

## 九、附：DevTools Console 速查

在豆包页面打开 DevTools Console（F12），可直接查询：

```js
// 查看完整 diagnostics
window.__DWPLUS_DIAG__

// 仅查看 selector health
window.__DWPLUS_DIAG__.selectorHealth

// 查看最近一次捕获的请求（脱敏）
window.__DWPLUS_DIAG__.lastCapturedRequest

// 手动重跑 selector health check
window.__DWPLUS_RUN_HEALTH_CHECK__()

// 查看 host / mainWorldReady / fetchHooked
JSON.stringify({
  host: window.__DWPLUS_DIAG__.host,
  mainWorldReady: window.__DWPLUS_DIAG__.mainWorldReady,
  fetchHooked: window.__DWPLUS_DIAG__.fetchHooked,
}, null, 2)
```

`__DWPLUS_DIAG__` 仅在 dev / E2E 构建中存在；生产构建不写入任何全局变量。
