// core/rules/store.ts
// Rule Engine 配置存储 — chrome.storage.local（与 preset/settings 同模式）。
// 保存前强制校验：坏规则不入库（fail-fast）。

import {
  EMPTY_RULE_ENGINE_CONFIG,
  validateRuleEngineConfig,
  type PromptRule,
  type RuleEngineConfig,
} from './types';

const STORAGE_KEY = 'ruleEngineConfig';

export async function getRuleEngineConfig(): Promise<RuleEngineConfig> {
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    const value = stored[STORAGE_KEY];
    if (!value) return EMPTY_RULE_ENGINE_CONFIG;
    const result = validateRuleEngineConfig(value);
    if (!result.ok) {
      // 存储损坏时降级为空配置（不让坏数据进热路径），保留原值供人工修复
      console.warn('[DWPLUS-RULES] 存储的规则配置校验失败，本次按空配置运行：', result.errors.join('；'));
      return EMPTY_RULE_ENGINE_CONFIG;
    }
    return value as RuleEngineConfig;
  } catch {
    return EMPTY_RULE_ENGINE_CONFIG;
  }
}

export async function saveRuleEngineConfig(config: RuleEngineConfig): Promise<{ ok: boolean; errors?: string[] }> {
  const result = validateRuleEngineConfig(config);
  if (!result.ok) return { ok: false, errors: result.errors };
  await chrome.storage.local.set({ [STORAGE_KEY]: config });
  return { ok: true };
}

/** 保存单条规则（新增或更新，按 id 匹配） */
export async function upsertRule(rule: PromptRule): Promise<{ ok: boolean; errors?: string[] }> {
  const config = await getRuleEngineConfig();
  const index = config.rules.findIndex((r) => r.id === rule.id);
  const rules = index >= 0
    ? config.rules.map((r) => (r.id === rule.id ? rule : r))
    : [...config.rules, rule];
  return saveRuleEngineConfig({ ...config, rules });
}

export async function deleteRule(ruleId: string): Promise<{ ok: boolean }> {
  const config = await getRuleEngineConfig();
  await chrome.storage.local.set({
    [STORAGE_KEY]: { ...config, rules: config.rules.filter((r) => r.id !== ruleId) },
  });
  return { ok: true };
}

export async function setRuleEnabled(ruleId: string, enabled: boolean): Promise<{ ok: boolean }> {
  const config = await getRuleEngineConfig();
  await chrome.storage.local.set({
    [STORAGE_KEY]: {
      ...config,
      rules: config.rules.map((r) => (r.id === ruleId ? { ...r, enabled, updatedAt: Date.now() } : r)),
    },
  });
  return { ok: true };
}
