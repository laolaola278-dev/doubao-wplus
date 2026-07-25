# 发布前检查清单（Release Checklist）— Doubao WPlus

> 分支：`test/doubao-real-page-baseline` ｜ 基线日期：2026-07-17
> 适用范围：豆包宿主首个发布版本。DeepSeek 宿主延续既有能力，本清单侧重豆包新增路径。

---

## 一、已验证功能

### 自动化验证（可复跑）

| 能力 | 验证方式 | 结果 |
|---|---|---|
| Prompt 增强（普通聊天） | probe-07 V1：hook 修改最终 body，含系统脚手架，服务端 200 + 正常流式回复 | ✅ 2026-07-16 真机 |
| Skill 命令展开（/shell 等） | probe-07 V2：最终 body 中命令展开为 Skill 指令，不以 `/` 开头 | ✅ |
| 多轮对话增强 | probe-07 V5：第 2+ 条消息同样增强且服务端接受 | ✅ |
| 页面回显清洗 | probe-07 V4：用户气泡不泄漏脚手架文本 | ✅ |
| 签名兼容性（P0-3） | 修改 body 后服务端接受 —— `a_bogus`/`msToken` 在 URL query 且不校验 body hash | ✅ 实测排除 |
| 流式响应（增强路径） | 增强后的请求走 `interceptFetchResponse`，长回复分块渲染正常 | ✅ |
| SPA 页面切换 | probe-03：5 轮切换 + 新建会话，无重复初始化、无节点/监听器泄漏 | ✅ |
| 长时间运行 | probe-05：20 轮有效样本，Heap 无累计增长（95→73MB），扩展侧零 Console Error | ✅ |
| body 结构覆盖 | probe-06：新会话 / 多轮 / Skill / 长文本（2824 字）四类场景 prompt 路径一致 | ✅ |
| 单元测试 | `npx vitest run`：60 文件 / 383 用例全绿（含 body-fields 契约、豆包嵌套 augmentation、启动自检） | ✅ |
| 类型检查 | `npx tsc --noEmit` 零错误 | ✅ |
| 架构守卫 | `tests/architecture/no-host-hardcoding.test.ts`：通用层无宿主硬编码 | ✅ |
| DEV 启动自检 | `startup-self-check.ts` 5 项（宿主识别/路径/Prompt 读写/增强执行/映射兼容）双宿主全绿 | ✅ |

### DeepSeek 回归

- 点分路径重构后 DeepSeek 单段路径行为与旧版一致（`tests/body-fields.test.ts` adapter mapping contract 锁定）。
- 既有 353 个存量用例全部通过。

## 二、已知限制

1. **豆包历史会话清洗未适配**：`/im/chain/recent_conv`（cmd=3200 信封结构）与 DeepSeek 响应结构不同，`history` 路径故意保持占位不命中 —— 豆包历史响应原样放行，扩展写入的脚手架若出现在服务端历史中不会被清洗（实测 V4 页面回显干净，但切会话重载场景未逐项验证）。
2. **深度思考场景未真机验证**：页面开关未定位到（probe-06 S5 跳过）；`option.need_deep_think` 字段映射已就位，但真实开启路径未跑通。
3. **豆包 DOM 接管能力不稳定**：`sendButton` 等选择器在 `fallback`/`partial` 间震荡，DOM 类增强（停止生成、会话组织等）时有降级；网络层增强不受影响。
4. **匿名账号配额**：约 20 条消息触发登录墙 —— 影响长跑验证与免登录用户体验，非扩展缺陷。
5. **附件 / 模型选择 / 联网开关**：豆包请求体无对应字段（服务端配置），扩展的 modelType/refFileIds/searchEnabled 逻辑在豆包上为 no-op。

## 三、风险项

| 风险 | 等级 | 缓解 |
|---|---|---|
| 豆包接口结构变更（路径/嵌套层级）导致增强静默失效 | **高** | DEV 启动自检 + `[DWPLUS-FETCH] Skipped...` 诊断日志可即时发现；发布后按"人工验证步骤"定期抽检 |
| 服务端未来对 `a_bogus` 增加 body 校验 | 中 | 一旦增强请求开始被拒（非 200），回归 probe-07 可复现；届时需评估签名复刻或降级为 DOM 注入 |
| 豆包 DOM 改版使选择器全灭 | 中 | selector health 4 档降级已兜底，核心增强不依赖 DOM；fallback 数组便于快速补选择器 |
| 长文本边界（>4K 字）是否拆分多 content_block 未实测 | 低 | 2824 字实测单 block；若拆分，`messages.0.content_block.0` 只增强首块 —— 出现问题时按 probe-06b 扩展场景采集 |
| dev 构建过期导致误判（本次真机验证曾踩坑） | 低 | 已写入宿主适配规范：probe 前确认构建时间戳或显式 `DWPLUS_EXT_DIR` |

## 四、建议的人工验证步骤（发布前一次性执行）

前置：`npm run build:chrome`，Chrome 加载 `dist/chrome-mv3`，登录态豆包账号。

1. **普通聊天**：新会话发送"介绍一下自己"→ 回复正常流式输出；DevTools Network 中 `/chat/completion` 请求 body 的 `text` 字段应含 `## 角色`（或 `## Role`）脚手架。
2. **Skill 注入**：输入 `/` 弹出技能面板 → 选择任一 skill 发送 → Network 中最终 body 不以 `/` 开头且含 skill 指令；页面用户气泡只显示原始命令。
3. **记忆闭环**：在扩展面板添加一条记忆 → 新消息的请求 body 中应包含该记忆内容；对话中让 AI 保存记忆 → 面板中出现新记忆。
4. **多轮 + 会话切换**：同一会话连发 3 条（每条均按步骤 1 检查增强）→ 新建会话 → 切回旧会话再发 1 条，确认上下文正确。
5. **DeepSeek 回归**：chat.deepseek.com 发送 1 条普通消息 + 1 条 Skill 命令，确认增强与专家模式开关正常（防止共享层改动波及）。
6. **异常路径**：断网重连后发消息、生成中点停止，页面无扩展报错（Console 过滤 `DWPLUS`）。
7. （可选，DEV 构建）Console 检查 `[DWPLUS-SELFCHECK]` 一行全绿；`window.__DWPLUS_DIAG__.selfCheck.passed === true`。

## 五、后续可优化项

1. **豆包历史清洗适配**：解析 `/im/chain/recent_conv` 信封结构，切会话重载时剥离脚手架（当前最大的体验缺口）。
2. **深度思考真机路径**：定位页面开关，补 probe 场景，验证 `need_deep_think=1` 下的增强与流式。
3. **豆包 DOM 选择器加固**：与页面改版节奏对齐，把 `sendButton` 等震荡项换成更稳锚点；考虑给 selector health 加遥测采样。
4. **`lastCapturedRequest` 分槽**（phase2 P1-5）：按 `matchedHostPath` 保存而非单槽覆盖，避免 CDN GET 冲掉 completion POST 的诊断记录。
5. **长文本 >4K 场景采集**：扩展 probe-06b，确认多 content_block 拆分行为。
6. **启动自检扩展**：把真机 probe 的关键断言（增强标记、服务端接受）沉淀为可选的 E2E 冒烟任务，接入 CI。
7. **`.e2e-profile` 加入 `.gitignore`**（若尚未）：持久化登录 profile 不应入库。

---

### 发布放行标准

- [ ] 一节所有自动化验证在发布 commit 上重跑全绿
- [ ] 四节人工验证步骤 1-6 全部通过
- [ ] 二节已知限制已在发布说明中向用户披露（至少 1、4 两条）
- [ ] `docs/releases/<version>.md` 已按既有格式撰写
