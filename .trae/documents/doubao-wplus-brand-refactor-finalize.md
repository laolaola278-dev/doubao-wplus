# Doubao WPlus 品牌重构收尾计划 (Steps 7-12)

## 摘要

本计划承接前序会话已完成的工作（Steps 1-6：DeepSeek adapter 修复、Header 借用拦截器、请求体字段映射、协议名迁移 `deepseek-pp-mcp-*` �?`dwplus-mcp-*`、PowerShell ENOENT 修复、theme-sync 工厂抽取），聚焦于将项目�?中间�?推进�?品牌统一、CI 全绿"的生产级状态�?
**本次收尾的核心发�?*：`BYPASS_HOOK_HEADER` 值在 `fetch-hook.ts`（已更新�?`X-DWPLUS-Bypass-Hook`）与 `core/deepseek/adapter.ts` + `core/shell/attached-file-downloader.ts`（仍�?`X-DPP-Bypass-Hook`）之间存�?**不一�?*，这是一�?*活跃 Bug** —�?旧代码发送的 bypass header 无法被新 fetch hook 识别，导致本应跳过拦截的请求仍被拦截�?
---

## 当前状态分�?
### 已完成（前序会话�?- �?Step 1-4: HostAdapter 接口扩展、Header 借用拦截器、请求体字段映射�?21 测试全绿
- �?Step 5: 协议名迁�?`deepseek-pp-mcp-*` �?`dwplus-mcp-*`�? 文件�?- �?Step 6: shell-mcp-host PowerShell ENOENT 修复（`resolvePowerShellExe()`�?- �?Step 7 (部分): `theme-sync-core.ts` 工厂创建，doubao/deepseek theme-sync 重写�?15 �?
### 待完成（本计划）
- 🔄 Step 7 (CSS class 替换): 24 个文件中�?`dpp-*` �?`dwplus-*`
- �?Step 8: `dpp_*` 错误�?/ 存储�?�?`dwplus_*`
- �?Step 9: 版本号、README、bypass header Bug 修复
- �?Step 10: CI/CD 门禁更新（automation-contract-smoke、e2e 测试�?- �?Step 11: legacy adapter 确认（保留，仅修 bypass header�?- �?Step 12: 最终全量验�?
### 关键发现（Phase 1 探索结果�?
1. **BYPASS_HOOK_HEADER 不一�?Bug**（CRITICAL�?
   - `core/interceptor/fetch-hook.ts` L47: `'X-DWPLUS-Bypass-Hook'` (新�?
   - `core/deepseek/adapter.ts` L23: `'X-DPP-Bypass-Hook'` (旧�?
   - `core/deepseek/conversation-export.ts` L2: �?adapter 导入（传递旧值）
   - `core/shell/attached-file-downloader.ts` L23: `'X-DPP-Bypass-Hook'` (旧�?
   - `core/shell/attached-file-uploader.ts` L24: �?downloader 重新导出（传递旧值）
   - `tests/attached-file-uploader.test.ts` L318: 断言 `'X-DPP-Bypass-Hook'` (旧�?
   - **影响**：旧代码发送的 `X-DPP-Bypass-Hook` 无法�?fetch-hook 识别，bypass 机制断裂

2. **`dpp-` CSS 类名分布**�?4 文件，排�?2 �?.trae 规划文档�?1 个临时文件）:
   - 源文�?15 个：`core/ui/{injected-theme,skill-popup,tool-result-renderer,tool-card}.ts`、`core/inline-agent/renderer.ts`、`core/hosts/{doubao,deepseek}/adapter.ts`、`entrypoints/content.ts`、`entrypoints/content/features/{doubao,deepseek}/{project-sidebar-organizer,history-organizer}.ts`、`entrypoints/content/features/shared/ux-polish.ts`、`entrypoints/speech-engine.main.ts`、`entrypoints/sandbox-offscreen/main.ts`
   - 测试文件 7 个：`tests/{phase5-product-surfaces,project-sidebar-organizer,tool-block-style,tool-result-renderer,injected-theme,inline-agent-renderer,attached-file-uploader}.test.ts`
   - 脚本 1 个：`scripts/manual-e2e-upload-smoke.ts`
   - 临时文件 1 个：`._tmp_write_theme.ts`（应删除�?
3. **`dpp_` 错误�?/ 存储键分�?*�? 文件，排�?2 个规划文档）:
   - `entrypoints/content.ts`: 2 个存储键 `dpp_tool_execution_blocks`、`dpp_inline_agent_traces`
   - `core/shell/attached-file-downloader.ts`: 11 个错误码（`dpp_invalid_file_id` 等）
   - `core/shell/attached-file-uploader.ts`: 8 个错误码
   - `core/mcp/discovery.ts`: 6 个错误码
   - `tests/attached-file-downloader.test.ts`: 断言旧错误码
   - `tests/attached-file-uploader.test.ts`: 断言旧错误码
   - `core/skill/officecli-official/skills/officecli/SKILL.md`: 需人工检查是否相�?
4. **E2E 测试过时断言**:
   - `tests/e2e/main-world-injection.spec.ts` L19,71: 检�?`deepseek-pp-main` + `DPP_BRIDGE_REQUEST`
   - `tests/e2e/extension-load.spec.ts` L61,100: 同上
   - **根因**：`main-world.content.ts` L136 已改为发�?`dwplus-main` + `DWPLUS_BRIDGE_REQUEST`（主值），旧值仅作为 DEPRECATED 常量保留用于接收方向后兼�?   - E2E 测试监听的是**发射�?*的消息，必须更新为新�?
5. **automation-contract-smoke.mjs 过时断言**:
   - L65: `assertContains('entrypoints/main-world.content.ts', 'DPP_BRIDGE_REQUEST')` —�?仍会通过（因�?DEPRECATED 常量仍在），但应改为断言 `DWPLUS_BRIDGE_REQUEST`
   - L83: `assertNotContains('README.md', ['Agent', '任务'].join(' '))` —�?README 将重写，此断言需评估保留
   - L70: `assertContains('core/deepseek/adapter.ts', 'BYPASS_HOOK_HEADER')` —�?保留（常量名不变，仅值变�?
6. **manifest-policy-check.mjs** 已基本合规：
   - 三端权限审查到位（Chrome/Edge/Firefox�?   - �?`declarativeNetRequest`（项目未使用，无需最小化�?   - L70 `deepseek/*.wasm` 资源断言 —�?保留（DeepSeek wasm 仍需 web accessible�?   - L81-83 Pyodide 资源断言 —�?保留（Pyodide 仍打包，只是动态加载）
   - 无需修改

7. **package.json** 版本 `0.1.0` �?需改为 `0.1.0-beta.1`

8. **README.md** 仍完全是 doubao-wplus 内容 —�?需彻底重写

9. **`core/deepseek/adapter.ts` (legacy)** 状态：
   - �?3 文件引用：`background.ts`、`auth.ts`、`tests/deepseek-adapter-stream.test.ts`
   - 提供 `submitPromptStreaming`、PoW 逻辑、SSE 解析、`BYPASS_HOOK_HEADER`
   - **不是死代�?*，必须保�?   - 唯一需要改的：L23 `BYPASS_HOOK_HEADER` �?
---

## 提议改动

### Step 7: CSS 类名品牌替换 (`dpp-*` �?`dwplus-*`)

**策略**：在 24 个文件上执行 `replace_all: true` �?`dpp-` �?`dwplus-` 替换。由于测试文件读取源文件并断言具体 `dpp-` 字符串，所有文件必�?*同步**替换�?
**文件清单**�?3 个源 + 测试 + 脚本文件�? 个临时文件删除）:

源文件（15 个）:
1. `core/ui/injected-theme.ts` �?`dpp-theme-dark/light`、`--dpp-ui-*` CSS 变量、`dpp-injected-theme-css` ID
2. `core/ui/skill-popup.ts` �?`dpp-theme-*`、`--dpp-skill-popup-*`、`dpp-skill-popup-css` ID
3. `core/ui/tool-result-renderer.ts` �?`dpp-theme-*`、`dpp-artifact-*` 类名
4. `core/ui/tool-card.ts` �?`dpp-*` 类名
5. `core/inline-agent/renderer.ts` �?`dpp-*` 类名
6. `core/hosts/doubao/adapter.ts` �?`#dpp-tool-block`、`[data-dpp-tool-block]` 选择�?7. `core/hosts/deepseek/adapter.ts` �?同上
8. `entrypoints/content.ts` �?100+ 处（CSS 类、ID、data 属性）
9. `entrypoints/content/features/doubao/project-sidebar-organizer.ts`
10. `entrypoints/content/features/doubao/history-organizer.ts`
11. `entrypoints/content/features/deepseek/project-sidebar-organizer.ts`
12. `entrypoints/content/features/deepseek/history-organizer.ts`
13. `entrypoints/content/features/shared/ux-polish.ts`
14. `entrypoints/speech-engine.main.ts`
15. `entrypoints/sandbox-offscreen/main.ts`

测试文件�? 个）:
16. `tests/phase5-product-surfaces.test.ts`
17. `tests/project-sidebar-organizer.test.ts`
18. `tests/tool-block-style.test.ts` �?断言 `--dpp-ui-text`、`dpp-tool-block-item`
19. `tests/tool-result-renderer.test.ts` �?断言 `body.dpp-theme-dark .dpp-result-text`
20. `tests/injected-theme.test.ts` �?断言 `body.dpp-theme-dark`、`--dpp-ui-text`
21. `tests/inline-agent-renderer.test.ts`
22. `tests/attached-file-uploader.test.ts`

脚本�? 个）:
23. `scripts/manual-e2e-upload-smoke.ts`

临时文件删除:
- `._tmp_write_theme.ts` �?删除（非项目代码�?
**执行方式**：对每个文件调用 `Edit(old_string="dpp-", new_string="dwplus-", replace_all=true)`�?
**风险解决**：消除原 Agent 评估�?品牌重构不彻�?风险点。所有用户可见的 CSS 类名、DOM 选择器、data 属性统一�?`dwplus-` 前缀�?
---

### Step 8: 错误�?/ 存储键品牌替�?(`dpp_*` �?`dwplus_*`)

**文件清单**:

1. **`entrypoints/content.ts`** L208-209:
   - `dpp_tool_execution_blocks` �?`dwplus_tool_execution_blocks`
   - `dpp_inline_agent_traces` �?`dwplus_inline_agent_traces`
   - **注意**：这�?IndexedDB / chrome.storage 键，旧用户数据会丢失。但项目处于 beta 阶段，且版本归零�?`0.1.0-beta.1`，可接受�?
2. **`core/shell/attached-file-downloader.ts`**�?1 处）:
   - `dpp_invalid_file_id` �?`dwplus_invalid_file_id`
   - `dpp_metadata_http_error` �?`dwplus_metadata_http_error`
   - `dpp_metadata_fetch_failed` �?`dwplus_metadata_fetch_failed`
   - `dpp_metadata_not_found` �?`dwplus_metadata_not_found`
   - `dpp_file_http_error` �?`dwplus_file_http_error`
   - `dpp_file_too_large` �?`dwplus_file_too_large`
   - `dpp_file_fetch_failed` �?`dwplus_file_fetch_failed`
   - `dpp_no_downloader` �?`dwplus_no_downloader`
   - `dpp_download_path_unknown` �?`dwplus_download_path_unknown`

3. **`core/shell/attached-file-uploader.ts`**�? 处）:
   - `dpp_invalid_local_path` �?`dwplus_invalid_local_path`
   - `dpp_file_read_failed` �?`dwplus_file_read_failed`
   - `dpp_file_empty` �?`dwplus_file_empty`
   - `dpp_file_too_large` �?`dwplus_file_too_large`
   - `dpp_upload_fetch_failed` �?`dwplus_upload_fetch_failed`
   - `dpp_upload_http_error` �?`dwplus_upload_http_error`
   - `dpp_upload_parse_failed` �?`dwplus_upload_parse_failed`
   - `dpp_upload_no_ref_file_id` �?`dwplus_upload_no_ref_file_id`

4. **`core/mcp/discovery.ts`**�? 处）:
   - `dpp_missing_file_id` �?`dwplus_missing_file_id`
   - `dpp_missing_local_path` �?`dwplus_missing_local_path`
   - `dpp_read_local_file_failed` �?`dwplus_read_local_file_failed`
   - `dpp_extension_tool_not_implemented` �?`dwplus_extension_tool_not_implemented`
   - `dpp_read_local_file_empty` �?`dwplus_read_local_file_empty`

5. **`tests/attached-file-downloader.test.ts`** �?更新错误码断言
6. **`tests/attached-file-uploader.test.ts`** �?更新错误码断言
7. **`core/skill/officecli-official/skills/officecli/SKILL.md`** �?人工检查，若含 `dpp_` 则替�?
**执行方式**：对每个文件调用 `Edit(old_string="dpp_", new_string="dwplus_", replace_all=true)`。若 `dpp_` �?SKILL.md 中是其他上下文（如文档内容），则跳过�?
**风险解决**：统一内部错误码命名空间，便于日志排查和未来多宿主扩展�?
---

### Step 9: 版本归零 + README 重写 + Bypass Header Bug 修复

#### 9.1 版本�?
**文件**: `package.json` L5
- `"version": "0.1.0"` �?`"version": "0.1.0-beta.1"`

#### 9.2 Bypass Header Bug 修复（CRITICAL�?
**文件 1**: `core/deepseek/adapter.ts` L23
```typescript
// �?export const BYPASS_HOOK_HEADER = 'X-DPP-Bypass-Hook';
// �?export const BYPASS_HOOK_HEADER = 'X-DWPLUS-Bypass-Hook';
```

**文件 2**: `core/shell/attached-file-downloader.ts` L23
```typescript
// �?export const DOWNLOAD_ATTACHED_FILE_BYPASS_HEADER = 'X-DPP-Bypass-Hook';
// �?export const DOWNLOAD_ATTACHED_FILE_BYPASS_HEADER = 'X-DWPLUS-Bypass-Hook';
```

**文件 3**: `tests/attached-file-uploader.test.ts` L318
```typescript
// �?expect(UPLOAD_ATTACHED_FILE_BYPASS_HEADER).toBe('X-DPP-Bypass-Hook');
// �?expect(UPLOAD_ATTACHED_FILE_BYPASS_HEADER).toBe('X-DWPLUS-Bypass-Hook');
```

**文件 4**: `tests/attached-file-downloader.test.ts` �?检查是否有 bypass header 值断言（L158 只检�?header key 存在 + 值为 `'1'`，不检查具�?header 名，所以无需改）

**风险解决**：修复活�?Bug —�?旧代码发送的 `X-DPP-Bypass-Hook` 无法被已更新�?fetch-hook（`X-DWPLUS-Bypass-Hook`）识别。修复后 bypass 机制恢复一致�?
#### 9.3 README.md 重写

**文件**: `README.md` �?完全重写

**新内容定�?*（遵循用�?README 风格偏好：只写功能特性，不暴�?API 端点/协议细节/架构分层�?
- 标题�?*Doubao WPlus**
- 副标题：把豆包网页版扩展成支持记忆、Skill、自动化、MCP、浏览器控制、对话导出的多宿�?AI Agent 工作�?- 定位：多宿主 AI 增强插件，豆包为第一优先级，兼容 DeepSeek
- 功能速览表（保留原表格结构，主语改为豆包/多宿主）
- 安装说明
- 移除所�?`deepseek-pp` GitHub 链接、Chrome Web Store 链接（或更新为新项目地址�?- 移除"0.7.5 变更回顾"等过�?Release Notes
- 不暴露：`/api/v0/...` 端点、fetch 拦截机制、XML/SSE 协议、架构分�?
**关键改动**:
- `doubao-wplus` �?`Doubao WPlus`（全文）
- `deepseek-pp` 仓库链接 �?更新或移�?- "DeepSeek 网页�? �?"豆包网页�?（主语境�?- 保留 DeepSeek 作为兼容宿主提及
- 移除 `README_EN.md` 链接或同步更新（本次只改 README.md，README_EN.md 后续处理�?
---

### Step 10: CI/CD 门禁更新

#### 10.1 automation-contract-smoke.mjs

**文件**: `scripts/automation-contract-smoke.mjs`

- **L65**: `assertContains('entrypoints/main-world.content.ts', 'DPP_BRIDGE_REQUEST')` �?`assertContains('entrypoints/main-world.content.ts', 'DWPLUS_BRIDGE_REQUEST')`
  - **原因**：断言应验证新协议值存在，而非旧值（旧值作�?DEPRECATED 常量保留，断言旧值无意义�?- **L83**: `assertNotContains('README.md', ['Agent', '任务'].join(' '))` �?评估保留
  - README 重写后若不含 "Agent 任务" 短语则保留；若含则需移除此断言
  - **决策**：保留此断言，README 重写时避免出�?"Agent 任务" 这个特定短语
- **其他断言**：无需改动（L18 legacy adapter 保留、L70 BYPASS_HOOK_HEADER 常量名不变、L74 `deepseek-pp-shell-host` npm 包名保留�?
#### 10.2 E2E 测试更新

**文件 1**: `tests/e2e/main-world-injection.spec.ts` L19, L71
```typescript
// �?if (data?.source === 'deepseek-pp-main' && data.type === 'DPP_BRIDGE_REQUEST') {
// �?if (data?.source === 'dwplus-main' && data.type === 'DWPLUS_BRIDGE_REQUEST') {
```

**文件 2**: `tests/e2e/extension-load.spec.ts` L61, L100
```typescript
// �?if (data.source === 'deepseek-pp-main' && data.type === 'DPP_BRIDGE_REQUEST') {
// �?if (data.source === 'dwplus-main' && data.type === 'DWPLUS_BRIDGE_REQUEST') {
```

**风险解决**：E2E 测试监听**发射�?*消息，发射方已改用新值，测试必须同步。修复后 E2E 测试能正确验�?main-world 脚本注入�?
#### 10.3 manifest-policy-check.mjs

**无需修改**。已验证�?- 三端权限审查合规
- �?`declarativeNetRequest`（项目未使用�?- `deepseek/*.wasm` 资源断言保留（DeepSeek wasm 仍需�?- Pyodide 资源断言保留（动态加载不影响打包�?- 版本一致性检查会自动验证 manifest.version === package.json.version

---

### Step 11: Legacy Adapter 确认

**文件**: `core/deepseek/adapter.ts`

**决策**：保留，不删除�?- �?`background.ts`、`auth.ts`、`tests/deepseek-adapter-stream.test.ts` 引用
- 提供 `submitPromptStreaming`、PoW 逻辑（`solvePowChallengeLocally`）、SSE 解析、历史快�?- 这是 DeepSeek API 客户端（网络层），与 `core/hosts/deepseek/adapter.ts`（HostAdapter，DOM/feature 层）是不同关注点

**唯一改动**（已�?Step 9.2 覆盖�? L23 `BYPASS_HOOK_HEADER` 值更�?
---

### Step 12: 最终全量验�?
执行顺序�?1. `npm run compile` �?TypeScript 编译无错�?2. `npm test` �?所�?vitest 单元测试通过
3. `npm run verify:automation` �?automation-contract-smoke 通过
4. `npm run smoke:shell` �?11 �?shell smoke 测试通过
5. `npm run verify:manifest-policy` �?manifest 策略检查通过（需�?`npm run build:all`�?
**验证检查点**:
- �?无残�?`dpp-` CSS 类名（grep 验证�?- �?无残�?`dpp_` 错误码（grep 验证，排�?SKILL.md 待人工确认）
- �?无残�?`DPP_BRIDGE_REQUEST` �?E2E 测试中（grep 验证�?- �?无残�?`X-DPP-Bypass-Hook`（grep 验证�?- �?`package.json` version === `0.1.0-beta.1`
- �?README.md 首行�?`Doubao WPlus`
- �?`automation-contract-smoke.mjs` 断言 `DWPLUS_BRIDGE_REQUEST`

---

## 假设与决�?
1. **存储键迁移数据丢�?*：`dpp_tool_execution_blocks` �?`dwplus_tool_execution_blocks` 会导致旧用户数据无法读取。决策：可接受，因为版本归零�?`0.1.0-beta.1`，属�?pre-release 阶段�?
2. **README_EN.md 暂不处理**：本次只重写中文 README.md，README_EN.md 留待后续同步。避免扩大改动范围�?
3. **`deepseek-pp-shell-host` npm 包名保留**：这是已发布�?npm 包名，改名需�?npm 废弃流程，不在本次范围�?
4. **DEPRECATED 常量保留**：`main-world.content.ts` �?`bridge.ts` 中的 `DEPRECATED_*` 常量保留，用于接收旧 content script 的向后兼容消息�?
5. **`dpp_*` �?SKILL.md �?*：需人工检�?`core/skill/officecli-official/skills/officecli/SKILL.md`，若 `dpp_` 是文档内容而非代码标识符则跳过�?
6. **manifest-policy-check.mjs 不改**：已验证合规，无需修改�?
---

## 验证步骤

每步完成后执行：
```powershell
npm run compile
npm test
```

全部完成后执行完�?CI 模拟�?```powershell
npm run compile
npm test
npm run verify:automation
npm run smoke:shell
npm run build:all
npm run verify:manifest-policy
```

**风险解决总结**（对应原 Agent 评估�?
- "品牌重构不彻�? �?Steps 7-9 全量替换 `dpp-*`、`dpp_*`、`X-DPP-*`
- "DOM 选择器未经验�? �?�?seq 已完�?`detect()` 机制 + 健康检�?- "a_bogus 拦截缺失" �?�?seq 已完�?Header 借用机制
- "Shell MCP 退出码 bug" �?Step 6 已修�?PowerShell ENOENT
- "CI 跨平台兼容�? �?Step 10 更新过时断言
- "bypass header 不一�? �?Step 9.2 修复活跃 Bug
