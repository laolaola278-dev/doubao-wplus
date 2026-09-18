#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
const rawArgs = process.argv.slice(2);
const buildOnly = rawArgs.includes('--build-only');
const headed = rawArgs.includes('--headed');
const filtered = rawArgs.filter((a) => a !== '--build-only' && a !== '--headed');
const env = { ...process.env, DOUBAO_WPLUS_E2E: '1', DOUBAO_WPLUS_E2E_MARKER: 'on' };
console.log('[run-e2e] DOUBAO_WPLUS_E2E=1 wxt build --browser chrome');
const build = spawnSync('npx', ['wxt', 'build', '--browser', 'chrome'], { stdio: 'inherit', env, shell: true });
if (build.status !== 0) process.exit(build.status ?? 1);
if (buildOnly) process.exit(0);
const pwArgs = ['playwright', 'test', ...(headed ? ['--headed'] : []), ...filtered];
console.log('[run-e2e] DOUBAO_WPLUS_E2E=1 ' + pwArgs.join(' '));
const test = spawnSync('npx', pwArgs, { stdio: 'inherit', env, shell: true });
process.exit(test.status ?? 1);
