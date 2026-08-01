import { defineConfig, type ConfigEnv, type UserManifest } from 'wxt';
import tailwindcss from '@tailwindcss/vite';
import type { Plugin } from 'vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const rootDir = dirname(fileURLToPath(import.meta.url));
const safeWxtBrowser = resolve(rootDir, 'core/browser/safe-wxt-browser.ts');
const CHROMIUM_BROWSERS = new Set(['chrome', 'edge']);
const extensionVersion = readPackageVersion();
const MANIFEST_NAME = '__MSG_extension_name__';
const MANIFEST_DESCRIPTION = '__MSG_extension_description__';
const MANIFEST_ACTION_TITLE = '__MSG_extension_action_title__';
const SANDBOX_CSP = [
  'sandbox allow-scripts',
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob:",
  'worker-src blob:',
  "child-src 'self' blob: data:",
  "frame-src 'self' blob: data:",
  "connect-src 'self' blob:",
  "object-src 'none'",
].join('; ');
const PYODIDE_ASSET_FILES = [
  'pyodide.mjs',
  'pyodide.asm.mjs',
  'pyodide.asm.wasm',
  'python_stdlib.zip',
  'pyodide-lock.json',
];

function readPackageVersion(): string {
  const packageJson = JSON.parse(
    readFileSync(resolve(rootDir, 'package.json'), 'utf8'),
  ) as { version?: unknown };

  if (typeof packageJson.version !== 'string' || packageJson.version.length === 0) {
    throw new Error('package.json version is required for extension manifest');
  }

  return packageJson.version;
}

function createManifest(env: ConfigEnv): UserManifest {
  const isFirefox = env.browser === 'firefox';
  const isChromiumTarget = CHROMIUM_BROWSERS.has(env.browser);
  const permissions = ['storage', 'alarms', 'nativeMessaging', 'contextMenus'];
  // B-08: `downloads` 让扩展可以调用 `chrome.downloads.download` 把
  // DeepSeek 网页附件（ref_file_id）写入本机下载目录的 `doubao-wplus/` 子目录。
  // 仅 Chromium 暴露 chrome.downloads，Firefox 用 browser.downloads 走另一套 API，
  // 暂不在 firefox 启用 download_attached_file。
  const chromiumPermissions = [...permissions, 'offscreen', 'debugger', 'tabs', 'downloads'];

  return {
    default_locale: 'en',
    name: MANIFEST_NAME,
    description: MANIFEST_DESCRIPTION,
    version: extensionVersion,
    permissions: isChromiumTarget ? [...chromiumPermissions, 'sidePanel'] : permissions,
    optional_host_permissions: ['http://*/*', 'https://*/*'],
    host_permissions: [
      // 豆包网页主域（含 chat / bot / image / 桌面客户端 webview 等子域）
      '*://www.doubao.com/*',
      '*://*.doubao.com/*',
      // 豆包官方内置搜索 / 联网搜索后端（如需）
      'https://*.volces.com/*',
      // 保留 DeepSeek 通道作为可选宿主（用户可在设置里切换）
      '*://chat.deepseek.com/*',
      'https://api.deepseek.com/*',
      // 兼容老用户：Bing 搜索
      '*://cn.bing.com/*',
      '*://www.bing.com/*',
    ],
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
      sandbox: SANDBOX_CSP,
    },
    sandbox: {
      pages: ['sandbox-runner.html'],
    },
    web_accessible_resources: [{
      resources: ['pet/*.png', 'deepseek/*.wasm', 'doubao/*.wasm', 'speech-engine.js'],
      matches: ['*://www.doubao.com/*', '*://*.doubao.com/*', '*://chat.deepseek.com/*'],
    }],
    ...(isChromiumTarget ? {
      action: {
        default_title: MANIFEST_ACTION_TITLE,
      },
      side_panel: {
        default_path: 'sidepanel.html',
      },
    } : {}),
    ...(isFirefox ? {
      browser_specific_settings: {
        gecko: {
          id: 'doubao-wplus@local.dev',
          data_collection_permissions: {
            required: ['websiteContent', 'personalCommunications'],
          },
        },
      },
    } : {}),
  };
}

function asciiJavaScriptOutputPlugin(): Plugin {
  return {
    name: 'doubao-wplus-ascii-js-output',
    enforce: 'post',
    generateBundle(_, bundle) {
      for (const item of Object.values(bundle)) {
        if (item.type === 'chunk') {
          item.code = escapeNonAsciiJavaScript(item.code);
          continue;
        }

        if (!item.fileName.endsWith('.js')) continue;
        const source = typeof item.source === 'string'
          ? item.source
          : Buffer.from(item.source).toString('utf8');
        item.source = escapeNonAsciiJavaScript(source);
      }
    },
  };
}

function pyodideAssetsPlugin(): Plugin {
  return {
    name: 'doubao-wplus-pyodide-assets',
    apply: 'build',
    generateBundle() {
      const pyodideDir = resolve(rootDir, 'node_modules/pyodide');
      for (const file of PYODIDE_ASSET_FILES) {
        this.emitFile({
          type: 'asset',
          fileName: `pyodide/${file}`,
          source: readFileSync(resolve(pyodideDir, file)),
        });
      }
    },
  };
}

function escapeNonAsciiJavaScript(source: string): string {
  return source.replace(/[^\x00-\x7f]/gu, (char) => {
    const codePoint = char.codePointAt(0);
    if (codePoint === undefined) return char;
    return codePoint <= 0xffff
      ? `\\u${codePoint.toString(16).padStart(4, '0')}`
      : toSurrogatePairEscape(codePoint);
  });
}

function toSurrogatePairEscape(codePoint: number): string {
  const value = codePoint - 0x10000;
  const high = 0xd800 + (value >> 10);
  const low = 0xdc00 + (value & 0x3ff);
  return `\\u${high.toString(16).padStart(4, '0')}\\u${low.toString(16).padStart(4, '0')}`;
}

export default defineConfig({
  outDir: 'dist',
  targetBrowsers: ['chrome', 'edge', 'firefox'],
  modules: ['@wxt-dev/module-react'],
  manifest: createManifest,
  vite: (env) => {
    // E2E diagnostics gating: when DOUBAO_WPLUS_E2E=1, the runtime-marker writes
    // window.__DOUBAO_WPLUS_DIAGNOSTICS__ for Playwright tests to inspect.
    const e2eFlag = process.env.DOUBAO_WPLUS_E2E === '1' ? '1' : undefined;
    return {
      plugins: [tailwindcss(), pyodideAssetsPlugin(), asciiJavaScriptOutputPlugin()],
      resolve: {
        alias: {
          '@wxt-dev/browser': safeWxtBrowser,
          'wxt/browser': safeWxtBrowser,
        },
      },
      define: {
        // Vite statically replaces these at build time. Boolean/string types are required.
        __DOUBAO_WPLUS_E2E__: JSON.stringify(e2eFlag),
        __DOUBAO_WPLUS_DEV__: JSON.stringify(env.mode === 'development'),
      },
    };
  },
});
