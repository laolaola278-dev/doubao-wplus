# 第二阶段真实浏览器联调报告 — Prompt 增强业务闭环验证

**日期：** 2026-07-16
**分支：** `test/doubao-real-page-baseline`
**构建：** `dist/chrome-mv3-dev`（wxt dev 模式，`__DWPLUS_DIAG__` 启用，2026-07-16 17:03 构建，源码无更新）
**方法：** Playwright persistent context（headless=false）+ `--load-extension` + CDP `Network.*` 域抓包 + 页面层 fetch 包装器
**账号状态：** 未登录（匿名态，页面右上角显示"登录"按钮）
**总体结论：★ FAIL — Prompt 增强核心闭环在豆包真实页面未生效**

---

## 一、验证 1-3：Fetch Hook 是否修改最终 Request Body — ❌ FAIL

### 测试步骤
1. 加载扩展 → 打开 `https://www.doubao.com/chat/` → 等待 `__DWPLUS_DIAG__.fetchHooked=true`
2. 在扩展 hook 之外再包一层 fetch 包装器捕获"页面原始 body"
3. CDP `Network.requestWillBeSent` + `Network.getRequestPostData` 捕获"最终发送 body"
4. 发送普通消息与 `/shell` Skill 命令各一次，对比

### Network 证据（CDP 抓包）

**真实聊天请求：**
- **Request URL：** `https://www.doubao.com/chat/completion?aid=497858&device_id=...&msToken=...&a_bogus=...`
- **真实路径：** `/chat/completion`（❗代码占位值是 `/api/v1/chat/completion`）
- **签名位置：** `msToken`、`a_bogus`、`fp` 全部在 **URL query 参数**中，不在 header
- **Request Headers（键名）：** `x-flow-trace, sec-ch-ua-platform, Referer, sec-ch-ua, sec-ch-ua-mobile, Agw-Js-Conv, last-event-id, User-Agent, content-type`（无 Authorization；Cookie 由浏览器自动附加，不在 fetch init 中）
- **Request Body 结构（与 DeepSeek 完全不同，深层嵌套）：**

```json
{
  "client_meta": { "local_conversation_id": "...", "conversation_id": "", "bot_id": "..." },
  "messages": [{
    "local_message_id": "...",
    "content_block": [{
      "block_type": 10000,
      "content": { "text_block": { "text": "请用一句话回答：P2HOOK测试1018 ..." } }
    }]
  }],
  "option": { "need_deep_think": 0, "is_regen": false, ... },
  "ext": { "use_deep_think": "0", ... }
}
```

### Hook 前后 Body 对比

**原始 body = 最终发送 body（完全相同，未做任何修改）。**

浏览器 Console 直接给出了根因（出现 19 次）：

```
[DWPLUS-FETCH] Skipped non-chat-stream POST to /chat/completion (body looks like chat!) — isChatStreamUrl=false
```

`DoubaoAdapter.isChatStreamUrl()` 用占位路径 `/api/v1/chat/completion` 匹配，真实路径是 `/chat/completion`，**永远不命中**，请求原样放行。Memory / Skill / System Prompt **均未写入任何一次真实请求**。

### 豆包是否收到增强后的 Prompt — ❌ 否

发送 `/shell 列出当前目录`（textarea 中 Skill 弹窗选择正常，输入框显示正常）：

- CDP 抓到的最终发送文本：`"text": "/shell 列出当前目录"` — **原始命令字面量，无 Skill 指令展开**
- 豆包的回复是"Linux Shell 列出当前目录文件（ls 命令教学）"— 服务端把 `/shell` 当普通文本理解，证明它收到的不是增强 Prompt
- 截图：`playwright-results/phase2-04-skill-send.png`

**结论：第一阶段验证的"Skill 注入链路"只到 textarea 为止；网络层增强闭环完全未生效。**

---

## 二、验证 4：流式响应 — ✅ 通过（但有前提限制）

| 项 | 观察值 |
|---|---|
| 响应 mime | `text/event-stream` |
| 长回复分块 | 24 chunks / 12052 bytes，`loadingFinished=true` |
| 30 轮压测中 completion 状态 | 11/11 全部 200，`streamFailed=0` |
| Markdown/代码块渲染 | 豆包页面正常渲染 bash 代码块、列表、标题（见 phase2-04 截图） |

⚠️ **前提限制：** 由于 hook 从未命中聊天 URL，所有流式响应走的是"原样放行"分支。**`interceptFetchResponse`（增强路径的流式转发）在豆包页面从未被真实执行过** —— 修好 URL 匹配后必须重测流式。

---

## 三、验证 5：多轮对话 — ❌ FAIL（增强角度）

| 场景 | 结果 |
|---|---|
| 普通聊天（多轮） | ✅ 页面功能正常，共完成 20 轮真实收发 |
| Skill 注入（UI 层） | ✅ 弹窗过滤/选择/textarea 回填正常（9 skills 注册） |
| Skill 注入（请求层） | ❌ 未展开，原文发送（见上） |
| Memory 写入 | ❌ 无法发生 — 增强管线从未执行，`loadAndSyncRuntimeState: memories=0` 全程不变 |
| Memory 读取/注入 | ❌ 同上 |
| 新建会话 | ✅ 第 15 轮点击"新对话"成功，会话上下文正确切换 |
| 历史会话切换 | ✅ 第 25 轮切回历史会话成功，往轮消息正确加载 |
| 每轮 Prompt 增强 | ❌ 0/20 轮发生增强 |

⚠️ 另：匿名账号在约 20 轮后触发豆包"登录以解锁更多功能"强制弹窗，第 20-24、26-30 轮被登录墙拦截（非扩展问题，是配额限制）。**完整 30 轮不间断验证需要登录态。**

---

## 四、验证 6：SPA 页面切换 — ✅ 通过

方法：`history.pushState` + popstate 模拟 SPA 导航 5 轮 + 点击"新对话"，document_start 注入计数器包装 `MutationObserver` 和 `addEventListener`。

| 检查项 | 结果 |
|---|---|
| Content Script 重复初始化 | ✅ `installContentBridge` 全程 1 次 |
| Skill Popup 重复创建 | ✅ `initSkillPopup` 全程 1 次；`.dwplus-skill-popup` DOM 节点数恒为 0（懒创建）/16（创建后），无累积 |
| textarea 重挂载 | ✅ `Attached to textarea` 2 次（初始 + 会话创建后 textarea 重建，符合预期） |
| 扩展 DOM 节点泄漏 | ✅ `dwplus*` 节点数恒定 15-16，5 轮切换零增长 |
| window/document Listener 泄漏（扩展自有） | ✅ `dwplus-speech-*` 等扩展监听恒为 1；有波动的（mousemove/touchend）均为豆包页面自身行为 |
| MutationObserver | ✅ 扩展初始化后不再新建（后续增长全部来自豆包页面自身组件） |

---

## 五、验证 7：30 次连发稳定性 — ✅ 扩展侧通过（20 轮有效样本）

| 指标 | 初始 | 第 10 轮 | 第 15 轮 | 第 25 轮 | 结束 |
|---|---|---|---|---|---|
| JS Heap | 95 MB | 87 MB | 89 MB | 164 MB* | **73 MB** |
| 每轮耗时 | ~7.3s | ~8.0s | ~9.0s | ~9.7s | 无恶化趋势 |
| 新增 Console Error/轮 | 0 | 0 | 1* | 4* | — |
| 扩展 DOM 节点 | 15 | 16 | 16 | 16 | 16 |

\* 164MB 峰值与 error 增量均出现在豆包登录弹窗 + 验证码弹出时刻，结束后回落到 73MB。

- Console Error 总计 8 条，**全部为豆包页面自身噪音**（CSP report-only 警告、404 资源），无一条来自扩展
- 无累计性内存增长、无 Listener/Observer 累积、无性能衰减

---

## 六、根因定位与需要的代码修改（按优先级）

### P0-1：`DOUBAO_PATHS.completion` 路径错误 — 整个闭环的阻断点
- 文件：`core/hosts/doubao/adapter.ts:260`
- 现值 `/api/v1/chat/completion` → 实测 `/chat/completion`
- `regenerate` / `history` 路径同为占位值，需继续抓包确认（历史加载观察到 `/im/chain/recent_conv`，`/samantha/*` 系列也在用，regen 未实测）

### P0-2：`getRequestBodyFields()` 平面字段映射无法表达豆包嵌套结构
- 文件：`core/hosts/doubao/adapter.ts:326`
- 豆包 prompt 在 `messages[0].content_block[0].content.text_block.text`，不是顶层 `prompt` 字段
- `request-augmentation.ts:52` 的 `body[fields.prompt]` 读出 `undefined` → 即使 URL 匹配修好，增强也会因 `originalPrompt` 为空直接返回 null
- **需要架构级调整**：HostAdapter 增加 `extractPrompt(body)` / `injectPrompt(body, text)` 之类的结构化读写接口，或为豆包实现专用 body transformer
- 同理：首消息判定 `parent_message_id` 在豆包 body 中不存在（豆包用 `conversation_id=="" ` + `need_create_conversation` 判断新会话）

### P0-3：签名风险必须在修复后立即实测
- `a_bogus` / `msToken` / `fp` 在 **URL query** 中（不在 header），现有 header-borrowing 机制帮不上忙
- 若签名绑定请求体（字节系 a_bogus 通常包含 body hash），**修改 body 后服务端可能直接拒绝** —— 这是修复后第一个要验证的风险点，决定整个方案可行性

### P1-4：`sendButton` 关键选择器未命中
- selector health 在 `fallback`（缺 sendButton）与 `partial` 之间震荡
- 实测可用选择器：`div[class*="send-btn"] button` 可点击发送
- 影响：DOM 接管类功能降级（不阻断请求增强）

### P1-5：`lastCapturedRequest` 诊断被后续静态资源覆盖
- completion POST 被捕获后，随后的 CDN 图片 GET（同 `.doubao.com` 域）把它覆盖，诊断价值大打折扣
- 建议：只记录 POST 或按 `matchedHostPath` 分槽保存

### P2-6：持续联调需要登录态
- 匿名配额约 20 条消息，之后被登录墙拦截；`.e2e-profile` 持久 profile 已建好（仓库根目录，建议加入 .gitignore），人工扫码登录一次即可复用

---

## 七、证据文件清单

| 文件 | 内容 |
|---|---|
| `playwright-results/phase2-01-hook-body.json` | 普通消息：CDP 全量抓包（URL/headers/postData）+ 诊断状态 |
| `playwright-results/phase2-02-stream-skill.json` | 流式 DOM 检查 + Skill 弹窗状态 |
| `playwright-results/phase2-04-skill-send.json` | `/shell` 命令最终发送 body（未增强的直接证据） |
| `playwright-results/phase2-03-spa-leaks.json` | SPA 切换 5 轮 Observer/Listener/节点快照 |
| `playwright-results/phase2-05-stress.json` | 30 轮压测逐轮数据 |
| `playwright-results/phase2-*.png` | 各阶段页面截图 |
| `scripts/verify-phase2/*.cjs` | 可复跑的验证脚本（probe-00 环境 / 01 hook对比 / 02 流式+skill / 03 SPA / 04 skill发送 / 05 压测） |

---

## 八、结论

> **在 P0-1（URL 路径）、P0-2（body 结构映射）修复并通过 P0-3（签名兼容性）实测之前，不能宣布 Prompt 增强插件在豆包上完成验证。**

通过项：流式响应（pass-through 路径）、SPA 无泄漏、30 轮无累计性问题、Skill UI 层注入。
未通过项：**核心业务闭环 —— 网络层 Prompt 增强从未发生**，Memory 读写闭环随之全部未验证。
