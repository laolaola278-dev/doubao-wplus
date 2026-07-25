# Release Candidate 报告 — Doubao WPlus RC1

**日期：** 2026-07-17
**分支：** `test/doubao-real-page-baseline`
**扩展版本：** 0.1.0 ｜ Doubao Adapter 1.0.0 ｜ DeepSeek Adapter 1.0.0
**结论：★ 建议发布（GO），带 3 条披露性已知限制**

---

## 一、发布判定

| 判定维度 | 状态 |
|---|---|
| 核心业务闭环（Prompt 增强/Skill/记忆/多轮/流式） | ✅ 真机验证通过（probe-07 + probe-08） |
| 单元测试 | ✅ 61 文件 / 393 用例全绿 |
| 类型检查 | ✅ `tsc --noEmit` 零错误 |
| 架构守卫 | ✅ 通用层无宿主硬编码 |
| 生产构建 | ✅ `build:chrome` 成功 |
| 探索性测试 | ✅ 无发布阻断问题（详见第三节） |
| DEV 自检（真机） | ✅ 5 项全过，0 ERROR / 0 WARN |

**GO 理由**：核心链路（网络层增强）在真实浏览器多场景稳定；已知问题全部属于降级型（DOM 接管、历史清洗），有明确的降级行为且不破坏宿主页面原生功能。

## 二、本 RC 阶段新增的工程能力（无业务功能变更）

1. **Adapter 元数据**（`getMeta()`）：版本 / 最近验证日期 / 已验证页面与数据结构 / 证据文件路径，双 adapter 均已填充（契约测试锁定格式）。
2. **Host Compatibility Matrix**：`docs/host-compatibility-matrix.md`，7 维度 × 2 宿主统一状态表。
3. **Self Check severity 分级**：ERROR（核心链路不可用，阻断）/ WARN（次级降级，不阻断 passed）/ INFO（通过项）；console.error/warn/info 分级输出。
4. **诊断导出**：DEV 构建下 `window.__DWPLUS_EXPORT_DIAG__()` 一键导出 host / adapter 元数据 / DEBUG 状态 / 自检报告 / 最近一次增强执行摘要（全脱敏：无 prompt 内容、无 header 值）。
5. **最近增强执行追踪**：`lastAugmentation`（路径/通道/是否修改/body 长度/错误），fetch 与 XHR 双通道覆盖。
6. **探索性测试脚本**：`scripts/verify-phase2/probe-08-exploratory.cjs`（可复跑）。

## 三、探索性测试结果（2026-07-17 真机，登录态，RC 构建）

模拟真实用户行为，8 项探索：

| # | 场景 | 观察 | 需修复? | 影响发布? |
|---|---|---|---|---|
| E1 | 冷启动 | 自检 5/5 全过（0E/0W），诊断导出可用，SELF_CHECK_REPORT 经桥接队列正确送达 | 否 | 否 |
| E2 | 特殊字符（emoji/引号/反斜杠/HTML 标签/内嵌 JSON） | 增强正常、JSON 转义无损、服务端 200 | 否 | 否 |
| E3 | 多行消息（Shift+Enter） | 增强正常、换行保留 | 否 | 否 |
| E4 | Skill 弹窗 Esc 取消后发普通消息 | 消息正常增强发送。probe 报"popup visible=false"为**测试脚本假阴性**（弹窗 `position:fixed`，`offsetParent` 恒 null）；console 日志证实弹窗匹配逻辑实际在跑（/she → 1 match） | 测试脚本待改进 | 否 |
| E5 | 快速连发（第 1 条未回完发第 2 条） | 第 1 条流被 `net::ERR_ABORTED`（豆包页面自身取消前一流），第 2 条正常完成；两条均被增强，扩展无错误、无泄漏 | 否（宿主行为） | 否 |
| E6 | 空输入回车 | 0 个 completion 请求（符合预期） | 否 | 否 |
| E7 | 未注册的 `/notaskill` 命令 | 弹窗 0 匹配，文本按普通消息增强发送（marker 在 body 中确认）。probe 的"sent-as-is=false"为**取尾部回显的假阴性** | 测试脚本待改进 | 否 |
| E8 | 结束快照 | `lastAugmentation`: 1579→11057 字节、无错误；DWPLUS 侧 console error = 0；仅 2 条豆包自身 CSP 噪音 | 否 | 否 |

**结论：未发现需要修复的产品缺陷。** 两处假阴性属于探索脚本自身的检查方法问题（已在脚本注释与本报告记录），不影响产品。

## 四、已知限制（发布说明需披露）

1. **豆包历史会话清洗未适配** — 切换会话重新加载历史时，扩展注入的系统脚手架可能出现在用户消息气泡中（当前会话内实时回显已验证干净）。
2. **豆包 DOM 增强不稳定** — 历史组织、主题同步等 DOM 类功能随页面结构波动降级；核心增强（记忆/Skill/系统提示）不受影响。
3. **匿名使用配额** — 豆包匿名账号约 20 条消息后被登录墙拦截（宿主限制）。

## 五、剩余风险

| 风险 | 等级 | 监测/缓解 |
|---|---|---|
| 豆包接口契约变更（路径/结构） | 高 | DEV 自检 ERROR 级告警 + `lastAugmentation` 追踪；用户报障时用 `__DWPLUS_EXPORT_DIAG__()` 快照定位；Adapter 元数据记录最近验证日期，超期（建议 30 天）复跑 probe-07 |
| 服务端未来校验 body 签名 | 中 | 增强请求开始非 200 时立即可见；回退方案评估见 host-onboarding-guide |
| 快速连发下的流中断（E5） | 低 | 宿主自身行为；扩展已优雅处理。若用户反馈丢消息，检查是否宿主取消而非扩展 |
| 长文本 >4K 多 content_block 拆分 | 低 | 出现时仅首块被增强；按需扩展 probe-06b 采集 |

## 六、后续迭代建议（优先级序）

1. **豆包历史清洗适配**（已知限制 #1 的根治）— 解析 `/im/chain/recent_conv` 信封结构。
2. **深度思考真机路径** — 定位页面开关，验证 `need_deep_think=1` 场景。
3. **探索脚本修正** — E4 弹窗可见性改用 `getBoundingClientRect`/`checkVisibility()`；E7 回显改取增强文本头部的用户输入段。
4. **DeepSeek 真机冒烟 probe** — 目前依赖生产基线；共享层变更后应有可复跑验证。
5. **Adapter 元数据自动化** — CI 检查 `lastVerifiedAt` 距今超过阈值时提示复验。
6. **`lastCapturedRequest` 分槽**（phase2 P1-5 遗留）。
7. **`.e2e-profile` 确认在 `.gitignore`**。

## 七、证据清单

| 文件 | 内容 |
|---|---|
| `playwright-results/phase2-08-exploratory.json` | 探索性测试完整记录（本报告第三节数据源） |
| `playwright-results/phase2-07-augmentation-verify.json` | 增强闭环回归（2026-07-16） |
| `docs/host-compatibility-matrix.md` | 兼容性矩阵 |
| `docs/host-onboarding-guide.md` | 宿主适配规范 |
| `docs/release-checklist-doubao.md` | 发布检查清单（人工验证步骤仍适用） |
| `tests/diagnostics-export.test.ts` 等 | 本阶段新增 10 用例（总 393） |

---

### 放行签署

- [x] 自动化验证全绿（2026-07-17 复跑）
- [x] 探索性测试无阻断问题
- [ ] 发布说明披露已知限制 1、2、3（发布时勾选）
- [ ] `docs/releases/<version>.md` 撰写（发布时勾选）
