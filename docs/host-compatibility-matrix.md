# Host Compatibility Matrix（宿主兼容性矩阵）

> 最后更新：2026-07-17 ｜ 数据来源见每格标注；真机结论以 `docs/progress/` 报告与 `playwright-results/` 抓包为准。
> 状态图例：✅ 已验证可用 ｜ ⚠️ 部分可用/降级 ｜ ❌ 不可用 ｜ ➖ 宿主无此概念 ｜ ❓ 未验证
> 维护约定：任一格状态变化时同步更新对应 adapter 的 `getMeta().lastVerifiedAt` 与本表。

## 总览

| 能力维度 | DeepSeek | 豆包 (Doubao) |
|---|---|---|
| Adapter 版本 | 1.0.0 | 1.0.0 |
| 最近验证日期 | 2026-07-16 | 2026-07-16 |
| **DOM（选择器/接管）** | ✅ full | ⚠️ partial/fallback 震荡 |
| **Prompt 数据路径** | ✅ 平面顶层 | ✅ 深层嵌套（点分路径） |
| **多轮对话** | ✅ | ✅ |
| **流式响应** | ✅ | ✅（增强路径实测） |
| **页面切换（SPA）** | ✅ | ✅ |
| **自动化测试覆盖** | ✅ 单测+契约 | ✅ 单测+契约+真机 probe |

## 1. DOM（页面元素）

| 项 | DeepSeek | 豆包 |
|---|---|---|
| 关键选择器（inputBox/sendButton/messageList） | ✅ 稳定（doubao-wplus 生产基线） | ⚠️ sendButton 无稳定属性锚点，靠 `.send-btn-wrapper` 父容器，health 在 partial/fallback 震荡 |
| 辅助选择器（消息气泡/会话列表/主题） | ✅ | ⚠️ userMessage/assistantMessage/conversationList 时常缺失 |
| DOM 接管类 feature（历史组织/侧边栏/主题同步） | ✅ 全量启用 | ⚠️ 声明启用，实际随 selector health 降级 |
| 降级行为 | — | ✅ 4 档 health 检查，缺关键元素时降级为「仅记忆/Skill 注入」，不阻断网络层增强 |

## 2. Prompt 数据路径（请求体映射）

| 项 | DeepSeek | 豆包 |
|---|---|---|
| completion 路径 | `/api/v0/chat/completion` ✅ | `/chat/completion` ✅（2026-07-16 CDP 实测） |
| regenerate | 独立端点 `/api/v0/chat/regenerate` ✅ | 复用 completion + `option.is_regen` ✅ |
| history | `/api/v0/chat/history_messages` ✅ 已适配清洗 | `/im/chain/recent_conv` ❌ 未适配（占位路径故意不命中，原样放行） |
| prompt 位置 | 顶层 `prompt` ✅ | `messages.0.content_block.0.content.text_block.text` ✅ |
| 首消息判定 | `parent_message_id=null` ✅ | `client_meta.last_message_index=null` ✅ |
| 会话 ID | `chat_session_id` ✅ | `client_meta.conversation_id` ✅ |
| 思考模式 | `thinking_enabled`（布尔）✅ | `option.need_deep_think`（0/1）✅ 映射就位，❓ 真机开关未跑通 |
| 附件/模型/搜索 | `ref_file_ids`/`model_type`/`search_enabled` ✅ | ➖ 请求体无此字段（空路径 no-op） |
| 签名机制 | Authorization header（header-borrowing）✅ | URL query（a_bogus/msToken/fp），不绑 body hash ✅ 实测 |
| 结构变体 | 单一平面结构 ✅ | 单一嵌套结构（新会话/多轮/Skill/长文本 2824 字四场景一致）✅ |

## 3. 多轮对话

| 项 | DeepSeek | 豆包 |
|---|---|---|
| 每轮增强 | ✅ 生产基线 | ✅ probe-07 V5 |
| messageCount 演进（preset 注入节奏） | ✅ | ✅ 单测锁定（last_message_index 语义对齐） |
| 新建会话 → 切回历史会话 | ✅ | ✅ 真机 20 轮（第 15 轮新建、第 25 轮切回） |
| Skill 命令穿插 | ✅ | ✅ probe-07 V2 |
| 历史回显清洗（切会话重载） | ✅ | ❓ history 未适配，重载场景未逐项验证 |

## 4. 流式响应

| 项 | DeepSeek | 豆包 |
|---|---|---|
| SSE 转发（增强路径） | ✅ | ✅ probe-07：增强后 200 + 37KB 流式数据 |
| 长回复分块 | ✅ | ✅ 24 chunks / 12KB 实测 |
| 工具调用流式解析 | ✅ | ✅（脚手架注入后 AI 可发工具 XML；工具执行链路同 DeepSeek 共享代码） |
| token 速度指示 | ✅ | ✅（共享代码，随增强路径生效） |

## 5. 页面切换（SPA）

| 项 | DeepSeek | 豆包 |
|---|---|---|
| content script 单次初始化 | ✅ | ✅ probe-03（5 轮 pushState + 新建会话） |
| DOM 节点/监听器零泄漏 | ✅ | ✅ 扩展节点恒定 15-16 |
| textarea 重挂载后 Skill 弹窗重附着 | ✅ | ✅ |
| 跨宿主跳转 adapter 自动切换 | ✅ `getActiveAdapter(url)` | ✅ 同左 |

## 6. 长时间运行

| 项 | DeepSeek | 豆包 |
|---|---|---|
| 连发压测 | ✅ 生产基线 | ✅ 20 轮有效（Heap 95→73MB 无累计增长，扩展侧 0 error） |
| 配额限制 | 无已知 | ⚠️ 匿名约 20 条触发登录墙（宿主行为） |

## 7. 自动化测试覆盖

| 层 | DeepSeek | 豆包 |
|---|---|---|
| Adapter 单测（matchUrl/路径/选择器） | ✅ `tests/host-adapter.test.ts` | ✅ 同左 |
| mapping 契约（点分路径读写往返） | ✅ `tests/body-fields.test.ts` | ✅ 同左（真机抓包骨架） |
| 增强流程（augmentRequestBody） | ✅ `tests/request-augmentation.test.ts` 平面 body | ✅ 同文件嵌套 body 6 用例 |
| 启动自检（5 项 + severity） | ✅ `tests/startup-self-check.test.ts` | ✅ 同左 |
| 元数据/诊断导出契约 | ✅ `tests/diagnostics-export.test.ts` | ✅ 同左 |
| 架构守卫（无宿主硬编码） | ✅ `tests/architecture/` | ✅ 同左 |
| 真机 probe（可复跑） | ➖ 未建 probe（生产基线兜底） | ✅ `scripts/verify-phase2/probe-01~07` |
| history 清洗 | ✅ `tests/history-cleanup.test.ts` | ❌ 未适配故无用例 |

## 已知差距汇总（按维护优先级）

1. **豆包 history 清洗未适配**（❌）— 影响切会话重载时脚手架回显；下迭代最高优先。
2. **豆包深度思考真机路径未跑通**（❓）— 映射就位，缺页面开关定位。
3. **豆包 DOM 接管震荡**（⚠️）— sendButton 等锚点弱；网络层增强不受影响。
4. **DeepSeek 无独立 probe 脚本** — 依赖生产基线；共享层大改时建议补跑一次 DeepSeek 真机冒烟。
