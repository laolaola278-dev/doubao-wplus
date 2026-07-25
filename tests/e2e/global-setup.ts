// tests/e2e/global-setup.ts
// Playwright globalSetup: 启动时断言扩展 build 存在。
// 独立到独立文件是为了让 Playwright 能以 ESM 形式加载。
//
// 用法（playwright.config.ts）：
//   globalSetup: resolve(__dirname, 'tests/e2e/global-setup.ts')

import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..', '..');
const EXTENSION_BUILD_DIR = resolve(ROOT, 'dist', 'chrome-mv3');

export default async function globalSetup(): Promise<void> {
  if (!existsSync(EXTENSION_BUILD_DIR)) {
    throw new Error(
      `Extension build not found at ${EXTENSION_BUILD_DIR}. ` +
        `Run \`npm run build:chrome\` (or \`npm run test:e2e\` which builds automatically) ` +
        `before running E2E tests.`,
    );
  }
  const manifestPath = resolve(EXTENSION_BUILD_DIR, 'manifest.json');
  if (!existsSync(manifestPath)) {
    throw new Error(
      `manifest.json not found at ${manifestPath}. ` +
        `The build directory exists but does not contain manifest.json.`,
    );
  }
  console.log(`[e2e global-setup] Extension build verified at ${EXTENSION_BUILD_DIR}`);
}
