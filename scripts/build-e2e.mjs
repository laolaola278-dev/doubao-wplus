#!/usr/bin/env node
// scripts/build-e2e.mjs
//
// E2E build wrapper: 在 Windows / POSIX 都可移植地设置 DOUBAO_WPLUS_E2E=1
// 并调用 `wxt build --browser chrome`。供 npm scripts 包装使用。
//
// 原因：WXT 的 `--mode` 不会透传到 Vite 的 `import.meta.env.MODE`，
// 我们改用 `process.env.DOUBAO_WPLUS_E2E` + Vite `define`（见 wxt.config.ts）。
//
// 用法：
//   node scripts/build-e2e.mjs [extra-wxt-args...]

import { spawnSync } from 'node:child_process';

const env = { ...process.env, DOUBAO_WPLUS_E2E: '1' };
const extraArgs = process.argv.slice(2);

console.log('[build-e2e] DOUBAO_WPLUS_E2E=1 wxt build --browser chrome', ...extraArgs);

const result = spawnSync(
  'npx',
  ['wxt', 'build', '--browser', 'chrome', ...extraArgs],
  { stdio: 'inherit', env, shell: true },
);

process.exit(result.status ?? 1);
