// tests/e2e/fixtures/extension.ts
// 扩展加载 fixture — 为每个 spec 创建一个启用了 doubao-wplus 的 Chromium context
//
// 关键约束：
//   - MV3 扩展通过 `chromium.launchPersistentContext` + `--load-extension=<dist>`
//     注入；Playwright 官方推荐这种方式。
//   - 扩展 ID 在每次启动可能不同；不依赖固定 ID。
//   - 由于 WXT 在 production 模式下 diagnostics marker 不写入 window，
//     我们的 smoke tests 需要扩展以 dev/test 模式构建 —— 建议在 CI 中：
//       `wxt build --mode development` 或显式设置 `MODE=e2e`。
//   - 本 fixture 提供 diagnostics marker 探测能力：`getDiagnostics(page)`。

import { test as base, type BrowserContext, type Page } from '@playwright/test';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..', '..', '..');
const EXTENSION_BUILD_DIR = resolve(ROOT, 'dist', 'chrome-mv3');
const TEST_USER_DATA_DIR = (): string =>
  mkdtempSync(join(tmpdir(), 'doubao-wplus-e2e-'));

/** 确保扩展构建产物存在（不重新构建以避免污染测试运行） */
function ensureExtensionBuilt(): void {
  if (!existsSync(EXTENSION_BUILD_DIR)) {
    throw new Error(
      `Extension build not found at ${EXTENSION_BUILD_DIR}. ` +
        `Run \`npm run build:chrome\` before E2E.`,
    );
  }
  if (!statSync(EXTENSION_BUILD_DIR).isDirectory()) {
    throw new Error(`Extension build path is not a directory: ${EXTENSION_BUILD_DIR}`);
  }
}

/** 通过 MV3 启动参数加载扩展 */
function buildLaunchArgs(extensionPath: string): string[] {
  return [
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
    '--no-first-run',
    '--no-default-browser-check',
    // 避免 headless 下扩展初始化在加载之前完成
    '--disable-background-timer-throttling',
    '--disable-features=IsolateOrigins,site-per-process,TranslateUI',
  ];
}

export type ExtensionFixtures = {
  context: BrowserContext;
  extensionId: string | null;
  getDiagnostics: (page: Page) => Promise<RuntimeDiagnostics | null>;
  cleanup: () => void;
};

export interface RuntimeDiagnostics {
  version: string;
  activeHostId: string;
  features: {
    historyOrganizer: boolean;
    projectSidebarOrganizer: boolean;
  };
  contentReady: boolean;
  mainWorldReady: boolean;
  bridgeId: string | null;
}

/**
 * 通过 service worker URL 解析扩展 ID。
 * MV3 中，所有扩展都注册一个 service worker，URL 形如
 *   chrome-extension://<id>/background.js
 * 我们启动一个空白页，等待 service worker 出现，然后解析其 URL。
 *
 * 实现：先用 context.on('serviceworker') 订阅，后续 page.goto 真实 URL 时 SW 会自动注册。
 * fallback：轮询 context.serviceWorkers() 和 context.backgroundPages()。
 */
async function resolveExtensionId(context: BrowserContext): Promise<string | null> {
  // 订阅 SW 注册事件
  const collected: string[] = [];
  const onSW = (sw: import('@playwright/test').Worker): void => {
    const match = sw.url().match(/^chrome-extension:\/\/([^/]+)\//);
    if (match && match[1] && !collected.includes(match[1])) {
      collected.push(match[1]);
    }
  };
  context.on('serviceworker', onSW);

  try {
    // 主动轮询 serviceWorkers() 和 backgroundPages()（当前已可见的）
    for (let i = 0; i < 30; i++) {
      const workers = context.serviceWorkers();
      for (const sw of workers) {
        const match = sw.url().match(/^chrome-extension:\/\/([^/]+)\//);
        if (match && match[1] && !collected.includes(match[1])) {
          collected.push(match[1]);
        }
      }
      if (collected.length > 0) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    return collected[0] ?? null;
  } finally {
    context.off('serviceworker', onSW);
  }
}

export const test = base.extend<ExtensionFixtures>({
  context: async ({ playwright }, use) => {
    ensureExtensionBuilt();
    const userDataDir = TEST_USER_DATA_DIR();
    const context = await playwright.chromium.launchPersistentContext(userDataDir, {
      headless: true,
      args: buildLaunchArgs(EXTENSION_BUILD_DIR),
      // 不要接受 download / notifications 等弹窗
      acceptDownloads: false,
    });

    // 调试输出：context 创建后立刻检查
    // eslint-disable-next-line no-console
    console.log('[fixture-debug] context created, waiting for SW...');
    for (let i = 0; i < 50; i++) {
      const sws = context.serviceWorkers().map((sw) => sw.url());
      const bgs = context.backgroundPages().map((p) => p.url());
      if (sws.length > 0 || bgs.length > 0) {
        // eslint-disable-next-line no-console
        console.log(`[fixture-debug] at ${i * 200}ms: SWs=${JSON.stringify(sws)} BGs=${JSON.stringify(bgs)}`);
        break;
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    const finalSw = context.serviceWorkers().map((sw) => sw.url());
    // eslint-disable-next-line no-console
    console.log('[fixture-debug] final SWs:', finalSw);

    await use(context);
    await context.close();
    try {
      rmSync(userDataDir, { recursive: true, force: true });
    } catch {
      // best effort
    }
  },

  extensionId: async ({ context }, use) => {
    // 启动后给一点时间让扩展 background 注册
    const id = await resolveExtensionId(context);
    await use(id);
  },

  getDiagnostics: async ({}, use) => {
    const fn = async (page: Page): Promise<RuntimeDiagnostics | null> => {
      return await page.evaluate(() => {
        const w = window as unknown as Record<string, unknown>;
        const diag = w.__DOUBAO_WPLUS_DIAGNOSTICS__ as RuntimeDiagnostics | undefined;
        return diag ?? null;
      });
    };
    await use(fn);
  },

  cleanup: async ({}, use) => {
    // 占位 fixture：方便 spec 在 afterEach 调用（已由 context 自动清理 user-data-dir）
    await use(() => undefined);
  },
});

/** 检测当前构建是否启用 diagnostics marker（供 spec 跳过使用） */
export function isDiagnosticsMarkerExpected(): boolean {
  // build-e2e.mjs 设置 DOUBAO_WPLUS_E2E=1；旧文档用 DOUBAO_WPLUS_E2E_MARKER=on。
  // 两者任一成立即认为 E2E 诊断 marker 已写入 dist。
  return process.env.DOUBAO_WPLUS_E2E_MARKER === 'on' || process.env.DOUBAO_WPLUS_E2E === '1';
}

/** 触发一次重新构建并以 E2E 模式输出（仅供本地调试使用） */
export function rebuildExtensionForE2E(): void {
  // eslint-disable-next-line no-console
  console.log('[E2E] Rebuilding extension with DOUBAO_WPLUS_E2E=1 for diagnostics marker...');
  execSync('npx wxt build --browser chrome', {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, DOUBAO_WPLUS_E2E: '1' },
  });
}

export { expect } from '@playwright/test';
