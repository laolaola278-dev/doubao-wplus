// tests/prompt-inspector.test.ts
// Prompt Inspector — 单元测试
//
// 验证目标（对应任务第七阶段）：
//   1. 关闭时零影响：augmentRequestBody 不带 captureInspection 时结果与旧版形状一致（无 inspection）
//   2. stagePieces 不变量：presetPrefix + systemPrefix + markedUserPrompt + toolReminder === augmented
//   3. Snapshot 生成：各字段正确（skill 命中 / memory / preset / final）
//   4. Timeline 阶段语义：raw → skill → memory-system → preset → final
//   5. Diff：+/-/~ 行级比较、大输入降级
//   6. 环形缓冲与发送结果回填
//   7. 摘要脱敏：不含 prompt 全文
//   8. Inspector 开关：生产关闭 / DEV 开启 / 用户主动开启

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { augmentRequestBody } from '../core/interceptor/request-augmentation';
import { buildPromptAugmentation } from '../core/prompt';
import { setActiveHostId } from '../core/hosts/registry';
import {
  buildPromptSnapshot,
  buildStageNodes,
  clearPromptSnapshots,
  getLastPromptSnapshot,
  getPromptSnapshots,
  isPromptInspectorEnabled,
  markSnapshotSendResult,
  recordFailedAugmentation,
  recordPromptSnapshot,
  summarizeSnapshot,
} from '../core/diagnostics/prompt-inspector';
import { diffPromptLines, renderDiffText } from '../core/diagnostics/prompt-diff';

function setDevEnabled(v: boolean): void {
  if (v) {
    (globalThis as Record<string, unknown>)['__DOUBAO_WPLUS_E2E__'] = '1';
  } else {
    delete (globalThis as Record<string, unknown>)['__DOUBAO_WPLUS_E2E__'];
    delete (globalThis as Record<string, unknown>)['__DWPLUS_PROMPT_INSPECTOR__'];
  }
}

const baseState = {
  memories: [],
  skills: [],
  activePreset: null,
  modelType: null,
  toolDescriptors: [],
  messageCount: 0,
  locale: 'en' as const,
};

function deepseekBody(prompt: string) {
  return JSON.stringify({ prompt, parent_message_id: null, thinking_enabled: false });
}

beforeEach(() => {
  setActiveHostId('deepseek');
  clearPromptSnapshots();
});
afterEach(() => {
  setDevEnabled(false);
  clearPromptSnapshots();
  setActiveHostId('doubao');
});

// ============================================================
// 1+2. 采集层
// ============================================================

describe('capture layer: buildPromptAugmentation stagePieces', () => {
  it('omits stagePieces by default (legacy shape unchanged)', () => {
    const result = buildPromptAugmentation('hello', { memories: [], locale: 'en' });
    expect(result.stagePieces).toBeUndefined();
    // memorySelectDurationMs：AI Insights 采集新增的标量字段（始终存在）
    expect(Object.keys(result).sort()).toEqual(['augmented', 'memorySelectDurationMs', 'renderedToolCount', 'usedMemoryIds']);
  });

  it('captureStages=true exposes pieces satisfying the concatenation invariant', () => {
    const result = buildPromptAugmentation('hello world', {
      memories: [],
      presetContent: 'Be terse.',
      projectContext: '## Project Context\nWPlus',
      locale: 'en',
      captureStages: true,
    });
    const p = result.stagePieces!;
    expect(p.presetPrefix + p.systemPrefix + p.markedUserPrompt + p.toolReminder).toBe(result.augmented);
    expect(p.presetPrefix).toContain('Be terse.');
    expect(p.systemPrefix).toContain('## Project Context');
    expect(p.markedUserPrompt).toContain('hello world');
  });

  it('captureStages=true does not change the augmented output itself', () => {
    const opts = { memories: [], presetContent: 'P.', locale: 'en' as const };
    const plain = buildPromptAugmentation('same input', opts);
    const captured = buildPromptAugmentation('same input', { ...opts, captureStages: true });
    expect(captured.augmented).toBe(plain.augmented);
    expect(captured.usedMemoryIds).toEqual(plain.usedMemoryIds);
  });
});

describe('capture layer: augmentRequestBody inspection', () => {
  it('OFF (default): result has no inspection field and body is byte-identical to legacy', () => {
    const withOff = augmentRequestBody(deepseekBody('hi'), baseState);
    expect(withOff?.inspection).toBeUndefined();
    // 与显式 false 一致
    const withFalse = augmentRequestBody(deepseekBody('hi'), { ...baseState, captureInspection: false });
    expect(withFalse?.body).toBe(withOff?.body);
  });

  it('ON: inspection carries original prompt, final prompt, and flags', () => {
    const result = augmentRequestBody(deepseekBody('inspect me'), {
      ...baseState,
      captureInspection: true,
    });
    const insp = result!.inspection!;
    expect(insp.originalPrompt).toBe('inspect me');
    expect(insp.matchedSkills).toEqual([]);
    expect(insp.augmentedPrompt).toContain('inspect me');
    expect(insp.isFirstMessage).toBe(true);
    // 不变量在 augmentRequestBody 层同样成立
    const p = insp.stagePieces;
    expect(p.presetPrefix + p.systemPrefix + p.markedUserPrompt + p.toolReminder).toBe(insp.augmentedPrompt);
    // ON 不改变写回 body 的内容
    const off = augmentRequestBody(deepseekBody('inspect me'), baseState);
    expect(result!.body).toBe(off!.body);
  });

  it('ON with skill: matchedSkills and agentTaskPrompt reflect the expansion', () => {
    const result = augmentRequestBody(deepseekBody('/writer draft a note'), {
      ...baseState,
      skills: [{ name: 'writer', instructions: 'Write clearly.', memoryEnabled: false }],
      captureInspection: true,
    });
    const insp = result!.inspection!;
    expect(insp.matchedSkills).toEqual(['writer']);
    expect(insp.agentTaskPrompt).toContain('Write clearly.');
    expect(insp.originalPrompt).toBe('/writer draft a note');
  });

  it('ON works with doubao nested body too (host-agnostic)', () => {
    setActiveHostId('doubao');
    const body = JSON.stringify({
      client_meta: { conversation_id: '', last_message_index: null },
      messages: [{ content_block: [{ content: { text_block: { text: 'nested hello' } } }] }],
      option: { need_deep_think: 0 },
    });
    const result = augmentRequestBody(body, { ...baseState, captureInspection: true });
    expect(result!.inspection!.originalPrompt).toBe('nested hello');
  });
});

// ============================================================
// 3+4. Snapshot 与 Timeline
// ============================================================

describe('PromptSnapshot + Timeline', () => {
  function makeSnapshot(prompt = 'hello', opts: { preset?: string; skill?: boolean } = {}) {
    const result = augmentRequestBody(deepseekBody(opts.skill ? `/writer ${prompt}` : prompt), {
      ...baseState,
      skills: opts.skill ? [{ name: 'writer', instructions: 'Write clearly.', memoryEnabled: false }] : [],
      activePreset: opts.preset ? { id: 1, name: 'p', content: opts.preset, createdAt: 1, updatedAt: 1 } as never : null,
      captureInspection: true,
    });
    return buildPromptSnapshot({
      inspection: result!.inspection!,
      usedMemoryIds: result!.usedMemoryIds,
      augmentDurationMs: 1.5,
    });
  }

  it('builds 5 ordered stages with final === augmentedPrompt', () => {
    const snapshot = makeSnapshot('timeline test', { preset: 'Preset content.' });
    expect(snapshot.stages.map((s) => s.id)).toEqual(['raw-input', 'skill', 'memory-system', 'preset', 'final']);
    const final = snapshot.stages[4];
    expect(final.prompt).toBe(snapshot.finalPrompt);
    expect(snapshot.finalLength).toBe(snapshot.finalPrompt.length);
    // 长度单调不减（每阶段只追加）
    for (let i = 1; i < snapshot.stages.length; i++) {
      expect(snapshot.stages[i].length).toBeGreaterThanOrEqual(snapshot.stages[i - 1].length);
    }
  });

  it('marks skill stage unchanged when no skill matched, changed when matched', () => {
    const noSkill = makeSnapshot('plain');
    expect(noSkill.stages[1].changed).toBe(false);
    expect(noSkill.matchedSkills).toEqual([]);

    const withSkill = makeSnapshot('draft it', { skill: true });
    expect(withSkill.stages[1].changed).toBe(true);
    expect(withSkill.matchedSkills).toEqual(['writer']);
    expect(withSkill.stages[1].note).toContain('writer');
  });

  it('marks preset stage per injection state', () => {
    expect(makeSnapshot('a').stages[3].changed).toBe(false);
    expect(makeSnapshot('a', { preset: 'X' }).stages[3].changed).toBe(true);
    expect(makeSnapshot('a', { preset: 'X' }).presetInjected).toBe(true);
  });

  it('records host and adapter version from the registry', () => {
    const snapshot = makeSnapshot('meta check');
    expect(snapshot.host).toBe('deepseek');
    expect(snapshot.adapterVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(snapshot.augmentDurationMs).toBe(1.5);
    expect(snapshot.augmentSucceeded).toBe(true);
    expect(snapshot.sendStatus).toBe('pending');
  });
});

// ============================================================
// 5. Diff
// ============================================================

describe('diffPromptLines', () => {
  it('detects pure additions (prefix injection pattern)', () => {
    const diff = diffPromptLines('user line', 'system A\nsystem B\n\nuser line');
    expect(diff.addedCount).toBe(3);
    expect(diff.removedCount).toBe(0);
    expect(diff.lines.filter((l) => l.kind === 'same').map((l) => l.text)).toEqual(['user line']);
  });

  it('detects removals and merges single-line replacement into changed (~)', () => {
    const diff = diffPromptLines('keep\nold value\nkeep2', 'keep\nnew value\nkeep2');
    expect(diff.changedCount).toBe(1);
    const changed = diff.lines.find((l) => l.kind === 'changed')!;
    expect(changed.oldText).toBe('old value');
    expect(changed.text).toBe('new value');
  });

  it('renders readable text output with +/-/~ prefixes', () => {
    const text = renderDiffText(diffPromptLines('a\nb', 'a\nc\nd'));
    expect(text).toContain('  a');
    expect(text).toContain('~ b → c');
    expect(text).toContain('+ d');
  });

  it('empty-to-content is all additions; identical is all same', () => {
    expect(diffPromptLines('', 'x\ny').addedCount).toBe(2);
    const same = diffPromptLines('x\ny', 'x\ny');
    expect(same.addedCount + same.removedCount + same.changedCount).toBe(0);
  });

  it('degrades gracefully on very large inputs (prefix/suffix fast path)', () => {
    const big = Array.from({ length: 3000 }, (_, i) => `line ${i}`).join('\n');
    const diff = diffPromptLines(big, 'HEADER\n' + big);
    expect(diff.truncated).toBe(true);
    expect(diff.addedCount).toBe(1);
    expect(diff.lines.find((l) => l.kind === 'added')!.text).toBe('HEADER');
  });
});

// ============================================================
// 6+7. 环形缓冲 / 回填 / 摘要脱敏
// ============================================================

describe('snapshot ring buffer + send-status backfill', () => {
  beforeEach(() => setDevEnabled(true));

  function record(prompt: string) {
    const result = augmentRequestBody(deepseekBody(prompt), { ...baseState, captureInspection: true });
    const snapshot = buildPromptSnapshot({
      inspection: result!.inspection!,
      usedMemoryIds: result!.usedMemoryIds,
      augmentDurationMs: 1,
    });
    recordPromptSnapshot(snapshot);
    return snapshot;
  }

  it('stores snapshots newest-first and caps at 20', () => {
    for (let i = 0; i < 25; i++) record(`msg ${i}`);
    const all = getPromptSnapshots();
    expect(all).toHaveLength(20);
    expect(all[0].originalPrompt).toBe('msg 24'); // 最新在前
    expect(all[19].originalPrompt).toBe('msg 5'); // 最旧的 5 条被挤出
  });

  it('markSnapshotSendResult fills the most recent pending snapshot', () => {
    record('first');
    record('second');
    markSnapshotSendResult('sent');
    const all = getPromptSnapshots();
    expect(all[0].sendStatus).toBe('sent');   // second（最新 pending）
    expect(all[1].sendStatus).toBe('pending'); // first 不受影响
    markSnapshotSendResult('failed');
    expect(getPromptSnapshots()[1].sendStatus).toBe('failed');
  });

  it('recordFailedAugmentation stores a failure entry with truncated input', () => {
    recordFailedAugmentation('x'.repeat(500), 2, 'returned null');
    const last = getLastPromptSnapshot()!;
    expect(last.augmentSucceeded).toBe(false);
    expect(last.sendStatus).toBe('failed');
    expect(last.originalPrompt.length).toBeLessThanOrEqual(500);
  });

  it('summarizeSnapshot carries lengths but never prompt text', () => {
    const snapshot = record('secret user content here');
    const summary = summarizeSnapshot(snapshot);
    expect(summary.originalLength).toBe('secret user content here'.length);
    expect(summary.stageLengths).toHaveLength(5);
    expect(JSON.stringify(summary)).not.toContain('secret user content');
  });
});

// ============================================================
// 8. 开关门控
// ============================================================

describe('inspector gating', () => {
  it('disabled in production: record is a no-op and enabled=false', () => {
    setDevEnabled(false);
    expect(isPromptInspectorEnabled()).toBe(false);
    recordFailedAugmentation('x', 1, 'test');
    expect(getPromptSnapshots()).toHaveLength(0);
  });

  it('enabled via dev gate or explicit user toggle', () => {
    setDevEnabled(true);
    expect(isPromptInspectorEnabled()).toBe(true);
    setDevEnabled(false);
    (globalThis as Record<string, unknown>)['__DWPLUS_PROMPT_INSPECTOR__'] = true;
    expect(isPromptInspectorEnabled()).toBe(true);
  });

  it('OFF path adds zero properties to augmentation results (regression lock)', () => {
    setDevEnabled(false);
    const result = augmentRequestBody(deepseekBody('perf check'), baseState);
    expect('inspection' in result!).toBe(false);
  });
});

// ============================================================
// buildStageNodes 纯函数直测（memory-system 阶段语义）
// ============================================================

describe('buildStageNodes', () => {
  it('reflects systemPromptEnabled=false as unchanged memory-system stage', () => {
    const result = augmentRequestBody(deepseekBody('bare prompt'), {
      ...baseState,
      promptSettings: { systemPromptEnabled: false, memoryEnabled: false },
      captureInspection: true,
    });
    const stages = buildStageNodes(result!.inspection!);
    const memoryStage = stages.find((s) => s.id === 'memory-system')!;
    expect(memoryStage.changed).toBe(false);
    expect(memoryStage.note).toContain('系统提示已关闭');
  });
});
