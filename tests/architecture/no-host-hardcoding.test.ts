// tests/architecture/no-host-hardcoding.test.ts
// 架构守卫：禁止在通用业务层重新引入宿主硬编码
//
// 适用范围（shared content layer）：
//   - entrypoints/content.ts
//   - entrypoints/main-world.content.ts
//   - core/hosts/shared/**
//   - core/hosts/types.ts
//   - core/hosts/registry.ts
//
// 允许保留宿主硬编码的目录：
//   - core/hosts/deepseek/**   (DeepSeek 专属 adapter)
//   - core/hosts/doubao/**     (豆包专属 adapter)
//   - core/deepseek/**          (DeepSeek 业务功能模块：PoW / official API / file_id 解析)
//   - core/automation/**        (DeepSeek automation runner：login token 消息)
//   - tests/fixtures/**         (测试 fixture)
//   - docs/**                   (历史文档)
//
// 例外（即使是 shared content layer 也允许）：
//   - WXT `matches:` 数组配置（构建时需列出所有宿主域名，与架构无关）
//   - 注释行（// / /* */）—— 仅作提醒，命中仍记录但不阻塞构建

import { readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = process.cwd();

interface ForbiddenRule {
  pattern: RegExp;
  description: string;
}

/** 通用业务层禁用的硬编码模式 */
const FORBIDDEN_RULES: ForbiddenRule[] = [
  { pattern: /\.ds-[\w-]+/i, description: 'DeepSeek 专属 DOM class（如 .ds-message / .ds-button）' },
  { pattern: /ds-message/, description: 'DeepSeek 专属消息 class 名称' },
  { pattern: /ds-button/, description: 'DeepSeek 专属按钮 class 名称' },
  { pattern: /chat\.deepseek\.com/i, description: 'DeepSeek 专属 host URL' },
];

/** 严格意义上的 "shared content layer" 路径（相对 repo root，使用 / 分隔） */
const SHARED_CONTENT_LAYER_FILES = [
  'entrypoints/content.ts',
  'entrypoints/main-world.content.ts',
  'core/hosts/shared/selector-utils.ts',
  'core/hosts/shared/url-utils.ts',
  'core/hosts/types.ts',
  'core/hosts/registry.ts',
];

const ALLOWED_DIRS = [
  'core/hosts/deepseek',
  'core/hosts/doubao',
  'core/deepseek',
  'core/automation',
  'tests/fixtures',
  'docs',
  'public',
];

const SKIP_DIRS = new Set([
  'node_modules',
  '.wxt',
  '.output',
  'dist',
  'build',
  'coverage',
  '.git',
  'i18n',
  'public',
  'assets',
]);

/**
 * 判断一行是否在 WXT `matches:` 数组中。
 * 匹配模式：行首允许空白 + 字符串字面量 '...://.../*'
 */
function isMatchesArrayEntry(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.startsWith('//')) return false;
  return /^['"][*a-z]+:\/\/[^'"]+\/\*['"],?$/i.test(trimmed);
}

interface Violation {
  file: string;
  line: number;
  text: string;
  description: string;
  reason: 'pattern' | 'matches-array-allowed' | 'comment';
}

function scanFileForViolations(absPath: string): Violation[] {
  const source = readFileSync(absPath, 'utf8');
  const lines = source.split(/\r?\n/);
  const violations: Violation[] = [];
  let inBlockComment = false;

  lines.forEach((rawLine, idx) => {
    let line = rawLine;
    let isComment = false;

    // 跟踪块注释
    if (inBlockComment) {
      isComment = true;
      if (line.includes('*/')) inBlockComment = false;
    } else if (/^\s*\/\*/.test(line)) {
      isComment = true;
      if (!line.includes('*/')) inBlockComment = true;
    } else if (/^\s*\/\//.test(line)) {
      isComment = true;
    }

    for (const rule of FORBIDDEN_RULES) {
      if (!rule.pattern.test(line)) continue;
      if (isMatchesArrayEntry(line)) {
        // WXT matches 数组允许硬编码（构建配置）
        continue;
      }
      if (isComment) {
        // 注释行允许，但记录
        violations.push({
          file: absPath,
          line: idx + 1,
          text: line,
          description: rule.description,
          reason: 'comment',
        });
        continue;
      }
      violations.push({
        file: absPath,
        line: idx + 1,
        text: line,
        description: rule.description,
        reason: 'pattern',
      });
    }
  });
  return violations;
}

function formatViolation(v: Violation): string {
  const rel = relative(REPO_ROOT, v.file);
  return `  ${rel}:${v.line}  [${v.description}]${v.reason === 'comment' ? ' (comment)' : ''}\n    ${v.text.trim()}`;
}

describe('architecture: no host hardcoding in shared content layer', () => {
  it('entrypoints/content.ts is free of forbidden host hardcoding in code (comments allowed but reported)', () => {
    const target = join(REPO_ROOT, 'entrypoints/content.ts');
    const violations = scanFileForViolations(target);
    const blocking = violations.filter((v) => v.reason === 'pattern');
    const comments = violations.filter((v) => v.reason === 'comment');

    if (comments.length > 0) {
      // 软警告：注释中出现宿主硬编码，应当清理
      console.warn(
        `[architecture] entrypoints/content.ts still has ${comments.length} comment-time host reference(s). ` +
        'Consider rephrasing to host-agnostic language:\n' +
        comments.map(formatViolation).join('\n'),
      );
    }
    if (blocking.length > 0) {
      throw new Error(
        'Detected host hardcoding in entrypoints/content.ts. ' +
        '请将宿主专属选择器迁移到 core/hosts/<host>/adapter.ts：\n' +
        blocking.map(formatViolation).join('\n'),
      );
    }
    expect(blocking).toEqual([]);
  });

  it('entrypoints/main-world.content.ts is free of forbidden host hardcoding in code', () => {
    const target = join(REPO_ROOT, 'entrypoints/main-world.content.ts');
    const violations = scanFileForViolations(target);
    const blocking = violations.filter((v) => v.reason === 'pattern');
    if (blocking.length > 0) {
      throw new Error(
        'Detected host hardcoding in entrypoints/main-world.content.ts. ' +
        '请将宿主专属选择器迁移到 core/hosts/<host>/adapter.ts：\n' +
        blocking.map(formatViolation).join('\n'),
      );
    }
    expect(blocking).toEqual([]);
  });

  it('shared core/hosts/shared layer is free of forbidden host hardcoding', () => {
    const targets = [
      'core/hosts/shared/selector-utils.ts',
      'core/hosts/shared/url-utils.ts',
      'core/hosts/types.ts',
      'core/hosts/registry.ts',
    ];
    const violations: Violation[] = [];
    for (const rel of targets) {
      const abs = join(REPO_ROOT, rel);
      if (!statSync(abs, { throwIfNoEntry: false })) continue;
      violations.push(...scanFileForViolations(abs));
    }
    const blocking = violations.filter((v) => v.reason === 'pattern');
    if (blocking.length > 0) {
      throw new Error(
        'Detected host hardcoding in core/hosts/shared layer. ' +
        '请将宿主专属选择器迁移到 core/hosts/<host>/adapter.ts：\n' +
        blocking.map(formatViolation).join('\n'),
      );
    }
    expect(blocking).toEqual([]);
  });

  it('shared layer does not directly import from core/hosts/deepseek or core/hosts/doubao (use registry instead)', () => {
    // 业务层应通过 core/hosts/registry 间接使用 adapter，避免硬编码 adapter import。
    const violations: string[] = [];
    for (const rel of SHARED_CONTENT_LAYER_FILES) {
      const abs = join(REPO_ROOT, rel);
      if (!statSync(abs, { throwIfNoEntry: false })) continue;
      const source = readFileSync(abs, 'utf8');
      const lines = source.split(/\r?\n/);
      lines.forEach((line, idx) => {
        if (
          /from\s+['"](?:\.\.\/)+hosts\/(?:deepseek|doubao)\//.test(line) ||
          /from\s+['"]\.\.\/hosts\/(?:deepseek|doubao)\//.test(line)
        ) {
          const r = relative(REPO_ROOT, abs);
          violations.push(`  ${r}:${idx + 1}  ${line.trim()}`);
        }
      });
    }
    if (violations.length > 0) {
      throw new Error(
        'Shared layer should not directly import concrete host adapters. ' +
        'Use getActiveAdapter() from core/hosts/registry.ts instead:\n' +
        violations.join('\n'),
      );
    }
    expect(violations).toEqual([]);
  });
});
