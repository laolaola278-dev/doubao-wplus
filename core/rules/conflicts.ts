// core/rules/conflicts.ts
// 规则冲突检测 — 静态分析（保存/编辑时运行，不在热路径）。
//
// 检测项：
//   preset-override   多条规则设置不同 preset：后执行者静默覆盖先执行者
//   skill-stacking    多条规则各自 enable-skill：只有第一条生效（prompt 已以 / 开头后
//                     第二条 enable-skill 会再叠前缀，展开语义混乱）
//   block-unreachable 某规则 block-send 且优先级更高、条件是另一规则条件的超集近似
//                     （保守：同 kind 条件重叠即提示），使后者永不可达
//   replace-cascade   多条规则都做 replace-prompt：串联结果依赖顺序，提示确认优先级
//   duplicate-name    规则重名（管理性提示）
//
// 定位：辅助提示（warning），不阻止保存 —— 有意的规则链是合法用法。

import type { PromptRule, RuleAction } from './types';

export interface RuleConflict {
  kind: 'preset-override' | 'skill-stacking' | 'block-unreachable' | 'replace-cascade' | 'duplicate-name';
  /** 涉及的规则 id（按优先级序） */
  ruleIds: string[];
  ruleNames: string[];
  detail: string;
}

export function detectRuleConflicts(rules: PromptRule[]): RuleConflict[] {
  const conflicts: RuleConflict[] = [];
  const active = [...rules]
    .filter((r) => r.enabled)
    .sort((a, b) => (a.priority - b.priority) || a.id.localeCompare(b.id));

  const withAction = (kind: RuleAction['kind']) =>
    active.filter((r) => r.actions.some((a) => a.kind === kind));

  // preset-override
  const presetSetters = withAction('set-preset');
  if (presetSetters.length > 1) {
    const distinct = new Set(presetSetters.flatMap((r) =>
      r.actions.filter((a) => a.kind === 'set-preset').map((a) => String((a as { presetId: string | null }).presetId))));
    if (distinct.size > 1) {
      conflicts.push({
        kind: 'preset-override',
        ruleIds: presetSetters.map((r) => r.id),
        ruleNames: presetSetters.map((r) => r.name),
        detail: `${presetSetters.length} 条规则设置不同 preset —— 同轮命中时后执行者覆盖先执行者（按优先级 ${presetSetters.map((r) => r.priority).join(' → ')}）`,
      });
    }
  }

  // skill-stacking
  const skillEnablers = withAction('enable-skill');
  if (skillEnablers.length > 1) {
    conflicts.push({
      kind: 'skill-stacking',
      ruleIds: skillEnablers.map((r) => r.id),
      ruleNames: skillEnablers.map((r) => r.name),
      detail: '多条规则启用 Skill —— 同轮命中时会叠加 /command 前缀，只有最先执行的按预期展开',
    });
  }

  // block-unreachable：block 规则之后的规则可能因阻断永不执行
  const firstBlockIndex = active.findIndex((r) => r.actions.some((a) => a.kind === 'block-send'));
  if (firstBlockIndex >= 0 && firstBlockIndex < active.length - 1) {
    const blocker = active[firstBlockIndex];
    const shadowed = active.slice(firstBlockIndex + 1).filter((r) => sharesConditionKind(blocker, r));
    if (shadowed.length > 0) {
      conflicts.push({
        kind: 'block-unreachable',
        ruleIds: [blocker.id, ...shadowed.map((r) => r.id)],
        ruleNames: [blocker.name, ...shadowed.map((r) => r.name)],
        detail: `「${blocker.name}」的 block-send 与后续 ${shadowed.length} 条规则条件类型重叠 —— 同时命中时后者不会执行`,
      });
    }
  }

  // replace-cascade
  const replacers = withAction('replace-prompt');
  if (replacers.length > 1) {
    conflicts.push({
      kind: 'replace-cascade',
      ruleIds: replacers.map((r) => r.id),
      ruleNames: replacers.map((r) => r.name),
      detail: '多条规则替换 Prompt —— 结果依赖执行顺序，请确认优先级符合预期',
    });
  }

  // duplicate-name
  const byName = new Map<string, PromptRule[]>();
  for (const rule of rules) {
    const key = rule.name.trim().toLowerCase();
    byName.set(key, [...(byName.get(key) ?? []), rule]);
  }
  for (const group of byName.values()) {
    if (group.length > 1) {
      conflicts.push({
        kind: 'duplicate-name',
        ruleIds: group.map((r) => r.id),
        ruleNames: group.map((r) => r.name),
        detail: '规则重名，日志中难以区分',
      });
    }
  }

  return conflicts;
}

/** 保守的条件重叠判定：存在同 kind 的条件即视为可能同时命中 */
function sharesConditionKind(a: PromptRule, b: PromptRule): boolean {
  const kinds = new Set(a.conditions.map((c) => c.kind));
  return b.conditions.some((c) => kinds.has(c.kind));
}
