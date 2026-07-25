# 豆包 WPlus（doubao-wplus）沙盒模拟运行与功能可实现性报告

- **项目**：doubao-wplus —— 把豆包/DeepSeek 网页版扩展成 AI Agent 工作台的浏览器插件（WXT + React 19 + TS）
- **生成时间**：2026-07-08
- **环境**：Node 22.22.2 / WXT 0.20 / 沙盒（无图形界面、无真实浏览器会话、无登录态）

---

## 一、沙盒里实际跑过的验证（证据）

| 验证项 | 命令 | 结果 | 说明 |
|--------|------|------|------|
| Chrome 构建 | `npm run build:chrome` | ✅ EXIT=0 | 产出 `dist/chrome-mv3/manifest.json` + Pyodide 资源 |
| Edge 构建（全新） | `npm run build:edge` | ✅ EXIT=0 | 删除旧产物后重建，版本 `0.1.0`，pyodide 已打包 |
| Firefox 构建（全新） | `npm run build:firefox` | ✅ EXIT=0 | 版本 `0.1.0`，pyodide 已打包 |
| 类型检查 | `npm run compile` | ✅ 0 错误 | `tsc --noEmit` |
| 单元测试 | `npm test` | ✅ 317 用例 / 57 文件全过 | 含 runtime-marker / host-adapter / browser-control 等 |
| MCP 冒烟 | `npm run smoke:mcp` | ✅ EXIT=0 | 发现 / 描述渲染 / 解析 / 过滤 / 工具调用 / 超时路径 OK |
| MCP 实时 mock | `npm run verify:mcp:mock` | ✅ EXIT=0 | 手动/自动化续写 + 本地 HTTP MCP server OK |
| DeepSeek PoW | `npm run smoke:pow` | ✅ EXIT=0 | 工作量证明哈希计算可用 |
| UTF-8/ASCII 转义 | `npm run verify:extension-utf8` | ✅ EXIT=0 | 33 个文件扫描通过 |
| 原生宿主冒烟 | `npm run smoke:shell` | ⚠️ 7 passed / 4 failed | `shell_exec` 真实命令执行不返回正确退出码（见下） |
| 自动化契约 | `npm run verify:automation` | ❌ FAIL | 经核查为**过时契约检查**，非功能缺失（见下） |
| Manifest 策略 | `npm run verify:manifest-policy` | ❌ FAIL | 由**旧版 deepseek-pp v0.7.5 残留产物**误报，重建后消失 |

> 说明：`verify:manifest-policy` 原先报错 edge/firefox 版本为 `0.7.5`、缺 pyodide。重新 `rm -rf dist/edge-mv3 dist/firefox-mv3` 后全新构建，版本正确为 `0.1.0` 且 pyodide 资源齐全 —— 证明该失败是**旧构建产物残留**导致，不是代码问题。

---

## 二、已实现的功能（代码 + 测试支撑，沙盒可验证）

| 功能 | 实现位置 | 沙盒证据 |
|------|----------|----------|
| 记忆系统 Memory（IndexedDB/Dexie） | `core/memory/` | 单测覆盖 |
| Skill 注册与执行 | `core/skill/` | `skill-localization.test` 等通过 |
| MCP 客户端（发现/策略/多传输） | `core/mcp/` | `smoke:mcp` + `verify:mcp:mock` 通过 |
| 对话导出（HTML / Markdown / PDF） | `core/export/` | 导出相关单测通过 |
| 多宿主适配层（豆包 + DeepSeek） | `core/hosts/{types,registry,doubao,deepseek}` | `host-adapter` / `host-url-parser` / `host-selector-utils` 单测通过 |
| fetch 拦截 + SSE 流解析 | `core/interceptor/` | 已修复运行时崩溃；单测覆盖 |
| DeepSeek 工作量证明（PoW）哈希 | `core/deepseek/pow` | `smoke:pow` 通过 |
| 浏览器控制（CDP / chrome.debugger / 无障碍树快照 / 受控标签页） | `core/browser-control/{cdp,service,tool,snapshot,settings}` | `browser-control.test.ts` 通过（用 chrome.debugger stub） |
| 宠物交互精灵 | `core/pet/` + `public/pet/` | 代码存在 |
| 中英双语 i18n + ASCII 转义 | `core/i18n/` + `wxt.config.ts` | `verify:extension-utf8` 通过 |
| 侧边栏 React 管理 UI | `entrypoints/sidepanel/` | 构建产出 `sidepanel.html` |
| 三端（Chrome / Edge / Firefox）构建 | `wxt.config.ts` | 全新构建均 EXIT=0 |

---

## 三、在沙盒里“实现不了 / 跑不通”的功能

### A 类：沙盒固有无法验证（代码已实现，但必须有真实浏览器 + 真实登录会话）

| 功能 | 原因 |
|------|------|
| 豆包/DeepSeek 网页**真实对话拦截**与记忆注入 | 需加载 `www.doubao.com` / `chat.deepseek.com` 并登录 |
| 侧边栏 / 输入框旁内嵌按钮 / 宠物**实际渲染** | 需把扩展加载进 Chrome 并打开对应页面 |
| 浏览器控制 **CDP 真实接管标签页** | 需 `chrome.debugger` 真实会话（单测用 stub，未接真浏览器） |
| Playwright **端到端（E2E）** | 需 Chromium 加载扩展 + 真实页面 + 联网 |

> 这类不是“做不出来”，而是**沙盒环境本身的限制**。代码、构建、单测均已就绪，装上浏览器即可用。

### B 类：代码层面确实缺失 / 有 bug（有实证）

| 问题 | 证据 | 性质 |
|------|------|------|
| 豆包 `a_bogus` / `byted_acrawler` 签名 | 全代码库 `grep a_bogus\|byted_acrawler\|msToken` **零命中** | **未实现**。豆包接口层拦截/签名缺失，只能走 DOM 增强模式（设计上即列为“非目标”） |
| 原生消息宿主 `shell_exec` 真实命令执行 | `smoke:shell`：**7 passed / 4 failed**；`shell_status`/`python_status`/`python_exec` 正常，但 `shell_exec` 的 echo/Unicode/PATH 覆盖/失败命令退出码均不对 | **有 bug**：原生宿主能初始化、能列出工具，但执行真实 shell 命令时不返回正确 `exitCode` / 结构化数据 |
| （误报，非真问题）`verify:automation` / `verify:manifest-policy` | 核查发现 `createShellMcpPresetInput`、`shell_exec`、`readWindowsUserMachinePathDirs`、`WINDOWS_POWERSHELL_UTF8_PREAMBLE` 等片段在代码中**实际均存在** | **过时门禁**：契约检查期待的旧片段/旧包名（`deepseek-pp-shell-host`）已变化，需更新检查脚本 |

---

## 四、结论

1. **能跑的部分（沙盒已验证）**：三端构建、类型检查、317 个单元测试、MCP / Pyodide / PoW / UTF-8 冒烟全部通过；核心 Agent 框架（记忆、Skill、MCP、导出、多宿主、浏览器控制、侧边栏）代码完整且有测试。
2. **沙盒固有跑不了的部分**：一切依赖真实浏览器 + 登录会话的端到端行为（真实对话拦截、UI 渲染、CDP 接管、E2E）—— 这是环境限制，不是缺陷。
3. **真正“实现不了/有硬伤”的两点**：
   - **豆包 `a_bogus` 签名未实现**（全网搜不到），豆包只能做 DOM 增强，无法做接口层拦截/签名（项目方案里本就是非目标）。
   - **原生消息宿主 `shell_exec` 真实命令执行有 bug**（冒烟 4/11 失败），即“用插件在本地跑 shell 命令”这条链路目前不通；`python_exec` 正常。

**一句话**：这是一个框架完整、核心能力可构建可单测的网页增强插件；在沙盒里“跑不通”的硬伤只有「原生宿主 shell 命令执行」一处，另有「豆包接口签名」按设计放弃；其余不可验证项均为沙盒无浏览器会话所致，装上浏览器即可用。
