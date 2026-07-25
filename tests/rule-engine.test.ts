// tests/rule-engine.test.ts
// Rule Engine — 单元测试
//
// 覆盖：
//   1. 条件矩阵：10 类条件各自的真/假分支
//   2. 动作变换：8 类动作对 outcome 的影响
//   3. 优先级与确定性排序、stopOnMatch、block 短路
//   4. 坏规则隔离（求值抛异常不阻塞发送）
//   5. 校验 fail-fast
//   6. 冲突检测各规则
//   7. pipeline 兼容性：无规则零影响；规则效果经既有通道进入 augmentRequestBody

import { beforeEach, describe, expect, it } from 'vitest';
import {
  evaluateCondition,
  runRuleEngine,
  type RuleEvaluationContext,
} from '../core/rules/engine';
import {
  validateRule,
  validateRuleEngineConfig,
  type PromptRule,
  type RuleEngineConfig,
} from '../core/rules/types';
import { detectRuleConflicts } from '../core/rules/conflicts';
import { applyRulesToAugmentationInput } from '../core/rules/pipeline';
import { augmentRequestBody } from '../core/interceptor/request-augmentation';
import { setActiveHostId } from '../core/hosts/registry';
import type { Memory } from '../core/types';

const BASE_CTX: RuleEvaluationContext = {
  prompt: 'hello world',
  hostId: 'doubao',
  pageUrl: 'https://www.doubao.com/chat/123',
  isFirstMessage: true,
  memoryHitCount: 0,
  hasAttachments: false,
  variables: {},
};

let ruleSeq = 0;
function rule(overrides: Partial<PromptRule>): PromptRule {
  const id = overrides.id ?? `rule-${++ruleSeq}`;
  return {
    id,
    name: overrides.name ?? `Rule ${id}`,
    enabled: true,
    priority: 100,
    match: 'all',
    conditions: [{ kind: 'keyword', keywords: ['hello'] }],
    actions: [{ kind: 'log-diagnostics', message: 'hit' }],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function config(rules: PromptRule[], variables: Record<string, string> = {}): RuleEngineConfig {
  return { version: 1, rules, variables };
}

// ============================================================
// 1. 条件矩阵
// ============================================================

describe('evaluateCondition', () => {
  it('keyword: case-insensitive any-match', () => {
    expect(evaluateCondition({ kind: 'keyword', keywords: ['PYTHON'] }, { ...BASE_CTX, prompt: '写段 python 代码' })).toBe(true);
    expect(evaluateCondition({ kind: 'keyword', keywords: ['java', 'go'] }, { ...BASE_CTX, prompt: '写段 python' })).toBe(false);
  });

  it('regex', () => {
    expect(evaluateCondition({ kind: 'regex', pattern: '^翻译[:：]' }, { ...BASE_CTX, prompt: '翻译：hello' })).toBe(true);
    expect(evaluateCondition({ kind: 'regex', pattern: '^翻译[:：]' }, { ...BASE_CTX, prompt: '请帮我翻译' })).toBe(false);
  });

  it('length: all four operators', () => {
    const ctx = { ...BASE_CTX, prompt: 'x'.repeat(500) };
    expect(evaluateCondition({ kind: 'length', op: 'gt', value: 499 }, ctx)).toBe(true);
    expect(evaluateCondition({ kind: 'length', op: 'gte', value: 500 }, ctx)).toBe(true);
    expect(evaluateCondition({ kind: 'length', op: 'lt', value: 500 }, ctx)).toBe(false);
    expect(evaluateCondition({ kind: 'length', op: 'lte', value: 500 }, ctx)).toBe(true);
  });

  it('host and url (substring + re: prefix)', () => {
    expect(evaluateCondition({ kind: 'host', hostId: 'doubao' }, BASE_CTX)).toBe(true);
    expect(evaluateCondition({ kind: 'host', hostId: 'deepseek' }, BASE_CTX)).toBe(false);
    expect(evaluateCondition({ kind: 'url', match: '/chat/' }, BASE_CTX)).toBe(true);
    expect(evaluateCondition({ kind: 'url', match: 're:/chat/\\d+$' }, BASE_CTX)).toBe(true);
    expect(evaluateCondition({ kind: 'url', match: 're:/settings' }, BASE_CTX)).toBe(false);
  });

  it('time: normal and overnight windows', () => {
    const at = (h: number, m: number) => ({ ...BASE_CTX, now: new Date(2026, 6, 17, h, m) });
    expect(evaluateCondition({ kind: 'time', from: '09:00', to: '18:00' }, at(12, 0))).toBe(true);
    expect(evaluateCondition({ kind: 'time', from: '09:00', to: '18:00' }, at(20, 0))).toBe(false);
    // 跨午夜
    expect(evaluateCondition({ kind: 'time', from: '22:00', to: '06:00' }, at(23, 30))).toBe(true);
    expect(evaluateCondition({ kind: 'time', from: '22:00', to: '06:00' }, at(3, 0))).toBe(true);
    expect(evaluateCondition({ kind: 'time', from: '22:00', to: '06:00' }, at(12, 0))).toBe(false);
  });

  it('session / memory-hit / attachment / variable', () => {
    expect(evaluateCondition({ kind: 'session', state: 'first-message' }, BASE_CTX)).toBe(true);
    expect(evaluateCondition({ kind: 'session', state: 'follow-up' }, { ...BASE_CTX, isFirstMessage: false })).toBe(true);
    expect(evaluateCondition({ kind: 'memory-hit', minHits: 2 }, { ...BASE_CTX, memoryHitCount: 3 })).toBe(true);
    expect(evaluateCondition({ kind: 'memory-hit', minHits: 2 }, { ...BASE_CTX, memoryHitCount: 1 })).toBe(false);
    expect(evaluateCondition({ kind: 'attachment', present: true }, { ...BASE_CTX, hasAttachments: true })).toBe(true);
    expect(evaluateCondition({ kind: 'attachment', present: false }, BASE_CTX)).toBe(true);
    const varsCtx = { ...BASE_CTX, variables: { mode: 'strict-review' } };
    expect(evaluateCondition({ kind: 'variable', name: 'mode', op: 'eq', value: 'strict-review' }, varsCtx)).toBe(true);
    expect(evaluateCondition({ kind: 'variable', name: 'mode', op: 'contains', value: 'strict' }, varsCtx)).toBe(true);
    expect(evaluateCondition({ kind: 'variable', name: 'missing', op: 'neq', value: 'x' }, varsCtx)).toBe(true);
  });
});

// ============================================================
// 2. 动作 + 3. 优先级/短路
// ============================================================

describe('runRuleEngine actions and ordering', () => {
  it('enable-skill rewrites prompt to /command (reusing skill expansion path)', () => {
    const outcome = runRuleEngine(config([
      rule({ actions: [{ kind: 'enable-skill', skillName: 'python' }] }),
    ]), BASE_CTX);
    expect(outcome.prompt).toBe('/python hello world');
    expect(outcome.promptChanged).toBe(true);
  });

  it('append-prompt before/after and replace-prompt', () => {
    const outcome = runRuleEngine(config([
      rule({ priority: 1, actions: [{ kind: 'append-prompt', position: 'before', text: '[前缀]' }] }),
      rule({ priority: 2, actions: [{ kind: 'append-prompt', position: 'after', text: '[后缀]' }] }),
      rule({ priority: 3, actions: [{ kind: 'replace-prompt', pattern: 'world', text: '世界' }] }),
    ]), BASE_CTX);
    expect(outcome.prompt).toBe('[前缀]\n\nhello 世界\n\n[后缀]');
  });

  it('inject-memory accumulates unique ids; set-preset last-writer-wins', () => {
    const outcome = runRuleEngine(config([
      rule({ priority: 1, actions: [{ kind: 'inject-memory', memoryIds: [1, 2] }, { kind: 'set-preset', presetId: 'p1' }] }),
      rule({ priority: 2, actions: [{ kind: 'inject-memory', memoryIds: [2, 3] }, { kind: 'set-preset', presetId: 'p2' }] }),
    ]), BASE_CTX);
    expect(outcome.pinnedMemoryIds).toEqual([1, 2, 3]);
    expect(outcome.presetOverrideId).toBe('p2');
  });

  it('block-send short-circuits remaining actions and rules', () => {
    const outcome = runRuleEngine(config([
      rule({ priority: 1, actions: [{ kind: 'block-send', reason: '禁止发送' }, { kind: 'append-prompt', position: 'after', text: 'never' }] }),
      rule({ priority: 2, actions: [{ kind: 'append-prompt', position: 'after', text: 'unreached' }] }),
    ]), BASE_CTX);
    expect(outcome.blocked?.reason).toBe('禁止发送');
    expect(outcome.prompt).toBe('hello world'); // block 前无变换
    expect(outcome.records).toHaveLength(1);    // 第二条规则未执行
  });

  it('priority ordering is deterministic (priority then id)', () => {
    const outcome = runRuleEngine(config([
      rule({ id: 'b', priority: 1, actions: [{ kind: 'append-prompt', position: 'after', text: 'B' }] }),
      rule({ id: 'a', priority: 1, actions: [{ kind: 'append-prompt', position: 'after', text: 'A' }] }),
      rule({ id: 'c', priority: 0, actions: [{ kind: 'append-prompt', position: 'after', text: 'C' }] }),
    ]), BASE_CTX);
    expect(outcome.prompt).toBe('hello world\n\nC\n\nA\n\nB');
  });

  it('stopOnMatch halts later rules; later rules see earlier transforms', () => {
    const outcome = runRuleEngine(config([
      rule({ priority: 1, stopOnMatch: true, conditions: [{ kind: 'keyword', keywords: ['hello'] }], actions: [{ kind: 'replace-prompt', pattern: '', text: '完全替换' }] }),
      rule({ priority: 2, conditions: [{ kind: 'keyword', keywords: ['完全替换'] }], actions: [{ kind: 'append-prompt', position: 'after', text: 'x' }] }),
    ]), BASE_CTX);
    expect(outcome.prompt).toBe('完全替换');
    expect(outcome.records).toHaveLength(1);
  });

  it('confirm-send and log-diagnostics are collected, disabled rules skipped', () => {
    const outcome = runRuleEngine(config([
      rule({ actions: [{ kind: 'confirm-send', message: '确定？' }, { kind: 'log-diagnostics', message: 'debug-mark' }] }),
      rule({ enabled: false, actions: [{ kind: 'block-send', reason: 'off' }] }),
    ]), BASE_CTX);
    expect(outcome.confirmations).toEqual([{ ruleId: expect.any(String), message: '确定？' }]);
    expect(outcome.diagnosticsLogs).toEqual(['debug-mark']);
    expect(outcome.blocked).toBeNull();
    expect(outcome.records).toHaveLength(1); // 禁用规则不进记录
  });

  it('a crashing rule is isolated with an error record; send is not blocked', () => {
    const bad = rule({
      priority: 1,
      // 校验层会拒绝这种规则，但防御运行期数据损坏：直接构造非法正则
      conditions: [{ kind: 'regex', pattern: '(unclosed' } as never],
    });
    const good = rule({ priority: 2, actions: [{ kind: 'append-prompt', position: 'after', text: 'ok' }] });
    const outcome = runRuleEngine(config([bad, good]), BASE_CTX);
    expect(outcome.records[0].error).toBeTruthy();
    expect(outcome.records[0].matched).toBe(false);
    expect(outcome.prompt).toContain('ok'); // 好规则继续执行
    expect(outcome.blocked).toBeNull();
  });

  it('match: any vs all', () => {
    const conditions = [
      { kind: 'keyword', keywords: ['nomatch'] },
      { kind: 'host', hostId: 'doubao' },
    ] as PromptRule['conditions'];
    expect(runRuleEngine(config([rule({ match: 'any', conditions })]), BASE_CTX).records[0].matched).toBe(true);
    expect(runRuleEngine(config([rule({ match: 'all', conditions })]), BASE_CTX).records[0].matched).toBe(false);
  });
});

// ============================================================
// 5. 校验
// ============================================================

describe('validateRule / validateRuleEngineConfig', () => {
  it('accepts a well-formed rule', () => {
    expect(validateRule(rule({}))).toEqual({ ok: true, errors: [] });
  });

  it('rejects missing fields, bad kinds, and invalid regex', () => {
    expect(validateRule({}).ok).toBe(false);
    expect(validateRule(rule({ conditions: [] })).ok).toBe(false);
    expect(validateRule(rule({ conditions: [{ kind: 'nope' } as never] })).errors.join()).toContain('kind 非法');
    expect(validateRule(rule({ conditions: [{ kind: 'regex', pattern: '(bad' }] })).errors.join()).toContain('不是合法正则');
    expect(validateRule(rule({ actions: [{ kind: 'enable-skill', skillName: '' } as never] })).ok).toBe(false);
    expect(validateRule(rule({ conditions: [{ kind: 'time', from: '25:00', to: '06:00' } as never] })).ok).toBe(false);
  });

  it('config validation rejects duplicate ids', () => {
    const result = validateRuleEngineConfig(config([rule({ id: 'dup' }), rule({ id: 'dup' })]));
    expect(result.ok).toBe(false);
    expect(result.errors.join()).toContain('id 重复');
  });
});

// ============================================================
// 6. 冲突检测
// ============================================================

describe('detectRuleConflicts', () => {
  it('flags preset-override, skill-stacking, replace-cascade, duplicate-name', () => {
    const conflicts = detectRuleConflicts([
      rule({ id: 'r1', name: 'same', priority: 1, actions: [{ kind: 'set-preset', presetId: 'a' }, { kind: 'enable-skill', skillName: 's1' }, { kind: 'replace-prompt', pattern: 'x', text: 'y' }] }),
      rule({ id: 'r2', name: 'same', priority: 2, actions: [{ kind: 'set-preset', presetId: 'b' }, { kind: 'enable-skill', skillName: 's2' }, { kind: 'replace-prompt', pattern: 'y', text: 'z' }] }),
    ]);
    const kinds = conflicts.map((c) => c.kind).sort();
    expect(kinds).toEqual(['duplicate-name', 'preset-override', 'replace-cascade', 'skill-stacking']);
  });

  it('flags block-unreachable when a blocker shadows overlapping later rules', () => {
    const conflicts = detectRuleConflicts([
      rule({ id: 'blocker', name: 'blocker', priority: 1, conditions: [{ kind: 'keyword', keywords: ['secret'] }], actions: [{ kind: 'block-send', reason: 'no' }] }),
      rule({ id: 'shadowed', name: 'shadowed', priority: 2, conditions: [{ kind: 'keyword', keywords: ['secret', 'token'] }], actions: [{ kind: 'log-diagnostics', message: 'x' }] }),
    ]);
    expect(conflicts.some((c) => c.kind === 'block-unreachable')).toBe(true);
  });

  it('ignores disabled rules and reports clean configs', () => {
    expect(detectRuleConflicts([
      rule({ name: 'a', enabled: false, actions: [{ kind: 'set-preset', presetId: 'a' }] }),
      rule({ name: 'b', actions: [{ kind: 'set-preset', presetId: 'b' }] }),
    ])).toEqual([]);
  });
});

// ============================================================
// 7. pipeline 兼容性（与 augmentRequestBody 集成）
// ============================================================

describe('applyRulesToAugmentationInput', () => {
  beforeEach(() => setActiveHostId('deepseek'));

  const memoryFixture = (id: number, name: string): Memory => ({
    id, syncId: `s${id}`, scope: 'global', type: 'reference', name,
    content: `${name} 的内容`, description: 'd', tags: [], pinned: false,
    createdAt: 1, updatedAt: 1, accessCount: 0, lastAccessedAt: 1,
  });

  const dsBody = (prompt: string) => JSON.stringify({ prompt, parent_message_id: null, thinking_enabled: false });

  it('no enabled rules: passthrough without parsing (zero impact)', () => {
    const result = applyRulesToAugmentationInput({
      bodyStr: 'not even json',
      config: config([rule({ enabled: false })]),
      memories: [], presets: [], activePreset: null,
      pageUrl: 'https://chat.deepseek.com/',
    });
    expect(result.engineRan).toBe(false);
    expect(result.bodyStr).toBe('not even json');
    expect(result.outcome).toBeNull();
  });

  it('non-chat body: passthrough (same detection as augmentation)', () => {
    const result = applyRulesToAugmentationInput({
      bodyStr: JSON.stringify({ cmd: 2260 }),
      config: config([rule({})]),
      memories: [], presets: [], activePreset: null,
      pageUrl: 'https://chat.deepseek.com/',
    });
    expect(result.engineRan).toBe(false);
  });

  it('prompt rewrite flows through the host mapping and into augmentRequestBody', () => {
    const ruleResult = applyRulesToAugmentationInput({
      bodyStr: dsBody('python 问题'),
      config: config([rule({
        conditions: [{ kind: 'keyword', keywords: ['python'] }],
        actions: [{ kind: 'enable-skill', skillName: 'pyexpert' }],
      })]),
      memories: [], presets: [], activePreset: null,
      pageUrl: 'https://chat.deepseek.com/',
    });
    expect(ruleResult.engineRan).toBe(true);
    expect(JSON.parse(ruleResult.bodyStr).prompt).toBe('/pyexpert python 问题');

    // 端到端：改写后的 body 进 augmentRequestBody，skill 正常展开
    const augmented = augmentRequestBody(ruleResult.bodyStr, {
      memories: ruleResult.memories,
      skills: [{ name: 'pyexpert', instructions: 'You are a Python expert.', memoryEnabled: false }],
      activePreset: ruleResult.activePreset,
      modelType: null, toolDescriptors: [], messageCount: 0, locale: 'en',
    });
    expect(JSON.parse(augmented!.body).prompt).toContain('You are a Python expert.');
  });

  it('inject-memory pins targets so production scoring must select them', () => {
    const memories = [memoryFixture(1, '目标记忆'), memoryFixture(2, '无关记忆')];
    const result = applyRulesToAugmentationInput({
      bodyStr: dsBody('完全不相关的话题'),
      config: config([rule({
        conditions: [{ kind: 'length', op: 'gte', value: 0 }],
        actions: [{ kind: 'inject-memory', memoryIds: [1] }],
      })]),
      memories, presets: [], activePreset: null,
      pageUrl: 'https://chat.deepseek.com/',
    });
    const target = result.memories.find((m) => m.id === 1)!;
    expect(target.pinned).toBe(true);
    expect(result.memories.find((m) => m.id === 2)!.pinned).toBe(false);
    // 原数组不被修改（副本语义）
    expect(memories[0].pinned).toBe(false);

    const augmented = augmentRequestBody(dsBody('完全不相关的话题'), {
      memories: result.memories, skills: [], activePreset: null,
      modelType: null, toolDescriptors: [], messageCount: 0, locale: 'en',
    });
    expect(JSON.parse(augmented!.body).prompt).toContain('目标记忆');
  });

  it('set-preset overrides activePreset for this turn only', () => {
    const presets = [
      { id: 'p1', name: 'P1', content: '来自规则的 preset 内容', createdAt: 1, updatedAt: 1 },
    ] as never[];
    const result = applyRulesToAugmentationInput({
      bodyStr: dsBody('hi'),
      config: config([rule({
        conditions: [{ kind: 'length', op: 'gte', value: 0 }],
        actions: [{ kind: 'set-preset', presetId: 'p1' }],
      })]),
      memories: [], presets, activePreset: null,
      pageUrl: 'https://chat.deepseek.com/',
    });
    expect((result.activePreset as { id?: string })?.id).toBe('p1');
  });

  it('blocked outcome leaves all inputs untouched', () => {
    const result = applyRulesToAugmentationInput({
      bodyStr: dsBody('包含机密内容'),
      config: config([rule({
        conditions: [{ kind: 'keyword', keywords: ['机密'] }],
        actions: [{ kind: 'block-send', reason: '内容包含机密关键词' }],
      })]),
      memories: [], presets: [], activePreset: null,
      pageUrl: 'https://chat.deepseek.com/',
    });
    expect(result.outcome?.blocked?.reason).toBe('内容包含机密关键词');
    expect(result.bodyStr).toBe(dsBody('包含机密内容')); // 未变换
  });

  it('works identically on doubao nested bodies (host-agnostic)', () => {
    setActiveHostId('doubao');
    const body = JSON.stringify({
      client_meta: { conversation_id: '', last_message_index: null },
      messages: [{ content_block: [{ content: { text_block: { text: '豆包上的 python 问题' } } }] }],
      option: { need_deep_think: 0 },
    });
    const result = applyRulesToAugmentationInput({
      bodyStr: body,
      config: config([rule({
        conditions: [{ kind: 'host', hostId: 'doubao' }, { kind: 'keyword', keywords: ['python'] }],
        actions: [{ kind: 'append-prompt', position: 'after', text: '（豆包附加指令）' }],
      })]),
      memories: [], presets: [], activePreset: null,
      pageUrl: 'https://www.doubao.com/chat/',
    });
    const text = JSON.parse(result.bodyStr).messages[0].content_block[0].content.text_block.text;
    expect(text).toContain('（豆包附加指令）');
  });
});
