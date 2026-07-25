# doubao-wplus 深度重构计划（续执行版）

## Context

本计划是上一�?`doubao-wplus-deep-refactor.md` 的续执行版本。上一轮已完成步骤 1-4（DeepSeek adapter 解阻塞、Header 借用拦截器、请求体字段映射、模�?2 验证）。本轮基�?2026-07-12 实际代码探索，处�?*剩余步骤 5-12**，并修正上一轮计划中两处错误假设�?
1. **步骤 6 假设修正**：原计划假设 shell_exec 退出码 bug �?`exit` 事件 vs `close` 事件时序问题。实际探索发�?`execCommand`（L844-903）和 python spawn（L1224-1280�?*都已使用 `child.on('close', ...)`**。因�?bug 根因不是事件选择，需重新诊断�?2. **步骤 11 假设修正**：原计划假设 `core/deepseek/adapter.ts` 是死代码可删除。实际探索发现它**仍被 3 处引�?*（`entrypoints/background.ts:175`、`entrypoints/content/features/deepseek/auth.ts:8`、`tests/deepseek-adapter-stream.test.ts:2`），提供 `submitPromptStreaming` / PoW 逻辑 / SSE 解析 / 历史快照。这�?DeepSeek API 客户端（网络层），与 `core/hosts/deepseek/adapter.ts`（HostAdapter，DOM/feature 层）是不同关注点�?*不能删除，只更新品牌**�?
## 当前真实进度（代码事实）

### 已完�?�?- `core/hosts/types.ts` �?接口扩展完整
- `core/hosts/doubao/adapter.ts` �?完整实现新接�?- `core/hosts/deepseek/adapter.ts` �?完整实现新接�?- `core/hosts/registry.ts` �?注册表完�?- `core/interceptor/header-borrowing.ts` �?Header 借用模块已创�?- `core/interceptor/fetch-hook.ts` �?已接入借用机制 + 字段映射 + `[DWPLUS]` 前缀 + `X-DWPLUS-Bypass-Hook`
- `core/interceptor/request-augmentation.ts` �?已用 `getRequestBodyFields()`
- `core/mcp/transports/native.ts` L11 �?`'dwplus-mcp-native'` �?- `core/sandbox/python-worker.ts` �?动�?`import('pyodide')` �?- `entrypoints/main-world.content.ts` �?已有 deprecated+new 双常量迁移模式（`DEPRECATED_BRIDGE_REQUEST_TYPE = 'DPP_BRIDGE_REQUEST'` / `BRIDGE_REQUEST_TYPE = 'DWPLUS_BRIDGE_REQUEST'`）✅

### 待办（按依赖排序�?
**步骤 5 剩余**（协议名迁移）：
- `core/mcp/transports/bridge.ts` L16, L68 �?`deepseek-pp-mcp-bridge` �?`dwplus-mcp-bridge`
- `packages/shell-host/native/shell-mcp-host.mjs` L1466-1467 �?`deepseek-pp-mcp-native` �?`dwplus-mcp-native`
- `packages/shell-host/native/shell-mcp-host.mjs` L283 �?`serverInfo.name: 'deepseek-pp-shell'` �?`'dwplus-shell'`
- `scripts/shell-smoke.mjs` L75 �?协议�?+ L119 serverInfo 断言
- `tests/shell-host-read-local-file.test.ts` L143 �?协议�?- `tests/shell-host-local-skill-preview.test.ts` L113 �?协议�?
**步骤 6**（shell_exec 退出码 bug）：需重新诊断（见下）

**步骤 7**（theme-sync 工厂抽取）：新建 `shared/theme-sync-core.ts` + 精简两份 theme-sync

**步骤 8**（content.ts feature 加载审查）：探索发现已基本正确（L585-600 �?`activeHostId` 分支），只需验证 + CSS class 品牌替换

**步骤 9**（品牌替换）：版本号、README、CSS class、storage key、日志前缀

**步骤 10**（CI/CD 门禁）：manifest-policy-check + automation-contract-smoke 断言更新

**步骤 11**（legacy adapter 评估）：`core/deepseek/adapter.ts` 保留，更新品�?
**步骤 12**（最终验证）

---

## 步骤 5：协议名迁移（完成剩�?5 文件�?
**目标**：把所�?`deepseek-pp-mcp-*` 协议名统一�?`dwplus-mcp-*`，`deepseek-pp-shell` serverInfo 改为 `dwplus-shell`�?
**文件与改�?*�?
### 5.1 `core/mcp/transports/bridge.ts`
- L16 `protocol: 'deepseek-pp-mcp-bridge'` �?`'dwplus-mcp-bridge'`（类型定义）
- L68 `protocol: 'deepseek-pp-mcp-bridge'` �?`'dwplus-mcp-bridge'`（envelope 构造）

### 5.2 `packages/shell-host/native/shell-mcp-host.mjs`
- L283 `serverInfo: { name: 'deepseek-pp-shell', version: '1.0.0' }` �?`{ name: 'dwplus-shell', version: '1.0.0' }`
- L1466 `envelope.protocol !== 'deepseek-pp-mcp-native'` �?`'dwplus-mcp-native'`
- L1467 错误消息 `'Invalid envelope: expected deepseek-pp-mcp-native v1'` �?`'Invalid envelope: expected dwplus-mcp-native v1'`

### 5.3 `scripts/shell-smoke.mjs`
- L75 `protocol: 'deepseek-pp-mcp-native'` �?`'dwplus-mcp-native'`
- L119 `assert(res.result.serverInfo.name === 'deepseek-pp-shell', ...)` �?`'dwplus-shell'`

### 5.4 `tests/shell-host-read-local-file.test.ts`
- L143 `protocol: 'deepseek-pp-mcp-native'` �?`'dwplus-mcp-native'`

### 5.5 `tests/shell-host-local-skill-preview.test.ts`
- L113 `protocol: 'deepseek-pp-mcp-native'` �?`'dwplus-mcp-native'`

**验证**：`npm run compile && npm test`

**风险解决**：协议名不一致导�?native host 拒绝扩展请求——统一�?dwplus 品牌后通信链路自洽�?
---

## 步骤 6：Shell MCP 退出码 bug 重新诊断

**重要修正**：原计划假设�?`exit` vs `close` 事件问题。实际探索发�?`execCommand`（L889）和 python spawn（L1265�?*都已使用 `child.on('close', ...)`**。假设不成立�?
**新诊断策�?*�?
1. **先跑 smoke:shell 收集真实失败**�?   ```bash
   npm run smoke:shell 2>&1 | tee /tmp/shell-smoke-output.txt
   ```
   记录哪些 case FAIL、错误信息是什么�?
2. **可能的根�?*（按概率排序）：
   - **Windows PowerShell UTF-8 BOM**：L76-81 �?`WINDOWS_POWERSHELL_UTF8_PREAMBLE` 试图处理，但可能覆盖不全。如�?stdout 首字节是 `0xEF 0xBB 0xBF`，`echo hello_world` 的断言 `data.stdout.trim() === 'hello_world'` 会因 BOM 前缀失败�?   - **PowerShell 输出格式**：`Write-Output "中文路径-123"` 在某�?PS 版本下会�?BOM 或换行符差异�?   - **PATH 环境变量继承**：L203-229 �?PATH override 测试，Windows �?`Path` vs `PATH` 大小写敏感问题�?   - **退出码 42 测试**（L248-255）：`exit 42` �?PowerShell 中可能需�?`exit 42` vs `Exit 42` vs `$host.SetShouldExit(42)`�?
3. **根据真实失败修复**�?   - 如果�?BOM 问题 �?�?`execCommand` �?`close` 回调中，�?Windows 平台�?stdout 做首字节 BOM 剥离（`0xEF 0xBB 0xBF`�?   - 如果�?PATH 大小�?�?检�?`createChildEnv` 是否正确合并 `Path` �?`PATH`
   - 如果是退出码 �?检�?PowerShell �?`exit` 语义

4. **修复后验�?*：`npm run smoke:shell` 全绿�?
**关键代码位置**�?- `execCommand`：L844-903
- `createShellInvocation`：需读取确认 PowerShell 参数
- `WINDOWS_POWERSHELL_UTF8_PREAMBLE`：L76-81
- `createChildEnv`：需读取确认环境变量合并

**风险解决**：smoke:shell 失败——基于真实错误信息修复，不基于错误假设�?
---

## 步骤 7：theme-sync 工厂抽取

**目标**：消�?doubao/deepseek 两份 theme-sync �?224 行重复代码，统一 CSS class �?`dwplus-theme-*`�?
**现状**�?- `entrypoints/content/features/doubao/theme-sync.ts`�?24 行）�?`SET_CLIENT_THEME` + `startDoubaoThemeSync`
- `entrypoints/content/features/deepseek/theme-sync.ts`�?24 行）�?`SET_DEEPSEEK_THEME` + `startThemeSync`
- 两文件唯一差异：message type、函数名
- 两文件都�?`dpp-theme-dark` / `dpp-theme-light` CSS class（需 �?`dwplus-theme-*`�?
**新增文件**：`entrypoints/content/features/shared/theme-sync-core.ts`

```typescript
import type { DeepSeekTheme } from '../../../../core/types';

export interface ThemeSyncConfig {
  /** 发给 background 的消息类�?*/
  messageType: string;
  /** 宿主标签（日志用�?*/
  hostLabel: string;
  /** 额外主题探测（宿主专属属性，可选） */
  detectExtraTheme?: () => DeepSeekTheme | null;
}

export function createThemeSync(config: ThemeSyncConfig) {
  let themeObserver: MutationObserver | null = null;
  let themeTreeObserver: MutationObserver | null = null;
  let themeMediaQuery: MediaQueryList | null = null;
  let themeMediaListener: ((event: MediaQueryListEvent) => void) | null = null;
  let themeSyncTimer: ReturnType<typeof setTimeout> | null = null;
  let themeBootstrapTimer: ReturnType<typeof setTimeout> | null = null;
  let themeBootstrapAttempts = 0;
  let currentTheme: DeepSeekTheme | null = null;

  const THEME_BOOTSTRAP_RETRY_MS = 250;
  const THEME_BOOTSTRAP_RETRY_LIMIT = 20;

  function sendThemeMessage(theme: DeepSeekTheme): void {
    try {
      void chrome.runtime.sendMessage({ type: config.messageType, payload: { theme } });
    } catch {
      // extension context may be invalidated - safe to ignore
    }
  }

  function observeThemeHost(element: Element | null) {
    if (!element || !themeObserver) return;
    themeObserver.observe(element, {
      attributes: true,
      attributeFilter: ['class', 'style', 'data-theme', 'data-color-mode', 'data-mode', 'color-scheme'],
    });
  }

  function observeThemeTree(element: Element | null) {
    if (!element || !themeTreeObserver) return;
    themeTreeObserver.observe(element, { childList: true, subtree: true });
  }

  function scheduleThemeBootstrapRetry() {
    if (themeBootstrapTimer) return;
    themeBootstrapTimer = setTimeout(() => {
      themeBootstrapTimer = null;
      themeBootstrapAttempts += 1;
      syncTheme();
      if (themeBootstrapAttempts >= THEME_BOOTSTRAP_RETRY_LIMIT) {
        stopThemeBootstrapSync();
        return;
      }
      scheduleThemeBootstrapRetry();
    }, THEME_BOOTSTRAP_RETRY_MS);
  }

  function scheduleThemeSync() {
    if (themeSyncTimer) clearTimeout(themeSyncTimer);
    themeSyncTimer = setTimeout(() => { themeSyncTimer = null; syncTheme(); }, 50);
  }

  function startThemeBootstrapSync() {
    stopThemeBootstrapSync();
    themeBootstrapAttempts = 0;
    themeTreeObserver = new MutationObserver(() => {
      observeThemeTree(document.getElementById('root'));
      scheduleThemeSync();
    });
    observeThemeTree(document.body);
    observeThemeTree(document.getElementById('root'));
    scheduleThemeBootstrapRetry();
  }

  function stopThemeBootstrapSync() {
    themeTreeObserver?.disconnect();
    themeTreeObserver = null;
    if (themeBootstrapTimer) { clearTimeout(themeBootstrapTimer); themeBootstrapTimer = null; }
  }

  function parseThemeText(value: string | null): DeepSeekTheme | null {
    if (!value) return null;
    const normalized = value.toLowerCase();
    if (/(^|[\s_-])(dark|black|night)([\s_-]|$)/.test(normalized)) return 'dark';
    if (/(^|[\s_-])(light|white|day)([\s_-]|$)/.test(normalized)) return 'light';
    return null;
  }

  function relativeLuminance(red: number, green: number, blue: number): number {
    const [r, g, b] = [red, green, blue].map((channel) => {
      const value = channel / 255;
      return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function parseRgbColor(color: string): { red: number; green: number; blue: number; alpha: number } | null {
    const match = color.match(/^rgba?\((.+)\)$/);
    if (!match) return null;
    const parts = match[1].replace(/\//g, ' ').split(/[\s,]+/).map((part) => part.trim()).filter(Boolean);
    const [red, green, blue] = parts.slice(0, 3).map(Number);
    const alpha = parts[3] === undefined ? 1 : Number(parts[3]);
    if ([red, green, blue, alpha].some((part) => Number.isNaN(part))) return null;
    return { red, green, blue, alpha };
  }

  function themeFromBackgroundColor(color: string): DeepSeekTheme | null {
    const rgb = parseRgbColor(color);
    if (!rgb || rgb.alpha < 0.2) return null;
    return relativeLuminance(rgb.red, rgb.green, rgb.blue) < 0.45 ? 'dark' : 'light';
  }

  function detectBackgroundTheme(): DeepSeekTheme | null {
    const sampled = document.elementFromPoint(
      Math.max(0, Math.floor(window.innerWidth / 2)),
      Math.max(0, Math.min(Math.floor(window.innerHeight / 2), 240)),
    );
    const candidates = [sampled, document.querySelector('main'), document.getElementById('root'), document.body, document.documentElement]
      .filter((element): element is Element => Boolean(element));
    for (const candidate of candidates) {
      let element: Element | null = candidate;
      while (element && element !== document.documentElement.parentElement) {
        const theme = themeFromBackgroundColor(getComputedStyle(element).backgroundColor);
        if (theme) return theme;
        element = element.parentElement;
      }
    }
    return null;
  }

  function detectExplicitTheme(): DeepSeekTheme | null {
    const hosts = [document.documentElement, document.body, document.getElementById('root')]
      .filter((element): element is HTMLElement => Boolean(element));
    const attributeNames = ['data-theme', 'data-color-mode', 'data-mode', 'color-scheme'];
    for (const host of hosts) {
      for (const name of attributeNames) {
        const theme = parseThemeText(host.getAttribute(name));
        if (theme) return theme;
      }
      const themeFromClass = parseThemeText(typeof host.className === 'string' ? host.className : '');
      if (themeFromClass) return themeFromClass;
      const scheme = getComputedStyle(host).colorScheme.toLowerCase().trim();
      if (scheme === 'dark' || scheme === 'light') return scheme;
    }
    return null;
  }

  function detectHostTheme(): DeepSeekTheme {
    return config.detectExtraTheme?.() ??
      detectExplicitTheme() ??
      detectBackgroundTheme() ??
      (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  }

  function applyThemeClass(theme: DeepSeekTheme) {
    document.body.classList.toggle('dwplus-theme-dark', theme === 'dark');
    document.body.classList.toggle('dwplus-theme-light', theme === 'light');
  }

  function syncTheme() {
    const theme = detectHostTheme();
    applyThemeClass(theme);
    if (theme === currentTheme) return;
    currentTheme = theme;
    sendThemeMessage(theme);
  }

  function start(): void {
    syncTheme();
    themeObserver?.disconnect();
    themeObserver = new MutationObserver(scheduleThemeSync);
    observeThemeHost(document.documentElement);
    observeThemeHost(document.body);
    observeThemeHost(document.getElementById('root'));
    themeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    themeMediaListener = () => scheduleThemeSync();
    themeMediaQuery.addEventListener('change', themeMediaListener);
    startThemeBootstrapSync();
  }

  function stop(): void {
    themeObserver?.disconnect();
    themeObserver = null;
    stopThemeBootstrapSync();
    if (themeSyncTimer) { clearTimeout(themeSyncTimer); themeSyncTimer = null; }
    if (themeMediaQuery && themeMediaListener) {
      themeMediaQuery.removeEventListener('change', themeMediaListener);
    }
    themeMediaQuery = null;
    themeMediaListener = null;
  }

  return { start, stop };
}
```

**精简后的 doubao/theme-sync.ts**（替换全�?224 行）�?
```typescript
import { createThemeSync } from '../shared/theme-sync-core';

const themeSync = createThemeSync({
  messageType: 'SET_CLIENT_THEME',
  hostLabel: 'Doubao',
});

export function startDoubaoThemeSync(): void { themeSync.start(); }
export function stopDoubaoThemeSync(): void { themeSync.stop(); }
```

**精简后的 deepseek/theme-sync.ts**（替换全�?224 行）�?
```typescript
import { createThemeSync } from '../shared/theme-sync-core';

const themeSync = createThemeSync({
  messageType: 'SET_DEEPSEEK_THEME',
  hostLabel: 'DeepSeek',
});

export function startThemeSync(): void { themeSync.start(); }
export function stopThemeSync(): void { themeSync.stop(); }
```

**注意**：CSS class �?`dpp-theme-dark`/`dpp-theme-light` 改为 `dwplus-theme-dark`/`dwplus-theme-light`。同步影响：
- `core/ui/injected-theme.ts` L30, L52 �?`body.dpp-theme-dark` / `body:not(.dpp-theme-light)`
- `core/ui/skill-popup.ts` L215, L227 �?同上
- `core/ui/tool-result-renderer.ts` L756 �?`body.dpp-theme-dark .dpp-artifact-preview-panel-stage`
- `entrypoints/content.ts` L2415 �?`body.dpp-theme-dark .dpp-token-speed-badge`
- `tests/injected-theme.test.ts` L15, L17 �?测试断言
- `tests/tool-result-renderer.test.ts` L70 �?测试断言
- `tests/tool-block-style.test.ts` L34 �?测试断言

**验证**：`npm run compile && npm test`

**风险解决**：多宿主隔离泄漏——消�?224 行重复代码，CSS class 统一�?`dwplus-theme-*`�?
---

## 步骤 8：content.ts feature 加载审查

**现状**（探索已确认）：
- L465-467：`detectHost(window.location.href)` + `setActiveHostId(detectedHost.id)` �?宿主检测正�?- L585-600：按 `activeHostId === 'doubao'` 分支调用对应 feature，doubao �?`startDoubao*`，else �?`startDeepSeek*`
- L813：`getActiveFeatures(window.location.href).themeSync` 作为 feature gate

**结论**：feature 隔离逻辑已正确实现。本步骤主要�?*品牌替换**（`dpp-*` �?`dwplus-*`），不涉及逻辑改动�?
**需要品牌替换的 content.ts 位置**（通过 Grep 确认 100+ 处）�?
| 旧�?| 新�?| 涉及�?|
|------|------|--------|
| `dpp-tool-block` (ID + class) | `dwplus-tool-block` | L92, L961, L1010, L3325-3478 多处 |
| `dpp-tool-block-css` | `dwplus-tool-block-css` | L93 |
| `dpp-token-speed-badge` | `dwplus-token-speed-badge` | L191, L2375, L2393, L2415 |
| `dpp-token-speed-css` | `dwplus-token-speed-css` | L192 |
| `dpp-token-speed-anchor` (data attr) | `dwplus-token-speed-anchor` | L2354, L2370-2371, L2389 |
| `dpp-export-action` | `dwplus-export-action` | L193-196 |
| `dpp-export-action-css` | `dwplus-export-action-css` | L194 |
| `dpp-export-toast` | `dwplus-export-toast` | L195 |
| `dpp-export-menu` | `dwplus-export-menu` | L196, L1138-1157, L1462-1575 多处 |
| `dpp-export-pulse` (keyframes) | `dwplus-export-pulse` | L1438, L1575 |
| `dpp-pet-host` | `dwplus-pet-host` | L201 |
| `dpp-pet-css` | `dwplus-pet-css` | L202 |
| `dpp_tool_execution_blocks` (storage key) | `dwplus_tool_execution_blocks` | L208 |
| `dpp_inline_agent_traces` (storage key) | `dwplus_inline_agent_traces` | L209 |
| `dpp-agent-container` (class) | `dwplus-agent-container` | L961, L1010 |

**同步影响**（adapter 选择器）�?- `core/hosts/doubao/adapter.ts` L113-114 �?`#dpp-tool-block`, `[data-dpp-tool-block="true"]` �?`#dwplus-tool-block`, `[data-dwplus-tool-block="true"]`
- `core/hosts/deepseek/adapter.ts` L73-74 �?同上

**注意**：storage key 改名意味着已存储的用户数据会丢失。考虑是否需要迁移逻辑（读取旧 key 写入�?key）�?*决策**：beta 阶段不迁移，直接改名（用户数据可接受丢失）�?
**风险解决**：doubao 模式下不加载 deepseek 专属 CSS——已通过 `activeHostId` 分支实现，本步骤补齐品牌一致性�?
---

## 步骤 9：品牌替换（模块 1�?
### 9.1 版本�?`package.json` L5 `"version": "0.1.0"` �?`"0.1.0-beta.1"`

### 9.2 legacy adapter 品牌替换
`core/deepseek/adapter.ts` L23�?```typescript
export const BYPASS_HOOK_HEADER = 'X-DPP-Bypass-Hook';
```
�?```typescript
export const BYPASS_HOOK_HEADER = 'X-DWPLUS-Bypass-Hook';
```

**注意**：`entrypoints/main-world.content.ts` 已有 `DEPRECATED_*` 迁移模式。检�?`fetch-hook.ts` 是否也读�?`BYPASS_HOOK_HEADER` 常量（而非硬编码字符串），确保两处一致�?
### 9.3 CSS class 全局替换
已在步骤 7�? 中列出。统一�?`dwplus-` 前缀替换所�?`dpp-` 前缀�?CSS class / data attribute / storage key�?
### 9.4 README 重写
�?AGENTS.md `feedback_readme_style.md` 规则：只写功能特性，不暴�?API 端点和实现细节�?
重写要点�?- 标题：`doubao-wplus` �?`豆包 WPlus`（Doubao WPlus�?- 定位：多宿主 AI 增强插件，豆包为第一优先�?- 移除 deepseek-pp 仓库链接、旧 Chrome Web Store 链接
- 移除 `chat.deepseek.com` 作为唯一宿主的措辞，改为"支持豆包、DeepSeek 等多�?AI 宿主"
- 同步重写 `README_EN.md`
- 移除 `0.7.5 变更回顾` 等旧版本锚点

### 9.5 Release Notes 清理
- 删除 `docs/releases/` �?0.2.0-0.7.5 �?deepseek-pp 历史文档（保留为 archive，或直接删除�?- 新建 `docs/releases/0.1.0-beta.1.md` 记录本次重构

### 9.6 i18n 资源
检�?`core/i18n/resources/zh-CN.ts` �?`en.ts`，确�?`extension_name` / `extension_description` / `extension_action_title` 为豆�?WPlus 品牌文案�?
**风险解决**：品牌不一致——全局统一�?DWPLUS / 豆包 WPlus�?
---

## 步骤 10：CI/CD 门禁更新（模�?5�?
### 10.1 `scripts/manifest-policy-check.mjs`
- L70 `assert(webResources.includes('deepseek/*.wasm'), ...)` �?**保留**（`wxt.config.ts` L82 仍声�?`deepseek/*.wasm`，DeepSeek PoW 仍需要）
- L81-83 Pyodide 断言 �?**保留**（动�?import 仍打包资产，只是运行时按需加载�?- L114 `pyodideAssetsPlugin` �?**保留**

**结论**：此脚本基本无需改动，断言与当前架构对齐�?
### 10.2 `scripts/automation-contract-smoke.mjs`
- L18 `'core/deepseek/adapter.ts'` �?**保留**（legacy adapter 仍存在且被引用）
- L65 `assertContains('entrypoints/main-world.content.ts', 'DPP_BRIDGE_REQUEST')` �?改为 `assertContains('entrypoints/main-world.content.ts', 'DWPLUS_BRIDGE_REQUEST')`（main-world 已有新常量）
- L70 `assertContains('core/deepseek/adapter.ts', 'BYPASS_HOOK_HEADER')` �?**保留**（legacy 仍有此常量，只是值改了）
- L74 `deepseek-pp-shell-host` �?**保留**（npm 包名，不本轮 rename�?- L83 `assertNotContains('README.md', ['Agent', '任务'].join(' '))` �?**移除**（README 重写后措辞会变，此断言过时�?
**验证**：`npm run verify:automation` 通过�?
### 10.3 CI workflow 审查
读取 `.github/workflows/ci.yml` 确认 `ci:quality` 脚本步骤与当前模块状态对齐，�?Windows 路径兼容问题�?
**风险解决**：CI 门禁过时断言——对齐当前架构�?
---

## 步骤 11：Legacy adapter 评估（修正决策）

**重要修正**：原计划假设 `core/deepseek/adapter.ts` 是死代码可删除。实际探索发现它**仍被 3 处引�?*�?
| 引用位置 | 用�?|
|---------|------|
| `entrypoints/background.ts:175` | `submitPromptStreaming` 等自动化任务执行 |
| `entrypoints/content/features/deepseek/auth.ts:8` | DeepSeek 认证流程 |
| `tests/deepseek-adapter-stream.test.ts:2` | 流式响应单测 |

该文件提供：`submitPromptStreaming`、`BYPASS_HOOK_HEADER`、PoW 逻辑（`solvePowChallengeLocally`）、SSE 解析、历史快照。这�?**DeepSeek API 客户�?*（网络层），�?`core/hosts/deepseek/adapter.ts`（HostAdapter，DOM/feature 层）是不同关注点�?
**决策**�?1. **保留** `core/deepseek/adapter.ts`
2. **更新品牌**：L23 `BYPASS_HOOK_HEADER = 'X-DPP-Bypass-Hook'` �?`'X-DWPLUS-Bypass-Hook'`（步�?9.2 已覆盖）
3. **不做架构迁移**——legacy API 客户端与�?HostAdapter 各司其职，未来可考虑统一但不在本�?
**风险解决**：死代码误删风险——确认仍被引用，保留并更新品牌�?
---

## 步骤 12：最终全量验�?
```bash
# 编译
npm run compile

# 单测
npm test

# 三端构建
npm run build:all

# CI 门禁
npm run verify:manifest-policy
npm run verify:automation
npm run verify:extension-utf8
npm run smoke:mcp
npm run smoke:pow
npm run smoke:shell

# 品牌残留检查（应无结果或仅在历史文档中�?# Grep 搜索�?#   "deepseek-pp-mcp"  �?无结�?#   "X-DPP-"            �?无结�?#   "DPP_BRIDGE_REQUEST"（非 DEPRECATED_ 前缀）→ �?main-world.content.ts �?DEPRECATED_ 常量
#   "dpp-theme-"        �?无结�?#   "dpp-tool-block"    �?无结�?#   "deepseek-pp-shell"（非 npm 包名）→ �?packages/shell-host/package.json
```

---

## 执行顺序与验证节�?
| 步骤 | 改动 | 验证命令 |
|------|------|---------|
| 5 | 协议名迁移（5 文件�?| `npm run compile && npm test` |
| 6 | smoke:shell 退出码诊断修复 | `npm run smoke:shell` |
| 7 | theme-sync 工厂抽取 + CSS class 替换 | `npm run compile && npm test` |
| 8 | content.ts CSS class 品牌替换 | `npm run compile` |
| 9 | 版本�?+ README + legacy adapter 品牌 | `npm run compile` |
| 10 | CI 门禁断言更新 | `npm run verify:manifest-policy && npm run verify:automation` |
| 11 | Legacy adapter 确认保留（无代码改动�?| �?|
| 12 | 最终全量验�?| 全部 |

每步完成后立即跑 `npm run compile`（快速反馈），关键节点跑 `npm test`�?
---

## 不在本轮范围

- **豆包真实 DOM 选择器实�?* �?需用户�?doubao.com 装扩展验证，本轮只提�?detectSelectors 健康检查机�?- **豆包请求体字段名真机抓包验证** �?同上，本轮先假设�?DeepSeek 同名，真机验证后�?adapter 一�?- **npm 包名 rename（deepseek-pp-shell-host �?dwplus-shell-host�?* �?涉及 npm registry，需单独发布流程
- **Android WebView 适配** �?独立工作�?- **Chrome Web Store 重新上架** �?品牌变更后需重新提交审核，是发布阶段任务
- **legacy API 客户端与 HostAdapter 架构统一** �?未来重构方向，不在本�?
---

## Assumptions & Decisions

1. **步骤 6 重新诊断**：原 `exit` vs `close` 假设不成立（代码已用 `close`）。先�?smoke:shell 收集真实失败，再对症修复。最可能根因�?Windows PowerShell BOM �?PATH 大小写�?2. **步骤 11 保留 legacy adapter**：`core/deepseek/adapter.ts` 仍被 background.ts / auth.ts / 测试引用，是 DeepSeek API 客户端（非死代码）。保留并更新品牌�?3. **main-world.content.ts 迁移模式**：已�?`DEPRECATED_*` + 新常量双轨模式。其他品牌替换不采用此模式（直接替换），因为 CSS class / storage key 不需要向后兼容�?4. **storage key 改名**：`dpp_tool_execution_blocks` �?`dwplus_tool_execution_blocks` 等。beta 阶段不迁移旧数据，用户可接受丢失�?5. **`deepseek/*.wasm` 保留**：wxt.config.ts 仍声明此资源，DeepSeek PoW 仍需要。manifest-policy-check L70 断言保留�?6. **npm 包名 `deepseek-pp-shell-host` 保留**：不本轮 rename（涉�?npm registry）�?7. **a_bogus 策略**：已在步�?2 实现"Header 借用"�? 分钟 TTL），本轮不调整�?8. **TDD**：每步完成后立即�?`npm run compile`，关键节点跑 `npm test`�?