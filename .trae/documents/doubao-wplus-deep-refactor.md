# doubao-wplus 深度重构计划（执行版�?
## Context

doubao-wplus �?deepseek-pp 迁移到多宿主架构的中间态重构。五大目标：品牌标准化、豆包适配层实质化、核�?bug 修复、多宿主健壮性、CI/CD 刷新�?
本计划基�?2026-07-12 实际代码探索，反映真实进度（非原始状态）�?
## 当前真实进度（代码事实）

### 已完�?�?- [core/hosts/types.ts](file:///d:/xjx/MCP/doubao-wplus/core/hosts/types.ts) �?接口已扩展：`RequestBodyFieldMapping`、`SelectorHealthReport`、`SelectorProbe`、`HostAdapter.detectSelectors()`、`HostAdapter.getRequestBodyFields()`、`HostFeatureFlags.hostSpecificCssInjection` 全部到位
- [core/hosts/doubao/adapter.ts](file:///d:/xjx/MCP/doubao-wplus/core/hosts/doubao/adapter.ts) �?完整实现新接口：`detectSelectors()` + `getRequestBodyFields()` + `CRITICAL_SELECTOR_KEYS` + 属性优先选择�?+ `DOUBAO_FEATURES.hostSpecificCssInjection: true`
- [core/hosts/registry.ts](file:///d:/xjx/MCP/doubao-wplus/core/hosts/registry.ts) �?注册表完好，默认 host �?doubao

### 关键阻塞 ❌（必须最先解决，否则 TypeScript 编译失败�?- [core/hosts/deepseek/adapter.ts](file:///d:/xjx/MCP/doubao-wplus/core/hosts/deepseek/adapter.ts) �?**仍是旧接�?*：缺�?`detectSelectors()` / `getRequestBodyFields()` 方法，`DEEPSEEK_FEATURES` 缺少 `hostSpecificCssInjection` 字段。由�?`DeepSeekAdapter implements HostAdapter` 且接口已更新，这会直接导�?`tsc --noEmit` 失败

### 待办清单（按模块分组�?
**模块 2 剩余**�?- [core/interceptor/header-borrowing.ts](file:///d:/xjx/MCP/doubao-wplus/core/interceptor/header-borrowing.ts) �?新建 Header 借用模块
- [core/interceptor/fetch-hook.ts](file:///d:/xjx/MCP/doubao-wplus/core/interceptor/fetch-hook.ts) �?L46 `X-DPP-Bypass-Hook`、L223-238 `captureDeepSeekClientHeaders`、L276 `[DPP]` 前缀、L144-171 hookFetch 接入借用机制
- [core/interceptor/request-augmentation.ts](file:///d:/xjx/MCP/doubao-wplus/core/interceptor/request-augmentation.ts) �?L49/L53/L54/L75/L76/L79 硬编�?DeepSeek 字段名，改用 `getActiveAdapter().getRequestBodyFields()`

**模块 3（核心修复）**�?- [core/mcp/transports/native.ts](file:///d:/xjx/MCP/doubao-wplus/core/mcp/transports/native.ts) �?L11/L155 `protocol: 'deepseek-pp-mcp-native'` �?`'dwplus-mcp-native'`
- [core/sandbox/python-worker.ts](file:///d:/xjx/MCP/doubao-wplus/core/sandbox/python-worker.ts) �?L1 静�?`import { loadPyodide }` �?动�?`import('pyodide')`
- [packages/shell-host/native/shell-mcp-host.mjs](file:///d:/xjx/MCP/doubao-wplus/packages/shell-host/native/shell-mcp-host.mjs) �?排查 shell_exec 退出码 bug（close vs exit 事件�?
**模块 4（多宿主健壮性）**�?- [entrypoints/content/features/shared/theme-sync-core.ts](file:///d:/xjx/MCP/doubao-wplus/entrypoints/content/features/shared/theme-sync-core.ts) �?新建公共模块（工厂模式）
- [entrypoints/content/features/doubao/theme-sync.ts](file:///d:/xjx/MCP/doubao-wplus/entrypoints/content/features/doubao/theme-sync.ts) �?精简为工厂调�?- [entrypoints/content/features/deepseek/theme-sync.ts](file:///d:/xjx/MCP/doubao-wplus/entrypoints/content/features/deepseek/theme-sync.ts) �?精简为工厂调�?- [entrypoints/content.ts](file:///d:/xjx/MCP/doubao-wplus/entrypoints/content.ts) �?审查 feature 加载逻辑，确�?doubao 模式不加�?deepseek 专属逻辑

**模块 1（品牌）**�?- [package.json](file:///d:/xjx/MCP/doubao-wplus/package.json) �?version `0.1.0` �?`0.1.0-beta.1`
- [README.md](file:///d:/xjx/MCP/doubao-wplus/README.md) �?重写，DeepSeek++ �?豆包 WPlus
- 全局替换：`[DPP]` �?`[DWPLUS]`、`X-DPP-Bypass-Hook` �?`X-DWPLUS-Bypass-Hook`、`DPP_BRIDGE_REQUEST` �?`DWPLUS_BRIDGE_REQUEST`、`dpp-theme-dark/light` �?`dwplus-theme-dark/light`、`dpp-tool-block` �?`dwplus-tool-block`、`dpp-token-speed-*` �?`dwplus-token-speed-*`、`dpp-export-*` �?`dwplus-export-*`、`dpp-pet-*` �?`dwplus-pet-*`
- [docs/releases/](file:///d:/xjx/MCP/doubao-wplus/docs/releases) �?清理 deepseek-pp 历史文档，新�?0.1.0-beta.1.md
- [core/i18n/resources/](file:///d:/xjx/MCP/doubao-wplus/core/i18n/resources) �?检�?extension_name 等键�?
**模块 5（CI/CD�?*�?- [scripts/manifest-policy-check.mjs](file:///d:/xjx/MCP/doubao-wplus/scripts/manifest-policy-check.mjs) �?L70 `deepseek/*.wasm` 断言、L81-83 Pyodide 断言
- [scripts/automation-contract-smoke.mjs](file:///d:/xjx/MCP/doubao-wplus/scripts/automation-contract-smoke.mjs) �?L18/L70 `core/deepseek/adapter.ts` 旧路径、L65 `DPP_BRIDGE_REQUEST`、L83 过时断言

**遗留清理**�?- [core/deepseek/adapter.ts](file:///d:/xjx/MCP/doubao-wplus/core/deepseek/adapter.ts) �?旧路径文件（�?PoW 逻辑、`BYPASS_HOOK_HEADER = 'X-DPP-Bypass-Hook'`），需评估是否被引用，若死代码则删�?
---

## 执行顺序（按依赖与风险排序）

1. **步骤 1**：修�?deepseek adapter（解阻塞编译）→ �?`npm run compile`
2. **步骤 2**：新�?header-borrowing.ts + �?fetch-hook.ts（Header 借用机制�?3. **步骤 3**：改 request-augmentation.ts（字段映射）
4. **步骤 4**：跑 `npm run compile && npm test` 验证模块 2
5. **步骤 5**：native.ts 协议�?+ python-worker.ts 动�?import（模�?3 核心�?6. **步骤 6**：shell-mcp-host.mjs 退出码 bug 排查修复
7. **步骤 7**：theme-sync-core.ts 工厂抽取 + 两份 theme-sync 精简（模�?4�?8. **步骤 8**：content.ts feature 加载审查 + CSS 隔离
9. **步骤 9**：品牌替换（模块 1，机械替换放后面避免干扰调试�?10. **步骤 10**：manifest-policy-check + automation-contract-smoke 更新（模�?5，对齐前面改动）
11. **步骤 11**：遗�?`core/deepseek/adapter.ts` 评估与清�?12. **步骤 12**：最终全量验�?
每步完成后立即跑 `npm run compile`（快速反馈），关键节点跑 `npm test`�?
---

## 步骤 1：修�?deepseek adapter（解阻塞编译�?
**目标**：让 `DeepSeekAdapter` 实现更新后的 `HostAdapter` 接口，解�?TypeScript 编译阻塞�?
**文件**：[core/hosts/deepseek/adapter.ts](file:///d:/xjx/MCP/doubao-wplus/core/hosts/deepseek/adapter.ts)

**改动**�?1. 更新 import 增加 `RequestBodyFieldMapping`、`SelectorHealthReport`、`SelectorProbe`
2. 新增 `CRITICAL_SELECTOR_KEYS` 常量
3. 实现 `getRequestBodyFields()` 方法（DeepSeek 字段名）
4. 实现 `detectSelectors()` 方法（同 doubao 模式�?5. `DEEPSEEK_FEATURES` 增加 `hostSpecificCssInjection: true`

**完整代码**（在类中新增的两个方法）�?
```typescript
import type {
  HostAdapter, HostFeatureFlags, HostPaths, HostSelectors, PageState,
  RequestBodyFieldMapping, SelectorHealthReport, SelectorProbe,
} from '../types';

const CRITICAL_SELECTOR_KEYS: Array<keyof HostSelectors> = [
  'inputBox', 'sendButton', 'messageList',
];

// �?DeepSeekAdapter 类中新增�?getRequestBodyFields(): RequestBodyFieldMapping {
  return {
    prompt: 'prompt',
    parentMessageId: 'parent_message_id',
    chatSessionId: 'chat_session_id',
    refFileIds: 'ref_file_ids',
    modelType: 'model_type',
    searchEnabled: 'search_enabled',
    thinkingEnabled: 'thinking_enabled',
  };
}

detectSelectors(doc: Document): SelectorHealthReport {
  const selectors = this.getSelectors();
  const probes: SelectorProbe[] = [];
  const missingCritical: string[] = [];

  for (const key of Object.keys(selectors) as Array<keyof HostSelectors>) {
    const candidates = selectors[key];
    let matchedSelector: string | null = null;
    let matchCount = 0;

    for (const candidate of candidates) {
      try {
        const elements = doc.querySelectorAll(candidate);
        if (elements.length > 0) {
          matchedSelector = candidate;
          matchCount = elements.length;
          break;
        }
      } catch {
        continue;
      }
    }

    probes.push({ key, found: matchCount > 0, matchedSelector, matchCount });
    if (matchCount === 0 && CRITICAL_SELECTOR_KEYS.includes(key)) {
      missingCritical.push(key);
    }
  }

  const healthy = missingCritical.length === 0;

  if (!healthy && typeof console !== 'undefined' && console.warn) {
    console.warn(
      `[DWPLUS] DeepSeek 选择器健康检查未通过，缺失关键元�? ${missingCritical.join(', ')}。` +
      `插件将降级为基础模式。页�? ${doc.location?.href ?? ''}`,
    );
  }

  return {
    hostId: this.id,
    timestamp: Date.now(),
    probes,
    healthy,
    missingCritical,
    pageUrl: doc.location?.href ?? '',
  };
}

// DEEPSEEK_FEATURES 更新�?const DEEPSEEK_FEATURES: HostFeatureFlags = {
  historyOrganizer: true,
  projectSidebarOrganizer: true,
  themeSync: true,
  hostSpecificCssInjection: true,
};
```

**验证**：`npm run compile` 应通过（至�?HostAdapter 接口实现完整）�?
**风险解决**：DeepSeek 宿主功能不因接口升级而编译失败�?
---

## 步骤 2：Header 借用拦截�?
**目标**：实�?a_bogus "Header 借用" 策略——拦截宿主原生请求提取签名头，缓存供插件构造的请求复用�?
**新增文件**：`core/interceptor/header-borrowing.ts`

```typescript
// core/interceptor/header-borrowing.ts
// 多宿主请求签名借用机制
// 策略：拦截宿主原生请求提�?X-Bogus / a_bogus / msToken / Cookie / Authorization�?//       缓存供插件构造的请求复用。签名有时效性，过期后降级为透传模式�?// 不逆向签名算法，只复用宿主已生成的有效头�?
import type { HostId } from '../hosts/types';

interface BorrowedHeaders {
  'X-Bogus'?: string;
  'a_bogus'?: string;
  'msToken'?: string;
  'Cookie'?: string;
  'User-Agent'?: string;
  'Authorization'?: string;
  'X-App-Version'?: string;
  'x-client-platform'?: string;
  'x-client-version'?: string;
  'x-client-locale'?: string;
  'x-client-timezone-offset'?: string;
  capturedAt: number;
  sourceUrl: string;
}

interface BorrowingPolicy {
  /** 缓存有效期（毫秒�?*/
  maxAgeMs: number;
  /** 哪些 header 需要借用 */
  borrowedHeaderNames: readonly string[];
}

const DEFAULT_POLICIES: Record<HostId, BorrowingPolicy> = {
  doubao: {
    maxAgeMs: 3 * 60 * 1000,
    borrowedHeaderNames: ['X-Bogus', 'a_bogus', 'msToken', 'Cookie', 'User-Agent'],
  },
  deepseek: {
    maxAgeMs: 5 * 60 * 1000,
    borrowedHeaderNames: ['Authorization', 'X-App-Version', 'x-client-platform', 'x-client-version', 'x-client-locale', 'x-client-timezone-offset'],
  },
};

const cache = new Map<HostId, BorrowedHeaders>();

/**
 * 从拦截到的请求头中提取并缓存宿主签名�? * �?fetch-hook 拦截到宿主原生请求时调用�? */
export function captureBorrowableHeaders(
  hostId: HostId,
  url: string,
  headers: Record<string, string>,
): void {
  const policy = DEFAULT_POLICIES[hostId];
  if (!policy) return;

  const borrowed: Partial<BorrowedHeaders> = {};
  let captured = false;

  for (const name of policy.borrowedHeaderNames) {
    const value = findHeaderCaseInsensitive(headers, name);
    if (value) {
      (borrowed as Record<string, string>)[name] = value;
      captured = true;
    }
  }

  if (captured) {
    cache.set(hostId, {
      ...(borrowed as BorrowedHeaders),
      capturedAt: Date.now(),
      sourceUrl: url,
    });
  }
}

/**
 * 获取借用的请求头。缓存过期或不存在时返回 null�? * 调用方（fetch-hook）应在构造修改过的请求时把借用头合并到 init.headers�? */
export function getBorrowedHeaders(hostId: HostId): Record<string, string> | null {
  const policy = DEFAULT_POLICIES[hostId];
  if (!policy) return null;

  const entry = cache.get(hostId);
  if (!entry) return null;

  const age = Date.now() - entry.capturedAt;
  if (age > policy.maxAgeMs) {
    cache.delete(hostId);
    return null;
  }

  const result: Record<string, string> = {};
  for (const name of policy.borrowedHeaderNames) {
    const value = (entry as Record<string, unknown>)[name];
    if (typeof value === 'string' && value.length > 0) {
      result[name] = value;
    }
  }
  return Object.keys(result).length > 0 ? result : null;
}

/** 清除指定宿主的缓存（用于宿主切换或登出） */
export function invalidateBorrowedHeaders(hostId: HostId): void {
  cache.delete(hostId);
}

function findHeaderCaseInsensitive(
  headers: Record<string, string>,
  target: string,
): string | undefined {
  const targetLower = target.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === targetLower) {
      return headers[key];
    }
  }
  return undefined;
}
```

**修改文件**：[core/interceptor/fetch-hook.ts](file:///d:/xjx/MCP/doubao-wplus/core/interceptor/fetch-hook.ts)

改动点：
1. L46 `BYPASS_HOOK_HEADER = 'X-DPP-Bypass-Hook'` �?`'X-DWPLUS-Bypass-Hook'`
2. L276 `[DPP]` �?`[DWPLUS]`
3. L284 同上
4. import `captureBorrowableHeaders` / `getBorrowedHeaders`
5. `hookFetch` 中对所有命中宿主的请求捕获 header，对修改过的请求合并借用�?
**hookFetch 改动**（L141-171）：

```typescript
import { captureBorrowableHeaders, getBorrowedHeaders } from './header-borrowing';
import { getActiveAdapter } from '../hosts/registry';

function hookFetch() {
  originalFetch = window.fetch;

  window.fetch = async function (input: RequestInfo | URL, init?: RequestInit) {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const adapter = getActiveAdapter(url);
    const hostId = adapter.id;

    // 捕获所有命中宿主的请求头（不只�?chat stream�?    if (init?.headers) {
      const headers = headersInitToRecord(init.headers);
      if (headers) captureBorrowableHeaders(hostId, url, headers);
    }

    if (matchesHistoryURL(url)) {
      return interceptHistoryResponse(originalFetch.call(this, input, init));
    }

    if (!isChatStreamURL(url) || typeof init?.body !== 'string') {
      return originalFetch.call(this, input, init);
    }

    if (hasBypassHookHeader(init.headers)) {
      return originalFetch.call(this, input, { ...init, headers: stripBypassHookHeader(init.headers) });
    }

    await waitForInitialHookState();
    hookState.onHeadersCaptured(captureDeepSeekClientHeaders(init.headers));
    const originalContext = createRequestContext(init.body);
    const modified = await hookState.onRequestBody(init.body);
    const requestBody = modified?.body ?? init.body;
    const requestContext = createRequestContext(requestBody, {
      requestId: originalContext.requestId,
      originalPrompt: originalContext.originalPrompt,
      agentTaskPrompt: modified?.agentTaskPrompt ?? originalContext.agentTaskPrompt,
    });

    let requestInit = modified ? { ...init, body: modified.body } : init;

    // 对修改过的请求合并借用头（豆包 a_bogus 等签名复用）
    if (modified) {
      const borrowed = getBorrowedHeaders(hostId);
      if (borrowed) {
        const mergedHeaders = mergeHeaders(init.headers, borrowed);
        requestInit = { ...requestInit, headers: mergedHeaders };
      }
    }

    return interceptFetchResponse(originalFetch.call(this, input, requestInit), requestContext);
  };
}

function headersInitToRecord(headersInit: HeadersInit): Record<string, string> | null {
  try {
    if (headersInit instanceof Headers) {
      const result: Record<string, string> = {};
      headersInit.forEach((value, key) => { result[key] = value; });
      return result;
    }
    if (Array.isArray(headersInit)) {
      return Object.fromEntries(headersInit);
    }
    return headersInit as Record<string, string>;
  } catch {
    return null;
  }
}

function mergeHeaders(original: HeadersInit | undefined, borrowed: Record<string, string>): HeadersInit {
  const base = headersInitToRecord(original) ?? {};
  return { ...base, ...borrowed };
}
```

**风险解决**：a_bogus 缺失——不逆向算法，复用宿主签名（3 分钟 TTL）�?
---

## 步骤 3：请求体字段映射

**目标**：把 request-augmentation.ts 中硬编码�?DeepSeek 字段名改为通过 adapter 读取�?
**文件**：[core/interceptor/request-augmentation.ts](file:///d:/xjx/MCP/doubao-wplus/core/interceptor/request-augmentation.ts)

**改动**�?- import `getActiveAdapter` from `../hosts/registry`
- `augmentRequestBody` 函数内，把直接访�?`body.prompt` / `body.parent_message_id` / `body.chat_session_id` / `body.ref_file_ids` / `body.model_type` / `body.thinking_enabled` 改为通过 `fields.xxx` 间接访问

```typescript
import { getActiveAdapter } from '../hosts/registry';

export function augmentRequestBody(
  bodyStr: string,
  state: RequestAugmentationState,
): RequestBodyAugmentationResult | null {
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(bodyStr);
  } catch {
    return null;
  }

  const fields = getActiveAdapter().getRequestBodyFields();
  const originalPrompt = (body[fields.prompt] as string) || '';
  if (!originalPrompt) return null;
  const locale = state.locale ?? DEFAULT_LOCALE;

  const thinkingEnabled = body[fields.thinkingEnabled] === true;
  const parentMessageId = body[fields.parentMessageId];
  const isFirstMessage = parentMessageId === null || parentMessageId === undefined;
  // ... 后续逻辑中所�?body.xxx 改为 body[fields.xxx] ...

  const hasUserFileAttachments = Array.isArray(body[fields.refFileIds]) && (body[fields.refFileIds] as unknown[]).length > 0;
  const userSelectedModel = typeof body[fields.modelType] === 'string' && (body[fields.modelType] as string).length > 0;
  if (hasUserFileAttachments) {
    body[fields.modelType] = 'vision';
  } else if (state.modelType && !userSelectedModel) {
    body[fields.modelType] = state.modelType;
  }

  // ... buildPromptAugmentation 调用不变 ...
  body[fields.prompt] = augmented;
  // ...
}
```

**风险解决**：豆包字段名假设——真机验证后只需�?adapter 一处�?
---

## 步骤 4：模�?2 验证

```bash
npm run compile
npm test
```

预期：编译通过，现有测试全绿（新接口已实现，旧调用已切换）�?
---

## 步骤 5：native.ts 协议�?+ Pyodide 动�?import

**文件 1**：[core/mcp/transports/native.ts](file:///d:/xjx/MCP/doubao-wplus/core/mcp/transports/native.ts)

L11 `protocol: 'deepseek-pp-mcp-native'` �?`'dwplus-mcp-native'`
L155 同上

同步检�?`core/mcp/transports/bridge.ts` �?`packages/shell-host/native/shell-mcp-host.mjs` 中对协议名的引用，一并更新�?
**文件 2**：[core/sandbox/python-worker.ts](file:///d:/xjx/MCP/doubao-wplus/core/sandbox/python-worker.ts)

L1 静�?import 改为动�?import + 类型获取�?
```typescript
// 删除 L1: import { loadPyodide } from 'pyodide';
// 改为�?type PyodideRuntime = Awaited<ReturnType<typeof import('pyodide')['loadPyodide']>>;
type PyodideModule = typeof import('pyodide');

let pyodideModulePromise: Promise<PyodideModule> | null = null;
let pyodidePromise: Promise<PyodideRuntime> | null = null;

function getPyodideModule(): Promise<PyodideModule> {
  if (!pyodideModulePromise) {
    pyodideModulePromise = import('pyodide');
  }
  return pyodideModulePromise;
}

async function getPyodide(pyodideBaseUrl: string): Promise<PyodideRuntime> {
  if (!pyodidePromise) {
    const mod = await getPyodideModule();
    pyodidePromise = mod.loadPyodide({
      indexURL: pyodideBaseUrl,
      packageBaseUrl: pyodideBaseUrl,
    });
  }
  return pyodidePromise;
}
```

**风险解决**：Pyodide 72MB 臃肿——动�?import �?vite �?code splitting，首屏不加载�?
---

## 步骤 6：Shell MCP 退出码 bug

**文件**：[packages/shell-host/native/shell-mcp-host.mjs](file:///d:/xjx/MCP/doubao-wplus/packages/shell-host/native/shell-mcp-host.mjs)

**排查策略**：先读取 shell_exec 工具实现，确认是 `exit` 事件 vs `close` 事件时序问题�?
**修复模式**（待读取确认后应用）�?
```javascript
// 关键：必须等 'close'（所有流关闭后）而不�?'exit'（进程退出但流可能还有数据）
child.on('close', (code, signal) => {
  exitCode = code ?? (signal ? -1 : 0);
  // Windows PowerShell UTF-8 BOM 清理
  if (process.platform === 'win32' && stdout.charCodeAt(0) === 0xFEFF) {
    stdout = stdout.slice(1);
  }
  resolve({ stdout, stderr, exitCode });
});
```

**验证**：`npm run smoke:shell` 应从 7 passed / 4 failed 提升到全绿�?
---

## 步骤 7：theme-sync 工厂抽取

**目标**：消�?doubao/deepseek 两份 theme-sync �?99% 重复代码�?
**新增文件**：`entrypoints/content/features/shared/theme-sync-core.ts`

```typescript
import type { DeepSeekTheme } from '../../../../core/types';

export interface ThemeSyncConfig {
  messageType: string;
  hostLabel: string;
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
    } catch { /* extension context invalidated */ }
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

  function parseRgbColor(color: string) {
    const match = color.match(/^rgba?\((.+)\)$/);
    if (!match) return null;
    const parts = match[1].replace(/\//g, ' ').split(/[\s,]+/).map((p) => p.trim()).filter(Boolean);
    const [red, green, blue] = parts.slice(0, 3).map(Number);
    const alpha = parts[3] === undefined ? 1 : Number(parts[3]);
    if ([red, green, blue, alpha].some(Number.isNaN)) return null;
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
      .filter((e): e is Element => Boolean(e));
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
      .filter((e): e is HTMLElement => Boolean(e));
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

**精简后的 doubao/theme-sync.ts**�?
```typescript
import { createThemeSync } from '../shared/theme-sync-core';

const themeSync = createThemeSync({
  messageType: 'SET_CLIENT_THEME',
  hostLabel: 'Doubao',
});

export function startDoubaoThemeSync(): void { themeSync.start(); }
export function stopDoubaoThemeSync(): void { themeSync.stop(); }
```

**精简后的 deepseek/theme-sync.ts**�?
```typescript
import { createThemeSync } from '../shared/theme-sync-core';

const themeSync = createThemeSync({
  messageType: 'SET_DEEPSEEK_THEME',
  hostLabel: 'DeepSeek',
});

export function startThemeSync(): void { themeSync.start(); }
export function stopThemeSync(): void { themeSync.stop(); }
```

**风险解决**：多宿主隔离泄漏——消除重复代码，CSS class 统一�?`dwplus-theme-*`�?
---

## 步骤 8：content.ts feature 加载审查

**文件**：[entrypoints/content.ts](file:///d:/xjx/MCP/doubao-wplus/entrypoints/content.ts)

审查 L74-82 �?feature 加载逻辑，确保：
- doubao 模式下只调用 `startDoubaoThemeSync` / `startDoubaoHistoryOrganizer` / `startDoubaoProjectSidebarOrganizer`
- deepseek 模式下只调用 `startThemeSync` / `startDeepSeekHistoryOrganizer` / `startDeepSeekProjectSidebarOrganizer`
- 通过 `getActiveFeatures()` 判断是否启用某个 feature，不硬编�?host id

如果当前 content.ts 已经通过 `detectHost(url)` + `setActiveHostId` 切换宿主并按宿主调用对应 feature，则只需确认逻辑正确。如果存在混用（�?doubao 模式下仍调用 deepseek theme-sync），需修正�?
**风险解决**：doubao 模式下不加载 deepseek 专属 CSS/逻辑�?
---

## 步骤 9：品牌替换（模块 1，机械替换）

### 9.1 版本�?[package.json](file:///d:/xjx/MCP/doubao-wplus/package.json) L5 `"version": "0.1.0"` �?`"0.1.0-beta.1"`

### 9.2 全局标识符替�?
以下替换需同步跨文件（每处确认上下文）�?
| 旧�?| 新�?| 涉及文件 |
|------|------|---------|
| `X-DPP-Bypass-Hook` | `X-DWPLUS-Bypass-Hook` | fetch-hook.ts, core/deepseek/adapter.ts(legacy), entrypoints/main-world.content.ts |
| `[DPP]` | `[DWPLUS]` | fetch-hook.ts |
| `DPP_BRIDGE_REQUEST` | `DWPLUS_BRIDGE_REQUEST` | entrypoints/main-world.content.ts, automation-contract-smoke.mjs |
| `dpp-theme-dark` | `dwplus-theme-dark` | theme-sync-core.ts(新建), 所�?CSS |
| `dpp-theme-light` | `dwplus-theme-light` | 同上 |
| `dpp-tool-block` | `dwplus-tool-block` | content.ts L92, 相关 CSS |
| `dpp-tool-block-css` | `dwplus-tool-block-css` | content.ts L93 |
| `dpp-token-speed-badge` | `dwplus-token-speed-badge` | content.ts L191 |
| `dpp-token-speed-css` | `dwplus-token-speed-css` | content.ts L192 |
| `dpp-export-action` | `dwplus-export-action` | content.ts L193 �?|
| `dpp-pet-host` | `dwplus-pet-host` | content.ts L201 |
| `dpp_tool_execution_blocks` | `dwplus_tool_execution_blocks` | content.ts L208 |
| `dpp_inline_agent_traces` | `dwplus_inline_agent_traces` | content.ts L209 |
| `deepseek-pp-mcp-native` | `dwplus-mcp-native` | native.ts（步�?5 已改）|

### 9.3 README 重写
�?AGENTS.md `feedback_readme_style.md` 规则：只写功能特性，不暴�?API 端点和实现细节�?
- 标题：DeepSeek++ �?豆包 WPlus（Doubao WPlus�?- 定位：多宿主 AI 增强插件，豆包为第一优先�?- 移除 deepseek-pp 仓库链接、旧 Chrome Web Store 链接
- 同步重写 README_EN.md

### 9.4 Release Notes 清理
- 删除 `docs/releases/` �?0.2.0-0.7.5 �?deepseek-pp 历史文档
- 新建 `docs/releases/0.1.0-beta.1.md` 记录本次重构

### 9.5 i18n 资源
检�?`core/i18n/resources/zh-CN.ts` �?`en.ts`，确�?`extension_name` / `extension_description` / `extension_action_title` 为豆�?WPlus 品牌文案�?
**风险解决**：品牌不一致——全局统一�?DWPLUS�?
---

## 步骤 10：CI/CD 门禁更新（模�?5�?
### 10.1 manifest-policy-check.mjs

[scripts/manifest-policy-check.mjs](file:///d:/xjx/MCP/doubao-wplus/scripts/manifest-policy-check.mjs)�?- L70 `assert(webResources.includes('deepseek/*.wasm'), ...)` �?移除或改为条件断言（仅 deepseek 宿主启用 PoW 时才检查）。豆包不�?PoW，应移除�?- L81-83 Pyodide 断言保留（步�?5 的动�?import 方案仍需打包资产，只是运行时按需加载�?- 确认 L114 `pyodideAssetsPlugin` 断言保留

### 10.2 automation-contract-smoke.mjs

[scripts/automation-contract-smoke.mjs](file:///d:/xjx/MCP/doubao-wplus/scripts/automation-contract-smoke.mjs)�?- L18 `'core/deepseek/adapter.ts'` �?`'core/hosts/deepseek/adapter.ts'`
- L65 `DPP_BRIDGE_REQUEST` �?`DWPLUS_BRIDGE_REQUEST`（同步步�?9.2�?- L70 `assertContains('core/deepseek/adapter.ts', 'BYPASS_HOOK_HEADER')` �?`assertContains('core/interceptor/fetch-hook.ts', 'BYPASS_HOOK_HEADER')`
- L83 `assertNotContains('README.md', ['Agent', '任务'].join(' '))` �?移除过时断言
- L74 `deepseek-pp-shell-host` �?保留（npm 包名是公开标识，需单独发布流程 rename�?
### 10.3 CI workflow 审查
读取 `.github/workflows/ci.yml` 确认 `ci:quality` 脚本步骤与当前模块状态对齐，�?Windows 路径兼容问题�?
**风险解决**：CI 门禁过时断言——对齐当前架构�?
---

## 步骤 11：遗�?core/deepseek/adapter.ts 评估

**文件**：[core/deepseek/adapter.ts](file:///d:/xjx/MCP/doubao-wplus/core/deepseek/adapter.ts)（旧路径�?
**评估**�?1. Grep 全项�?`from '../deepseek/adapter'` / `from '../../deepseek/adapter'` / `from './deepseek/adapter'` 确认是否仍被引用
2. 如果仅被 `automation-contract-smoke.mjs`（已改）引用，且无其他代码引�?�?删除文件
3. 如果仍被引用（如 PoW 逻辑）→ 保留但标�?deprecated，后续迁�?
**注意**：该文件 L23 `BYPASS_HOOK_HEADER = 'X-DPP-Bypass-Hook'` 是旧定义，与 fetch-hook.ts L46 重复。如�?fetch-hook.ts 已自�?`BYPASS_HOOK_HEADER` 常量，旧文件的可能已无实际作用�?
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

# 品牌残留检查（应无结果或仅在历史文档中�?# �?Grep 工具搜索�?#   "doubao-wplus"  �?仅历�?release notes（如保留）或无结�?#   "X-DPP-"       �?无结�?#   "DPP_BRIDGE"   �?无结�?#   "dpp-theme-"   �?无结�?#   "dpp-tool-block" �?无结�?#   "deepseek-pp-mcp" �?无结�?```

---

## 不在本轮范围

- **豆包真实 DOM 选择器实�?* —�?需用户�?doubao.com 装扩展验证，本轮只提�?detectSelectors 健康检查机�?- **豆包请求体字段名真机抓包验证** —�?同上，本轮先假设�?DeepSeek 同名，真机验证后�?adapter 一�?- **npm 包名 rename（deepseek-pp-shell-host �?dwplus-shell-host�?* —�?涉及 npm registry，需单独发布流程
- **Android WebView 适配** —�?独立工作�?- **Chrome Web Store 重新上架** —�?品牌变更后需重新提交审核，是发布阶段任务

---

## Assumptions & Decisions

1. **a_bogus 策略**：采�?Header 借用"而非逆向算法�? 分钟 TTL 保守取值，真机验证后可调整�?2. **豆包字段�?*：暂假设�?DeepSeek 同名（`prompt` / `parent_message_id` 等），真机抓包后�?adapter 一处即可�?3. **Pyodide 打包**：采用动�?import 方案（方�?A），仍打包资产但运行时按需加载。不采用 CDN 方案（违反本地优先原则）�?4. **品牌前缀**：`DWPLUS` 作为统一前缀（日志、header、CSS class、storage key）�?5. **npm 包名**：`deepseek-pp-shell-host` 保留，不本轮 rename（涉�?npm registry）�?6. **�?`core/deepseek/adapter.ts`**：先评估引用，死代码则删除�?7. **declarativeNetRequest**：不新增（当前架构用 fetch-hook 拦截，加 DNR 会增加权限负担）�?8. **TDD**：每步完成后立即�?`npm run compile`，关键节点跑 `npm test`�?