# 宿主适配规范（Host Onboarding Guide）

> 基于豆包（Doubao）适配全过程总结（2026-06 DOM 调研 → 2026-07-16 真机抓包 → P0 修复 → 回归验证）。
> 新增宿主时按本文顺序执行；每一节的"血泪教训"都对应豆包适配中真实踩过的坑。

## 总原则

1. **所有映射值必须来自真实浏览器抓包，不允许占位值上线。** 豆包 P0 事故根因：`completion: '/api/v1/chat/completion'` 是猜的，真实路径是 `/chat/completion`，导致 `isChatStreamUrl()` 永不命中、Prompt 增强全程未执行，而页面功能看起来完全正常（请求被原样放行）。
2. **先抓包、后写码、再真机回归。** 三步缺一不可；单元测试只能锁住已知结构，不能发现结构错了。
3. **通用业务层零宿主硬编码。** 由 `tests/architecture/no-host-hardcoding.test.ts` 强制约束；宿主差异只能表达在 `core/hosts/<host>/adapter.ts` 与声明式映射中。
4. **优先扩展映射语义，不新增 HostAdapter 接口。** 豆包的深层嵌套 prompt（`messages[0].content_block[0].content.text_block.text`）最初被判定为"需要架构级调整"，实际用点分路径语义（`core/hosts/shared/body-fields.ts`）即可表达。先证明现有接口不够，再提接口升级方案。

## 适配步骤总览

| 阶段 | 产出 | 参考实现 |
|---|---|---|
| 1. DOM 调研 | `HostSelectors`（fallback 数组） | `core/hosts/doubao/adapter.ts` 选择器段 |
| 2. 请求抓包 | `HostPaths` + `RequestBodyFieldMapping` | `scripts/verify-phase2/probe-06-body-structures.cjs` |
| 3. Adapter 实现 | `core/hosts/<host>/adapter.ts` + 注册到 registry | `core/hosts/registry.ts` |
| 4. 单元测试 | mapping 契约测试 + augmentation 嵌套用例 | `tests/body-fields.test.ts`、`tests/request-augmentation.test.ts` |
| 5. 真机回归 | probe 脚本结果 JSON + 报告 | `scripts/verify-phase2/probe-07-augmentation-verify.cjs` |

---

## 一、页面元素验证（DOM / Selectors）

**目标：** 填充 `HostSelectors`，并划分 CRITICAL / ESSENTIAL 两档。

必做验证项：

- [ ] 每个选择器按「属性优先（data-testid / aria-label / placeholder）+ 类名兜底」排列 fallback 数组。
- [ ] 关键选择器（`inputBox` / `sendButton` / `messageList`）在真实页面全部命中 —— 用 `window.__DWPLUS_RUN_HEALTH_CHECK__()`（DEV 构建）现场验证。
- [ ] 发送按钮特别注意：豆包的按钮**无 type attribute、无 aria-label、无 data-testid**，唯一稳定锚点是父容器 class（`div[class*="send-btn-wrapper"] button`）。不要假设可访问性属性存在。
- [ ] SPA 渲染时序：React/Semi 类框架首屏后 2s 内选择器可能还未就绪，health check 需带重试（参考 `main-world.content.ts` 的 `scheduleDevSelectorHealthCheck`，2s 首测 + 5s×6 重试）。
- [ ] 登录墙 / 空会话 / 生成中 三种页面状态的判定元素（`detectPageState`）。

**血泪教训：** 豆包 selector health 长期在 `fallback` 与 `partial` 之间震荡（sendButton 时有时无），但这**不阻断请求增强**——降级策略必须把「DOM 接管」与「网络层增强」解耦，缺 DOM 元素只降级 DOM 功能。

## 二、数据路径验证（请求结构 / Mapping）

**目标：** 填充 `HostPaths` 与 `getRequestBodyFields()`，全部来自 CDP 实测。

必做验证项：

- [ ] **聊天端点真实路径**：CDP `Network.requestWillBeSent` 抓真实 completion URL；确认 `isChatStreamUrl()` 能命中（含 query 参数的完整 URL）。
- [ ] **Prompt 字段的完整路径**：递归搜索 body 找到用户输入文本的确切位置；确认是否为唯一结构（豆包四类场景实测一致，但不要假设——逐场景确认）。
- [ ] **新会话 vs 多轮的判定字段**：不同宿主机制不同（DeepSeek 用 `parent_message_id`，豆包用 `conversation_id==""` + `last_message_index:null`）。映射时注意 request-augmentation 只判 `null/undefined`，空字符串不算"缺失"——选语义对齐的字段。
- [ ] **签名机制**：签名在 header 还是 URL query？是否绑定 body hash？**这是方案可行性的第一风险点**——修改 body 后发一条真实请求验证服务端是否接受（豆包 `a_bogus`/`msToken` 在 query 且不校验 body，实测通过；换宿主不能假设同样成立）。
- [ ] **regenerate 端点**：独立路径还是复用 completion + body 标志位（豆包为后者：`option.is_regen`）？
- [ ] **history 端点**：若响应结构与现有 history-cleanup 逻辑不兼容，**故意保持占位不命中**，避免误改历史响应（豆包 `/im/chain/recent_conv` 即此策略）。
- [ ] 宿主没有的语义字段（如豆包无 `ref_file_ids`/`model_type`）映射为空路径 `''`——读 undefined、写 no-op，不注入服务端不认识的键。
- [ ] 跑一遍 DEV 启动自检（`core/diagnostics/startup-self-check.ts`）：宿主识别 / 路径命中 / prompt 读写往返 / 增强执行 / 映射兼容性 5 项应全绿。

**覆盖场景（每项都要抓到真实请求 body）：**

| 场景 | 验证点 |
|---|---|
| 新建会话首条 | 新会话判定字段取值 |
| 多轮第 2、3 条 | 会话 ID / 消息索引演进；结构是否与首条一致 |
| Skill 命令文本 | `/command` 文本进入 prompt 字段的位置不变 |
| 长文本（≥2000 字） | 是否拆分多个 content block / 结构变化 |
| 特殊模式（深度思考 / 联网等） | 开关字段位置与取值类型（布尔 vs 0/1） |

## 三、多轮对话验证

- [ ] 连续 3+ 轮：每轮请求都被增强（抓最终发送 body 确认含脚手架标记）。
- [ ] `messageCount` 状态演进正确：新会话重置为 1，多轮递增（决定 preset 注入节奏）。
- [ ] 新建会话 → 发送 → 切回历史会话 → 再发送：会话上下文切换后增强不错乱。
- [ ] Skill 命令在多轮中间发送：展开正常，后续普通消息不受影响。

## 四、流式响应验证

- [ ] 响应 mime 为 `text/event-stream`（或宿主等价物），`interceptFetchResponse` 转发后页面渲染正常。
- [ ] **必须在增强路径上测**：hook 未命中时流式走"原样放行"分支，测了等于没测（豆包 phase2 教训——pass-through 流式全绿，修好 URL 后才第一次真正执行转发路径）。
- [ ] 长回复分块（20+ chunks）无中断；`loadingFinished` 正常。
- [ ] 工具调用解析（若启用）在该宿主的流式格式下工作。

## 五、页面切换验证（SPA）

- [ ] `history.pushState` / popstate 模拟切换 5 轮 + 新建会话：content script 不重复初始化（`installContentBridge` 全程 1 次）。
- [ ] 扩展 DOM 节点数恒定，无累积泄漏。
- [ ] textarea 重挂载后 Skill 弹窗重新附着（重建属预期，累积不是）。
- [ ] MutationObserver / EventListener 无扩展侧增长（宿主页面自身波动排除在外）。
- [ ] 跨宿主跳转（如 deepseek → doubao 页面）后 `getActiveAdapter(url)` 自动切换。

## 六、长时间运行验证

- [ ] 20-30 轮连发：JS Heap 无累计性增长（豆包基线：95MB 起、结束 73MB；宿主弹窗时的瞬时峰值可接受，需回落）。
- [ ] 每轮耗时无恶化趋势。
- [ ] Console Error 增量为零（宿主自身噪音如 CSP report-only 警告除外，需逐条归因）。
- [ ] 注意宿主配额：豆包匿名账号约 20 条消息触发登录墙——长跑测试需登录态（`.e2e-profile` 持久 profile，扫码一次复用）。

---

## 验证工具链

| 工具 | 用途 |
|---|---|
| `scripts/verify-phase2/probe-06-body-structures.cjs` | 多场景 body 结构采集（改 marker 与场景即可复用） |
| `scripts/verify-phase2/probe-07-augmentation-verify.cjs` | 增强闭环回归（普通聊天 / Skill / 多轮 / 页面回显） |
| `scripts/verify-phase2/probe-03-spa-leaks.cjs` | SPA 切换泄漏检查 |
| `scripts/verify-phase2/probe-05-multiturn-stress.cjs` | 30 轮压测 |
| `window.__DWPLUS_DIAG__`（DEV 构建） | 现场诊断：host / fetchHooked / selectorHealth / selfCheck / lastCapturedRequest |
| `window.__DWPLUS_RUN_HEALTH_CHECK__()`（DEV 构建） | 手动重跑 selector health |

**构建注意：** probe 脚本默认加载 `dist/chrome-mv3-dev`；dev 构建可能过期（wxt dev 不在跑时不会重建）。改代码后要么重启 `wxt dev`，要么 `npm run build:chrome` 后用 `DWPLUS_EXT_DIR=dist/chrome-mv3` 指定。

## 完成标准（Definition of Done）

1. `npx tsc --noEmit` 与 `npx vitest run` 全绿（含 `tests/body-fields.test.ts` 中新宿主的 mapping 契约用例、`tests/request-augmentation.test.ts` 中新宿主 body 结构用例）。
2. 架构守卫 `tests/architecture/no-host-hardcoding.test.ts` 通过（新宿主专属代码只在允许目录）。
3. DEV 启动自检 5 项全绿。
4. probe-07 真机回归：增强执行 + 服务端接受 + 页面无脚手架泄漏。
5. 真机报告归档到 `docs/progress/`，抓包 JSON 归档到 `playwright-results/`。
