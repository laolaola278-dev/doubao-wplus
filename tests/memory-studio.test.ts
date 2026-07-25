// tests/memory-studio.test.ts
// Memory Studio 核心模块 — 单元测试
//
// 验证：
//   1. analyzer：selected 集与 selectMemories（生产注入路径）逐条一致；打分分解可解释
//   2. health：duplicate / stale / oversized / conflict 各规则与建议
//   3. portability：导出→导入往返无损（含 source）；非法输入 fail-fast
//   4. selector 回归锁：keywordScore/decayScore 导出后行为不变
//   5. source 字段向后兼容：缺省不影响 selector 与校验

import { describe, expect, it } from 'vitest';
import type { Memory } from '../core/types';
import { analyzeMemoryHits } from '../core/memory/analyzer';
import { runMemoryHealthCheck } from '../core/memory/health';
import { exportMemoriesToJson, parseMemoriesImport } from '../core/memory/portability';
import { decayScore, keywordScore, segmentText, selectMemories } from '../core/memory/selector';
import { validateStoredMemory } from '../core/sync/schema';

let nextId = 1;
function memory(overrides: Partial<Memory> = {}): Memory {
  const id = nextId++;
  return {
    id,
    syncId: `sync-${id}`,
    scope: 'global',
    type: 'reference',
    name: `Memory ${id}`,
    content: `content of memory ${id}`,
    description: `description ${id}`,
    tags: [],
    pinned: false,
    createdAt: Date.now() - 86_400_000,
    updatedAt: Date.now() - 86_400_000,
    accessCount: 5,
    lastAccessedAt: Date.now() - 3 * 86_400_000,
    ...overrides,
  };
}

// ============================================================
// 1. analyzer 与生产注入一致
// ============================================================

describe('analyzeMemoryHits', () => {
  it('selected set matches selectMemories exactly (production parity)', () => {
    const memories = [
      memory({ name: 'TypeScript 偏好', content: '用户偏好 TypeScript 严格模式', tags: ['typescript'] }),
      memory({ name: '烘焙笔记', content: '戚风蛋糕配方', tags: ['烘焙'] }),
      memory({ name: '固定规则', pinned: true }),
    ];
    const prompt = '帮我配置 typescript 严格模式';
    const expected = selectMemories(prompt, [...memories]);
    const analysis = analyzeMemoryHits(prompt, memories);

    const analyzedSelected = analysis.explanations.filter((e) => e.selected).map((e) => e.name).sort();
    expect(analyzedSelected).toEqual(expected.map((m) => m.name).sort());
    expect(analysis.selectedCount).toBe(expected.length);
    expect(analysis.candidateCount).toBe(3);
  });

  it('explains matched keywords by origin (tags/name/content)', () => {
    const m = memory({ name: 'python 环境', content: '项目使用 python 3.12 和 uv 管理', tags: ['python'] });
    const analysis = analyzeMemoryHits('python 环境怎么配', [m]);
    const exp = analysis.explanations[0];
    expect(exp.matchedKeywords.tags).toContain('python');
    expect(exp.matchedKeywords.name).toContain('python');
    expect(exp.matchedKeywords.content).toContain('python');
    // 分解之和 = 总分
    const b = exp.breakdown;
    expect(b.pinnedBonus + b.keywordScore + b.decayScore + b.recentActivityBonus)
      .toBeCloseTo(exp.totalScore, 1);
  });

  it('marks pinned bonus and provides contributed line only for selected', () => {
    const pinned = memory({ name: 'pinned one', pinned: true });
    const analysis = analyzeMemoryHits('unrelated prompt xyz', [pinned]);
    const exp = analysis.explanations[0];
    expect(exp.breakdown.pinnedBonus).toBe(1000);
    expect(exp.selected).toBe(true);
    expect(exp.contributedLine).toContain('pinned one');
  });

  it('is read-only: does not mutate accessCount or lastAccessedAt', () => {
    const m = memory({ accessCount: 7 });
    const before = { ...m };
    analyzeMemoryHits('anything', [m]);
    expect(m.accessCount).toBe(before.accessCount);
    expect(m.lastAccessedAt).toBe(before.lastAccessedAt);
  });
});

// ============================================================
// 2. health
// ============================================================

describe('runMemoryHealthCheck', () => {
  it('flags near-identical contents as duplicate with merge suggestion', () => {
    const a = memory({ name: 'A', content: '用户偏好深色主题 编辑器使用等宽字体 缩进两个空格' });
    const b = memory({ name: 'B', content: '用户偏好深色主题 编辑器使用等宽字体 缩进两个空格' });
    const report = runMemoryHealthCheck([a, b]);
    expect(report.counts.duplicate).toBe(1);
    expect(report.issues[0].suggestion).toBe('merge');
    expect(report.issues[0].memoryNames.sort()).toEqual(['A', 'B']);
  });

  it('flags stale memories matching the auto-cleanup thresholds', () => {
    const now = Date.now();
    const stale = memory({ lastAccessedAt: now - 100 * 86_400_000, accessCount: 1, pinned: false });
    const active = memory({ lastAccessedAt: now - 1 * 86_400_000, accessCount: 1 });
    const pinnedStale = memory({ lastAccessedAt: now - 100 * 86_400_000, accessCount: 0, pinned: true });
    const report = runMemoryHealthCheck([stale, active, pinnedStale], now);
    expect(report.counts.stale).toBe(1);
    expect(report.issues.find((i) => i.kind === 'stale')!.memoryNames).toEqual([stale.name]);
  });

  it('flags oversized content', () => {
    const big = memory({ content: '长内容'.repeat(600) });
    const report = runMemoryHealthCheck([big, memory()]);
    expect(report.counts.oversized).toBe(1);
    expect(report.issues.find((i) => i.kind === 'oversized')!.suggestion).toBe('shorten');
  });

  it('flags same-name different-content as conflict, not duplicate', () => {
    const a = memory({ name: '部署流程', content: '生产环境用蓝绿部署 先切流量再下线旧版本' });
    const b = memory({ name: '部署流程', content: '直接滚动更新 每批次替换四分之一实例 观察十分钟' });
    const report = runMemoryHealthCheck([a, b]);
    expect(report.counts.conflict).toBe(1);
    expect(report.counts.duplicate).toBe(0);
    expect(report.issues.find((i) => i.kind === 'conflict')!.suggestion).toBe('review');
  });

  it('reports clean when nothing is wrong', () => {
    const report = runMemoryHealthCheck([memory(), memory({ name: '另一条', content: '完全不同的主题内容' })]);
    expect(report.issues).toEqual([]);
    expect(report.checkedCount).toBe(2);
  });
});

// ============================================================
// 3. portability
// ============================================================

describe('portability: export/import round-trip', () => {
  it('round-trips memories losslessly including source', () => {
    const memories = [
      memory({ name: '导出A', source: 'ai-tool', tags: ['x'] }),
      memory({ name: '导出B' }), // 无 source（旧数据）
    ];
    const json = exportMemoriesToJson(memories);
    expect(json).not.toContain('"id"'); // 本地自增 id 剥离

    const parsed = parseMemoriesImport(json);
    expect(parsed.ok).toBe(true);
    expect(parsed.memories).toHaveLength(2);
    expect(parsed.memories[0].name).toBe('导出A');
    expect(parsed.memories[0].source).toBe('ai-tool');
    expect(parsed.memories[1].source).toBeUndefined();
    expect(parsed.memories[0].syncId).toBe(memories[0].syncId); // 跨设备去重键保留
  });

  it('rejects invalid JSON, non-arrays, and malformed entries fail-fast', () => {
    expect(parseMemoriesImport('not json').ok).toBe(false);
    expect(parseMemoriesImport('{"a":1}').ok).toBe(false);
    const result = parseMemoriesImport(JSON.stringify([{ name: 'missing everything' }]));
    expect(result.ok).toBe(false);
    expect(result.memories).toEqual([]); // 不做半量导入
  });
});

// ============================================================
// 4+5. 回归锁：selector 行为与 source 兼容
// ============================================================

describe('regression locks', () => {
  it('keywordScore weights unchanged: tag×20 name×15 content×5', () => {
    const m = memory({ name: 'react hooks', content: 'react 状态管理', tags: ['react'] });
    const words = segmentText('react hooks 用法');
    // tag react=20, name 命中 react+hooks=30, content 命中 react=5
    expect(keywordScore(words, m)).toBe(55);
  });

  it('decayScore caps accessCount at 20', () => {
    const heavy = memory({ accessCount: 500, lastAccessedAt: Date.now() });
    expect(decayScore(heavy)).toBeCloseTo(30, 0); // 20 cap + 10 freshness
  });

  it('selectMemories ignores the new source field (injection unaffected)', () => {
    const withSource = memory({ name: 'S', content: '相同内容', source: 'ai-tool' });
    const withoutSource = memory({ name: 'S', content: '相同内容' });
    const a = selectMemories('相同内容', [withSource]);
    const b = selectMemories('相同内容', [withoutSource]);
    expect(a.length).toBe(b.length);
  });

  it('validateStoredMemory accepts records with and without source, drops invalid values', () => {
    const base = {
      syncId: 's1', scope: 'global', type: 'reference', name: 'n', content: 'c',
      description: 'd', tags: [], pinned: false, createdAt: 1, updatedAt: 1, accessCount: 0, lastAccessedAt: 1,
    };
    expect(validateStoredMemory(base).source).toBeUndefined();
    expect(validateStoredMemory({ ...base, source: 'ai-tool' }).source).toBe('ai-tool');
    expect(validateStoredMemory({ ...base, source: 'hacker-value' }).source).toBeUndefined();
  });
});
