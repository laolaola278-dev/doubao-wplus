#!/usr/bin/env node
// scripts/preview-dev.mjs
//
// Dev-server launcher used by the Freebuff preview (`npm run dev:preview`).
// The preview platform injects a PORT env var and requires the dev server to
// bind to 0.0.0.0. Falls back to WXT's default port (3000) when PORT is unset
// so the same command also works on a local machine.
import { spawnSync } from 'node:child_process';

const port = process.env.PORT && Number.isInteger(Number(process.env.PORT))
  ? String(process.env.PORT)
  : '3000';

console.log(`[preview-dev] wxt --host 0.0.0.0 --port ${port}`);

const result = spawnSync(
  'npx',
  ['wxt', '--host', '0.0.0.0', '--port', port],
  { stdio: 'inherit', shell: true },
);

process.exit(result.status ?? 1);
