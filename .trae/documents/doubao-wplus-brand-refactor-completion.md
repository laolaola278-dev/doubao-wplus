# Doubao WPlus 品牌重构收尾计划

## 摘要

本计划延续前序会话已完成的工作（Steps 1-8：HostAdapter 接口、Header 借用拦截器、协议名迁移、CSS 类名 `dpp-` �?`dwplus-`、错误码 `dpp_` �?`dwplus_`、bypass header bug 修复、版本号升级�?`0.1.0-beta.1`），完成剩余的品牌标准化�?CI 刷新工作�?
**用户已批准扩大范�?*：除了原计划�?README 重写 + automation-contract-smoke + e2e 测试更新外，还将迁移先前被推迟的 `DPP_*` 大写内部常量（automation 消息类型、sandbox 协议、代码块占位符）�?`DWPLUS_*`，以实现用户要求�?彻底替换"�?
## 当前状态分�?
### 已完成（前序会话�?
| 项目 | 状�?| 验证 |
|------|------|------|
| `package.json` version `0.1.0-beta.1` | �?| 已读取确�?|
| CSS 类名 `dpp-` �?`dwplus-`�?3 文件�?| �?| grep 无残�?|
| 标识�?`__dpp` �?`__dwplus`�? 文件�?| �?| grep 无残�?|
| DOM 属�?`.dataset.dpp` �?`.dataset.dwplus`�? 文件�?| �?| grep 无残�?|
| 错误�?`dpp_` �?`dwplus_`�? 文件�?| �?| grep 无残�?|
| Bypass header `X-DPP-Bypass-Hook` �?`X-DWPLUS-Bypass-Hook`�? 文件�?| �?| grep 无残�?|
| `main-world.content.ts` 双常量模式（DWPLUS_ �?+ DPP_ 废弃�?| �?| 已读取确�?|
| `bridge.ts` 双常量模�?| �?| 已读取确�?|
| `schema.ts` 同时接受 `DWPLUS_BRIDGE_READY` + `DPP_BRIDGE_READY` | �?| 已读取确�?|

### 剩余工作（本计划范围�?
#### A. README.md 全量重写�?15 �?�?�?250 行）

**当前问题**�?- 全文�?doubao-wplus 品牌定位
- L12-16：GitHub stars/watchers/forks 徽章指向 `deepseek-pp` 仓库
- L19-20：Chrome Web Store 链接（DeepSeek++ 商店页面�?- L35-41：产品定位完全围�?DeepSeek
- L53-70：功能表�?doubao-wplus 为主�?- L279-653�?.7.x 变更日志全部引用 doubao-wplus
- L655-712：安装说明引�?`deepseek-pp` 仓库�?Chrome Web Store

**重写要求**（依�?AGENTS.md 工作区规�?+ automation-contract-smoke.mjs L83 断言）：
- 标题改为 **Doubao WPlus**
- 副标题定位为"多宿�?AI 增强插件，豆包为第一优先�?
- **只描�?能做什�?，不描述"怎么做到�?**（不暴露 fetch 拦截、XML/SSE 协议、架构分层、API 端点�?- 移除所�?`deepseek-pp` GitHub 链接�?Chrome Web Store 链接
- 移除 0.7.x 变更日志（这些是继承自原项目的过�?Release Notes�?- **避免 "Agent 任务" 短语**（automation-contract-smoke.mjs L83: `assertNotContains('README.md', 'Agent 任务')`�?- 保留有用的产品截图（`screenshot-sidepanel-*` 是通用的，不暴露宿主特�?UI�?- 保留友情链接�?License 部分

**�?README 结构**�?1. 标题 + 副标题（Doubao WPlus，多宿主 AI 增强插件�?2. 产品定位（豆包为第一优先级，DeepSeek 为兼容宿主）
3. 功能速览表（保留原表结构，主语改�?Doubao WPlus�?4. 适合场景
5. 核心功能（精简版，保留用户可感知的能力描述�?6. 安装（仅源码构建，移�?Chrome Web Store�?7. 友情链接
8. License

#### B. automation-contract-smoke.mjs 断言更新

**当前 L65**�?```javascript
assertContains('entrypoints/main-world.content.ts', 'DPP_BRIDGE_REQUEST');
```

**问题**：`main-world.content.ts` 现在主常量是 `DWPLUS_BRIDGE_REQUEST`，`DPP_BRIDGE_REQUEST` 仅作�?`DEPRECATED_BRIDGE_REQUEST_TYPE` 的值保留。断言应验证主常量存在�?
**修改**�?```javascript
assertContains('entrypoints/main-world.content.ts', 'DWPLUS_BRIDGE_REQUEST');
```

**其他断言**（L74 `assertContains('packages/shell-host/package.json', 'deepseek-pp-shell-host')`）：保留，这是已发布�?npm 包名，不应改动�?
#### C. E2E 测试断言更新（关�?Bug 修复�?
**当前问题**：e2e 测试监听 `source === 'deepseek-pp-main' && type === 'DPP_BRIDGE_REQUEST'`，但 `main-world.content.ts` L136 现在发射的是 `source: 'dwplus-main'` + `type: 'DWPLUS_BRIDGE_REQUEST'`（主值）。这�?e2e 断言永远不会匹配，是**活跃 Bug**�?
**修改文件与位�?*�?- `tests/e2e/main-world-injection.spec.ts` L19, L71�?  - `'deepseek-pp-main'` �?`'dwplus-main'`
  - `'DPP_BRIDGE_REQUEST'` �?`'DWPLUS_BRIDGE_REQUEST'`
- `tests/e2e/extension-load.spec.ts` L61, L100�?  - 同上

#### D. Automation 协议常量迁移

**文件 1：`core/automation/messages.ts`**

| �?| 当前�?| 新�?|
|----|--------|------|
| L9 | `'DPP_AUTOMATION_CONTENT_RUN'` | `'DWPLUS_AUTOMATION_CONTENT_RUN'` |
| L10 | `'DPP_AUTOMATION_WINDOW_RUN_REQUEST'` | `'DWPLUS_AUTOMATION_WINDOW_RUN_REQUEST'` |
| L11 | `'DPP_AUTOMATION_WINDOW_RUN_RESULT'` | `'DWPLUS_AUTOMATION_WINDOW_RUN_RESULT'` |
| L14 | `'deepseek-pp-content'` | `'dwplus-content'` |
| L15 | `'deepseek-pp-main'` | `'dwplus-main'` |

**文件 2：`core/automation/types.ts`**

| �?| 当前�?| 新�?|
|----|--------|------|
| L177 | `type: 'DPP_AUTOMATION_CONTENT_RUN'` | `type: 'DWPLUS_AUTOMATION_CONTENT_RUN'` |
| L182 | `type: 'DPP_AUTOMATION_WINDOW_RUN_RESULT'` | `type: 'DWPLUS_AUTOMATION_WINDOW_RUN_RESULT'` |

**安全性分�?*：这些常量是 background �?content �?main-world 之间的运行时消息类型，不被持久化到存储。所有引用方都在本仓库内（grep 确认无测试文件直接引用这些字符串字面量）。`messages.ts` 中的 `typeof` 引用会自动跟随常量值变化，无需额外改动�?
#### E. Sandbox 协议常量迁移

**文件 1：`entrypoints/sandbox-offscreen/main.ts`**

| �?| 当前�?| 新�?|
|----|--------|------|
| L41 | `'DPP_SANDBOX_RESULT'` | `'DWPLUS_SANDBOX_RESULT'` |
| L67 | `'DPP_SANDBOX_RUN'` | `'DWPLUS_SANDBOX_RUN'` |

**文件 2：`entrypoints/sandbox-runner/main.ts`**

| �?| 当前�?| 新�?|
|----|--------|------|
| L17 | `'DPP_SANDBOX_RUN'` | `'DWPLUS_SANDBOX_RUN'` |
| L34 | `'DPP_SANDBOX_RESULT'` | `'DWPLUS_SANDBOX_RESULT'` |
| L37 | `'DPP_SANDBOX_RESULT'` | `'DWPLUS_SANDBOX_RESULT'` |
| L118 | `'DPP_HTML_LOG'` | `'DWPLUS_HTML_LOG'` |
| L124 | `'DPP_HTML_ERROR'` | `'DWPLUS_HTML_ERROR'` |
| L128 | `'DPP_HTML_DONE'` | `'DWPLUS_HTML_DONE'` |
| L163 | `'DPP_HTML_LOG'` | `'DWPLUS_HTML_LOG'` |
| L168 | `'DPP_HTML_ERROR'` | `'DWPLUS_HTML_ERROR'` |
| L171 | `'DPP_HTML_ERROR'` | `'DWPLUS_HTML_ERROR'` |
| L175 | `'DPP_HTML_DONE'` | `'DWPLUS_HTML_DONE'` |

**安全性分�?*：sandbox-offscreen �?sandbox-runner 是配对的两端，都在本仓库内。这些是运行�?postMessage 类型，不被持久化。grep 确认无测试文件引用这些字面量�?
#### F. 常量名与占位符迁�?
**文件 1：`core/constants.ts` L24**
```typescript
// 当前（常量名未迁移，值已迁移�?export const DPP_MANAGED_AGENT_PROMPT_MARKER = '<!-- doubao-wplus-managed-agent-runner:v1 -->';
// 改为
export const DWPLUS_MANAGED_AGENT_PROMPT_MARKER = '<!-- doubao-wplus-managed-agent-runner:v1 -->';
```

**文件 2：`core/interceptor/history-cleanup.ts`**
- L1: `import { DPP_MANAGED_AGENT_PROMPT_MARKER } from '../constants';` �?`import { DWPLUS_MANAGED_AGENT_PROMPT_MARKER } from '../constants';`
- L573: `if (content.includes(DPP_MANAGED_AGENT_PROMPT_MARKER)) return true;` �?`if (content.includes(DWPLUS_MANAGED_AGENT_PROMPT_MARKER)) return true;`

**文件 3：`core/inline-agent/markdown.ts`**
- L9: `` `@@DPP_CODE_BLOCK_${codeBlocks.length}@@` `` �?`` `@@DWPLUS_CODE_BLOCK_${codeBlocks.length}@@` ``
- L28: `/@@DPP_CODE_BLOCK_(\d+)@@/g` �?`/@@DWPLUS_CODE_BLOCK_(\d+)@@/g`

**安全性分�?*�?- `DPP_MANAGED_AGENT_PROMPT_MARKER` 的值（HTML 注释标记）已经是 `doubao-wplus-managed-agent-runner:v1`，本次仅改常量名。值不变，因此已持久化的对话历史中的标记仍能被识别。常量仅�?2 文件中使用�?- `@@DPP_CODE_BLOCK_` 是单函数内的临时占位符，emit �?restore 在同一文件中配对，不被持久化�?
## 不改动的项（明确保留�?
| �?| 原因 |
|----|------|
| `entrypoints/main-world.content.ts` L27/29/31 �?`DEPRECATED_*` 常量 | 向后兼容，用于接收旧 content script 发来的旧协议消息 |
| `entrypoints/content/features/shared/bridge.ts` L13/15/17 �?`DEPRECATED_*` 导出 | 同上 |
| `core/messaging/schema.ts` L12/35 �?`DPP_BRIDGE_READY` | 验证器必须接受旧协议消息以保持兼�?|
| `tests/bridge-schema.test.ts` L7/11/18/19/20/24 使用 `deepseek-pp-main` + `DPP_BRIDGE_READY` | 这些�?*有意**测试旧协议消息仍被验证器接受的测试夹具，证明向后兼容生效 |
| `scripts/mcp-smoke.mjs` L104 �?`D:\ai project\deepseek-pp-main` | 这是测试夹具数据（Windows 路径字符串），不是项目引�?|
| `packages/shell-host/package.json` �?`deepseek-pp-shell-host` npm 包名 | 已发布的 npm 包名，改动会破坏现有安装 |

## 假设与决�?
1. **README 截图保留**：`assets/screenshot-sidepanel-*.png` 等截图是通用的能力展示，不暴露宿主特�?UI，保留使用�?2. **README 不包含技术栈**：依�?AGENTS.md 工作区规则，README 不描述技术栈、项目结构、工作原理�?3. **README 避免 "Agent 任务"**：automation-contract-smoke.mjs L83 断言禁止此短语。改�?自动化任�?�?代理任务"等替代表述�?4. **DPP_ 迁移不做双常量模�?*：与 bridge 协议不同，automation/sandbox 协议的两端都在本仓库内，无外部兼容需求，直接单值替换�?5. **执行顺序**：先改源码（D-F），再改测试（B-C），最后重�?README（A），最后全量验证。这�?README 重写不会因为测试失败而被阻塞�?
## 执行步骤

### Step 1: Automation 协议常量迁移（Phase D�?- 编辑 `core/automation/messages.ts` L9-11, L14-15
- 编辑 `core/automation/types.ts` L177, L182
- 运行 `npm run compile` 验证类型检�?
### Step 2: Sandbox 协议常量迁移（Phase E�?- 编辑 `entrypoints/sandbox-offscreen/main.ts` L41, L67
- 编辑 `entrypoints/sandbox-runner/main.ts`�?0 �?replace_all�?- 运行 `npm run compile` 验证

### Step 3: 常量名与占位符迁移（Phase F�?- 编辑 `core/constants.ts` L24（常量名 `DPP_` �?`DWPLUS_`�?- 编辑 `core/interceptor/history-cleanup.ts` L1, L573（import + usage�?- 编辑 `core/inline-agent/markdown.ts` L9, L28（占位符�?- 运行 `npm run compile` 验证

### Step 4: 运行单元测试
- `npm test` 确保所�?321 个测试通过

### Step 5: automation-contract-smoke.mjs 断言更新（Phase B�?- 编辑 `scripts/automation-contract-smoke.mjs` L65
- 运行 `npm run verify:automation` 验证

### Step 6: E2E 测试断言更新（Phase C�?- 编辑 `tests/e2e/main-world-injection.spec.ts` L19, L71
- 编辑 `tests/e2e/extension-load.spec.ts` L61, L100
- 运行 `npm run compile` 验证类型

### Step 7: README.md 全量重写（Phase A�?- �?Write 工具完全重写 `README.md`
- 运行 `npm run verify:automation` 确认 L83 断言通过
- 手动检�?README 不含 "Agent 任务" 短语

### Step 8: 最终全量验�?- `npm run compile`
- `npm test`
- `npm run verify:automation`
- `npm run smoke:shell`
- Grep 验证：`DPP_` 仅存在于 DEPRECATED_ 常量、schema.ts 验证器、bridge-schema.test.ts 测试夹具、mcp-smoke.mjs 路径字符串中

## 验证步骤

每个 Step 完成后运行对应的验证命令。最终验证清单：

1. **编译通过**：`npm run compile` 无错�?2. **单元测试全绿**：`npm test` 所�?321 个测试通过
3. **自动化契约通过**：`npm run verify:automation` 通过（包�?README "Agent 任务" 断言�?4. **Shell MCP smoke 通过**：`npm run smoke:shell` 退出码 0
5. **Grep 残留检�?*�?   - `DPP_` 仅在 DEPRECATED_ 常量、schema.ts 验证器、bridge-schema.test.ts、mcp-smoke.mjs �?   - `dpp-` / `dpp_` / `__dpp` / `.dataset.dpp` 在源码中无残�?   - `deepseek-pp-main` / `deepseek-pp-content` 仅在 DEPRECATED_ 常量�?bridge-schema.test.ts �?6. **README 检�?*�?   - 不含 "Agent 任务" 短语
   - 不含 `deepseek-pp` GitHub 链接
   - 不含 Chrome Web Store 链接
   - 不含技术实现细节（API 端点、协议、架构）
   - 标题�?Doubao WPlus

## 风险与缓�?
| 风险 | 缓解 |
|------|------|
| Automation 常量迁移破坏 background �?content 协议 | 所有引用方都在本仓库内，`messages.ts` 中的 `typeof` 引用自动跟随；编译期即可发现遗漏 |
| Sandbox 协议迁移破坏 offscreen �?runner 通信 | 两端配对更新，同一次提交完�?|
| README 重写后触�?automation-contract-smoke L83 断言 | 改写时主动避�?"Agent 任务" 短语，改�?自动化任�? |
| E2E 测试更新后类型检查失�?| 已确�?main-world 发射 `dwplus-main` + `DWPLUS_BRIDGE_REQUEST`，与更新后的断言一�?|
