// tests/host-feature-flags.test.ts
// Host Feature Flags — 验证 DeepSeek-only feature modules 的边界
//
// 规则：
//  - DeepSeek adapter 必须启用 historyOrganizer / projectSidebarOrganizer / themeSync
//  - Doubao adapter 现已复刻这些 feature，同样启用（DOM 增强逻辑已按豆包选择器/路径改写）
//  - 业务层（content.ts）通过 getActiveFeatures() 查询能力，并按宿主分派到对应 feature module
//  - 通用 content layer 不应出现 .ds-*、ds-message、ds-button、chat.deepseek.com 等 DeepSeek 专属字符串

import { describe, expect, it } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DoubaoAdapter } from '../core/hosts/doubao/adapter';
import { DeepSeekAdapter } from '../core/hosts/deepseek/adapter';
import { getActiveFeatures, setActiveHostId } from '../core/hosts/registry';

const doubaoAdapter = new DoubaoAdapter();
const deepseekAdapter = new DeepSeekAdapter();

describe('host feature flags', () => {
  it('DeepSeek adapter enables historyOrganizer, projectSidebarOrganizer and themeSync', () => {
    const adapter = new DeepSeekAdapter();
    const features = adapter.getFeatures();
    expect(features.historyOrganizer).toBe(true);
    expect(features.projectSidebarOrganizer).toBe(true);
    expect(features.themeSync).toBe(true);
  });

  it('Doubao adapter enables historyOrganizer, projectSidebarOrganizer and themeSync', () => {
    const adapter = new DoubaoAdapter();
    const features = adapter.getFeatures();
    expect(features.historyOrganizer).toBe(true);
    expect(features.projectSidebarOrganizer).toBe(true);
    expect(features.themeSync).toBe(true);
  });

  it('registry.getActiveFeatures reflects active host selection', () => {
    setActiveHostId('deepseek');
    expect(getActiveFeatures().historyOrganizer).toBe(true);
    expect(getActiveFeatures().projectSidebarOrganizer).toBe(true);
    expect(getActiveFeatures().themeSync).toBe(true);

    setActiveHostId('doubao');
    expect(getActiveFeatures().historyOrganizer).toBe(true);
    expect(getActiveFeatures().projectSidebarOrganizer).toBe(true);
    expect(getActiveFeatures().themeSync).toBe(true);
  });
});

describe('DeepSeek-only feature module files are in features/deepseek/', () => {
  const featureFiles = [
    'entrypoints/content/features/deepseek/history-organizer.ts',
    'entrypoints/content/features/deepseek/project-sidebar-organizer.ts',
  ];

  for (const rel of featureFiles) {
    it(`${rel} exists in declared host feature directory`, () => {
      const abs = join(process.cwd(), rel);
      expect(statSync(abs, { throwIfNoEntry: false })).toBeTruthy();
      const source = readFileSync(abs, 'utf8');
      // 这些模块应该保留 DeepSeek 专属选择器（这是设计意图）
      expect(source).toMatch(/ds-|deepseek|chat\.deepseek\.com/i);
    });
  }
});

describe('Doubao feature module files are in features/doubao/', () => {
  const featureFiles = [
    'entrypoints/content/features/doubao/history-organizer.ts',
    'entrypoints/content/features/doubao/project-sidebar-organizer.ts',
    'entrypoints/content/features/doubao/theme-sync.ts',
  ];

  for (const rel of featureFiles) {
    it(`${rel} exists in declared host feature directory`, () => {
      const abs = join(process.cwd(), rel);
      expect(statSync(abs, { throwIfNoEntry: false })).toBeTruthy();
      const source = readFileSync(abs, 'utf8');
      // 豆包版应含豆包专属路径/品牌，且不应残留 DeepSeek 专属选择器或域名
      expect(source).toMatch(/doubao|\/chat\//i);
      expect(source).not.toMatch(/chat\.deepseek\.com/i);
      expect(source).not.toMatch(/\bds-message\b|\bds-button\b/);
    });
  }
});

describe('shared content layer does not directly import DeepSeek feature modules', () => {
  // 历史原因：以前 content.ts 静态 import `startDeepSeekHistoryOrganizer` 等。
  // 新架构仍然需要 import feature module 的入口函数（用于启动器），但
  // 调用前必须先通过 getActiveFeatures() gate。
  // 这里我们确保调用点使用条件 gate，而不是无条件启动。
  it('content.ts gates history-organizer behind getActiveFeatures()', () => {
    const path = join(process.cwd(), 'entrypoints/content.ts');
    const source = readFileSync(path, 'utf8');
    expect(source).toContain('getActiveFeatures(window.location.href)');
    expect(source).toContain('features.historyOrganizer');
    expect(source).toContain('features.projectSidebarOrganizer');
    expect(source).toContain('features.themeSync');
  });

  it('shared/ux-polish is host-agnostic', () => {
    const path = join(process.cwd(), 'entrypoints/content/features/shared/ux-polish.ts');
    if (!statSync(path, { throwIfNoEntry: false })) return; // skipped if absent
    const source = readFileSync(path, 'utf8');
    expect(source).not.toMatch(/\bds-[\w-]+\b/);
    expect(source).not.toMatch(/chat\.deepseek\.com/i);
  });
});

describe('adapter selector isolation — doubao selectors do not leak DeepSeek private patterns', () => {
  // 静态检查：doubao adapter 的 selector 配置不应出现 DeepSeek 专属前缀/域名
  // DeepSeek 专属：ds- 前缀类名 / chat.deepseek.com / /a/chat/s/ 路径
  // 通用模式（如 message-list、user-message）允许共用
  it('doubao adapter does not contain DeepSeek-specific selectors', () => {
    const path = join(process.cwd(), 'core/hosts/doubao/adapter.ts');
    const source = readFileSync(path, 'utf8');
    // 不应出现 ds- 前缀的 class 选择器（如 .ds-message-list）
    expect(source).not.toMatch(/\bds-[a-z][\w-]*\b/);
    // 不应出现 DeepSeek 域名
    expect(source).not.toMatch(/chat\.deepseek\.com/i);
    // 不应出现 DeepSeek 历史路径
    expect(source).not.toMatch(/\/a\/chat\/s\//);
  });

  it('DeepSeek adapter does not contain Doubao-specific selectors', () => {
    const path = join(process.cwd(), 'core/hosts/deepseek/adapter.ts');
    const source = readFileSync(path, 'utf8');
    // 不应出现豆包专属前缀
    expect(source).not.toMatch(/\bdbx-[\w-]*\b/);
    // 不应出现豆包域名
    expect(source).not.toMatch(/doubao\.com/i);
    // 不应出现 Semi Design 专属类名
    expect(source).not.toMatch(/semi-input-textarea/i);
    // 不应出现豆包 bg-g-send 类
    expect(source).not.toMatch(/\bbg-g-send\b/);
  });
});

describe('adapter mainContainer / themeMarker — doubao 独有的新选择器', () => {
  it('doubao adapter declares the 5 new selector keys', () => {
    const selectors = doubaoAdapter.getSelectors();
    expect(selectors.stopButton).toBeDefined();
    expect(selectors.stopButton!.length).toBeGreaterThan(0);
    expect(selectors.mainContainer).toBeDefined();
    expect(selectors.conversationList).toBeDefined();
    expect(selectors.currentConversation).toBeDefined();
    expect(selectors.themeMarker).toBeDefined();
  });

  it('DeepSeek adapter treats new selector keys as optional (may be undefined)', () => {
    const selectors = deepseekAdapter.getSelectors();
    // deepseek 不声明这些字段是合法的（HostSelectors 中这些是 optional）
    // 这里只验证不会因缺字段抛错
    expect(() => selectors.stopButton).not.toThrow();
  });
});
