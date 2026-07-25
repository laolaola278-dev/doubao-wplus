import { useEffect, useMemo, useState } from 'react';
import type { PromptRule, RuleEngineConfig } from '../../../core/rules/types';
import { EMPTY_RULE_ENGINE_CONFIG, validateRule } from '../../../core/rules/types';
import { detectRuleConflicts } from '../../../core/rules/conflicts';
import type { RuleExecutionLogEntry } from '../../../core/rules/execution-log';
import PageIntro from '../components/PageIntro';
import { useI18n } from '../i18n';

// Rule Engine 编辑器 — 规则列表 / 启停 / 优先级 / JSON 编辑 / 冲突提示 / 执行日志。
// 条件与动作采用 JSON 文本编辑（声明式 DSL 的直接呈现）：
// 保存前经 validateRule fail-fast 校验，坏规则不入库。

interface EditorState {
  id: string | null; // null = 新建
  name: string;
  priority: string;
  match: 'all' | 'any';
  conditionsJson: string;
  actionsJson: string;
  stopOnMatch: boolean;
}

const EMPTY_EDITOR: EditorState = {
  id: null,
  name: '',
  priority: '100',
  match: 'all',
  conditionsJson: '[\n  { "kind": "keyword", "keywords": ["Python"] }\n]',
  actionsJson: '[\n  { "kind": "append-prompt", "position": "after", "text": "请给出可运行的完整代码。" }\n]',
  stopOnMatch: false,
};

export default function RuleEnginePage() {
  const { t } = useI18n();
  const [config, setConfig] = useState<RuleEngineConfig>(EMPTY_RULE_ENGINE_CONFIG);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [log, setLog] = useState<RuleExecutionLogEntry[]>([]);
  const [showLog, setShowLog] = useState(false);
  const [variablesText, setVariablesText] = useState('');

  const load = async () => {
    const loaded: RuleEngineConfig = await chrome.runtime.sendMessage({ type: 'GET_RULE_ENGINE_CONFIG' });
    setConfig(loaded ?? EMPTY_RULE_ENGINE_CONFIG);
    setVariablesText(Object.entries(loaded?.variables ?? {}).map(([k, v]) => `${k}=${v}`).join('\n'));
  };

  useEffect(() => { void load(); }, []);

  const conflicts = useMemo(() => detectRuleConflicts(config.rules), [config.rules]);
  const sortedRules = useMemo(
    () => [...config.rules].sort((a, b) => (a.priority - b.priority) || a.id.localeCompare(b.id)),
    [config.rules],
  );

  const openEditor = (rule: PromptRule | null) => {
    setEditorError(null);
    setEditor(rule
      ? {
        id: rule.id,
        name: rule.name,
        priority: String(rule.priority),
        match: rule.match,
        conditionsJson: JSON.stringify(rule.conditions, null, 2),
        actionsJson: JSON.stringify(rule.actions, null, 2),
        stopOnMatch: rule.stopOnMatch ?? false,
      }
      : { ...EMPTY_EDITOR });
  };

  const saveEditor = async () => {
    if (!editor) return;
    let conditions: unknown, actions: unknown;
    try {
      conditions = JSON.parse(editor.conditionsJson);
      actions = JSON.parse(editor.actionsJson);
    } catch (err) {
      setEditorError(t('sidepanel.ruleEngine.editorInvalid', { errors: `JSON 解析失败：${err instanceof Error ? err.message : String(err)}` }));
      return;
    }
    const existing = editor.id ? config.rules.find((r) => r.id === editor.id) : null;
    const rule: PromptRule = {
      id: editor.id ?? crypto.randomUUID(),
      name: editor.name.trim(),
      enabled: existing?.enabled ?? true,
      priority: Number(editor.priority),
      match: editor.match,
      conditions: conditions as PromptRule['conditions'],
      actions: actions as PromptRule['actions'],
      stopOnMatch: editor.stopOnMatch,
      createdAt: existing?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
    };
    const validation = validateRule(rule);
    if (!validation.ok) {
      setEditorError(t('sidepanel.ruleEngine.editorInvalid', { errors: validation.errors.join('；') }));
      return;
    }
    const response = await chrome.runtime.sendMessage({ type: 'UPSERT_RULE', payload: rule }) as { ok?: boolean; errors?: string[] };
    if (!response?.ok) {
      setEditorError(t('sidepanel.ruleEngine.editorInvalid', { errors: (response?.errors ?? []).join('；') }));
      return;
    }
    setEditor(null);
    void load();
  };

  const toggleRule = async (rule: PromptRule) => {
    await chrome.runtime.sendMessage({ type: 'SET_RULE_ENABLED', payload: { ruleId: rule.id, enabled: !rule.enabled } });
    void load();
  };

  const removeRule = async (rule: PromptRule) => {
    await chrome.runtime.sendMessage({ type: 'DELETE_RULE', payload: { ruleId: rule.id } });
    void load();
  };

  const saveVariables = async () => {
    const variables: Record<string, string> = {};
    for (const line of variablesText.split('\n')) {
      const eq = line.indexOf('=');
      if (eq > 0) variables[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
    }
    await chrome.runtime.sendMessage({ type: 'SAVE_RULE_ENGINE_CONFIG', payload: { ...config, variables } });
    void load();
  };

  const refreshLog = async () => {
    const entries: RuleExecutionLogEntry[] = await chrome.runtime.sendMessage({ type: 'GET_RULE_EXECUTION_LOG' });
    setLog(entries ?? []);
  };

  const enabledCount = config.rules.filter((r) => r.enabled).length;

  return (
    <div className="p-4 space-y-3" data-testid="rule-engine">
      <PageIntro
        title={t('sidepanel.ruleEngine.title')}
        description={t('sidepanel.ruleEngine.description')}
        meta={t('sidepanel.ruleEngine.count', { count: config.rules.length, enabled: enabledCount })}
      />

      <div className="flex gap-1.5 flex-wrap items-center text-xs">
        <button onClick={() => openEditor(null)} className="ds-btn-primary px-3 py-1.5 font-medium text-white rounded-lg" data-testid="rule-create">
          {t('sidepanel.ruleEngine.create')}
        </button>
        <button
          onClick={() => { setShowLog(!showLog); if (!showLog) void refreshLog(); }}
          className="px-2.5 py-1.5 rounded-lg"
          style={{ border: '1px solid var(--ds-border)', color: showLog ? 'var(--ds-blue)' : 'var(--ds-text-secondary)' }}
          data-testid="rule-log-toggle"
        >
          {t('sidepanel.ruleEngine.log')}
        </button>
        <span style={{ color: conflicts.length > 0 ? 'var(--ds-warning, #d97706)' : 'var(--ds-text-secondary)' }} data-testid="rule-conflicts">
          {conflicts.length > 0
            ? t('sidepanel.ruleEngine.conflicts', { count: conflicts.length })
            : t('sidepanel.ruleEngine.noConflicts')}
        </span>
      </div>

      {conflicts.length > 0 && (
        <div className="space-y-1 text-xs" data-testid="rule-conflict-list">
          {conflicts.map((c, i) => (
            <div key={i} className="px-2.5 py-1.5 rounded-lg" style={{ background: 'var(--ds-surface)', color: 'var(--ds-text-secondary)' }}>
              <span style={{ color: 'var(--ds-warning, #d97706)' }}>[{c.kind}]</span> {c.ruleNames.join(' → ')}：{c.detail}
            </div>
          ))}
        </div>
      )}

      {/* 执行日志 */}
      {showLog && (
        <div className="ds-card rounded-xl p-3 space-y-2 text-xs" data-testid="rule-log-panel">
          <div className="flex gap-1.5">
            <button onClick={() => void refreshLog()} className="px-2.5 py-1 rounded-lg" style={{ border: '1px solid var(--ds-border)', color: 'var(--ds-text-secondary)' }}>
              ↻
            </button>
            <button
              onClick={async () => { await chrome.runtime.sendMessage({ type: 'CLEAR_RULE_EXECUTION_LOG' }); void refreshLog(); }}
              className="px-2.5 py-1 rounded-lg" style={{ border: '1px solid var(--ds-border)', color: 'var(--ds-text-secondary)' }}
            >
              {t('sidepanel.ruleEngine.clearLog')}
            </button>
          </div>
          {log.length === 0 ? (
            <div style={{ color: 'var(--ds-text-secondary)' }}>{t('sidepanel.ruleEngine.logEmpty')}</div>
          ) : log.map((entry, i) => (
            <div key={i} className="rounded-lg p-2" style={{ background: 'var(--ds-surface)' }}>
              <div style={{ color: 'var(--ds-text)' }}>
                {new Date(entry.timestamp).toLocaleTimeString()} · {entry.hostId} ·{' '}
                {entry.blocked
                  ? <span style={{ color: 'var(--ds-danger, #ef4444)' }}>{t('sidepanel.ruleEngine.logBlocked')}: {entry.blockedReason}</span>
                  : entry.records.some((r) => r.matched)
                    ? t('sidepanel.ruleEngine.logMatched', { count: entry.records.filter((r) => r.matched).length })
                    : t('sidepanel.ruleEngine.logNoMatch')}
              </div>
              <div style={{ color: 'var(--ds-text-secondary)' }}>
                {entry.promptLengthBefore}→{entry.promptLengthAfter} 字符
                {entry.records.filter((r) => r.matched).map((r) => ` · ${r.ruleName}[${r.appliedActions.join(',')}]`).join('')}
                {entry.records.filter((r) => r.error).map((r) => ` · ⚠${r.ruleName}: ${r.error}`).join('')}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 编辑器 */}
      {editor && (
        <div className="ds-card rounded-xl p-3 space-y-2 text-xs" data-testid="rule-editor">
          <input
            value={editor.name}
            onChange={(e) => setEditor({ ...editor, name: e.target.value })}
            placeholder={t('sidepanel.ruleEngine.editorName')}
            className="w-full px-2.5 py-1.5 rounded-lg"
            style={{ background: 'var(--ds-surface)', border: '1px solid var(--ds-border)', color: 'var(--ds-text)' }}
            data-testid="rule-editor-name"
          />
          <div className="flex gap-1.5">
            <label className="flex items-center gap-1" style={{ color: 'var(--ds-text-secondary)' }}>
              {t('sidepanel.ruleEngine.editorPriority')}
              <input
                type="number"
                value={editor.priority}
                onChange={(e) => setEditor({ ...editor, priority: e.target.value })}
                className="w-20 px-2 py-1 rounded-lg"
                style={{ background: 'var(--ds-surface)', border: '1px solid var(--ds-border)', color: 'var(--ds-text)' }}
                data-testid="rule-editor-priority"
              />
            </label>
            <select
              value={editor.match}
              onChange={(e) => setEditor({ ...editor, match: e.target.value as 'all' | 'any' })}
              className="px-2 py-1 rounded-lg"
              style={{ background: 'var(--ds-surface)', border: '1px solid var(--ds-border)', color: 'var(--ds-text)' }}
            >
              <option value="all">{t('sidepanel.ruleEngine.editorMatchAll')}</option>
              <option value="any">{t('sidepanel.ruleEngine.editorMatchAny')}</option>
            </select>
            <label className="flex items-center gap-1" style={{ color: 'var(--ds-text-secondary)' }}>
              <input
                type="checkbox"
                checked={editor.stopOnMatch}
                onChange={(e) => setEditor({ ...editor, stopOnMatch: e.target.checked })}
              />
              {t('sidepanel.ruleEngine.editorStopOnMatch')}
            </label>
          </div>
          <div style={{ color: 'var(--ds-text-secondary)' }}>{t('sidepanel.ruleEngine.editorConditions')}</div>
          <textarea
            value={editor.conditionsJson}
            onChange={(e) => setEditor({ ...editor, conditionsJson: e.target.value })}
            rows={5}
            className="w-full px-2.5 py-1.5 rounded-lg font-mono"
            style={{ background: 'var(--ds-surface)', border: '1px solid var(--ds-border)', color: 'var(--ds-text)' }}
            data-testid="rule-editor-conditions"
          />
          <div style={{ color: 'var(--ds-text-secondary)' }}>{t('sidepanel.ruleEngine.editorActions')}</div>
          <textarea
            value={editor.actionsJson}
            onChange={(e) => setEditor({ ...editor, actionsJson: e.target.value })}
            rows={5}
            className="w-full px-2.5 py-1.5 rounded-lg font-mono"
            style={{ background: 'var(--ds-surface)', border: '1px solid var(--ds-border)', color: 'var(--ds-text)' }}
            data-testid="rule-editor-actions"
          />
          <div style={{ color: 'var(--ds-text-secondary)' }}>{t('sidepanel.ruleEngine.editorHint')}</div>
          {editorError && (
            <div style={{ color: 'var(--ds-danger, #ef4444)' }} data-testid="rule-editor-error">{editorError}</div>
          )}
          <div className="flex gap-1.5">
            <button onClick={() => void saveEditor()} className="ds-btn-primary px-3 py-1.5 text-white rounded-lg" data-testid="rule-editor-save">
              {t('sidepanel.ruleEngine.editorSave')}
            </button>
            <button onClick={() => setEditor(null)} className="px-3 py-1.5 rounded-lg" style={{ border: '1px solid var(--ds-border)', color: 'var(--ds-text-secondary)' }}>
              {t('sidepanel.ruleEngine.editorCancel')}
            </button>
          </div>
        </div>
      )}

      {/* 规则列表 */}
      {sortedRules.length === 0 ? (
        <div className="ds-empty-state">
          <div className="ds-empty-state-title">{t('sidepanel.ruleEngine.empty')}</div>
          <div className="ds-empty-state-description">{t('sidepanel.ruleEngine.emptyHelp')}</div>
        </div>
      ) : (
        <div className="space-y-2">
          {sortedRules.map((rule) => (
            <div key={rule.id} className="ds-card rounded-xl p-3 flex items-start gap-2" data-testid="rule-row">
              <input
                type="checkbox"
                checked={rule.enabled}
                onChange={() => void toggleRule(rule)}
                className="mt-0.5 shrink-0"
                title={rule.enabled ? t('common.enabled') : t('common.disabled')}
                data-testid="rule-row-toggle"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[13px] font-medium" style={{ color: rule.enabled ? 'var(--ds-text)' : 'var(--ds-text-secondary)' }}>
                    {rule.name}
                  </span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-md" style={{ background: 'var(--ds-surface)', color: 'var(--ds-text-secondary)', border: '1px solid var(--ds-border)' }}>
                    {t('sidepanel.ruleEngine.priority', { value: rule.priority })}
                  </span>
                  {rule.stopOnMatch && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-md" style={{ background: 'var(--ds-blue-light)', color: 'var(--ds-blue)' }}>
                      {t('sidepanel.ruleEngine.stopOnMatch')}
                    </span>
                  )}
                </div>
                <div className="text-xs mt-0.5" style={{ color: 'var(--ds-text-secondary)' }}>
                  {rule.conditions.map((c) => c.kind).join(rule.match === 'all' ? ' ∧ ' : ' ∨ ')} → {rule.actions.map((a) => a.kind).join(', ')}
                </div>
              </div>
              <div className="flex gap-1 shrink-0 text-xs">
                <button onClick={() => openEditor(rule)} className="px-1.5 py-0.5 rounded" style={{ color: 'var(--ds-text-secondary)' }}>
                  {t('common.edit')}
                </button>
                <button onClick={() => void removeRule(rule)} className="px-1.5 py-0.5 rounded" style={{ color: 'var(--ds-danger, #ef4444)' }}>
                  {t('common.delete')}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 自定义变量 */}
      <div className="ds-card rounded-xl p-3 space-y-1.5 text-xs">
        <div style={{ color: 'var(--ds-text)' }}>{t('sidepanel.ruleEngine.variables')}</div>
        <div style={{ color: 'var(--ds-text-secondary)' }}>{t('sidepanel.ruleEngine.variablesHint')}</div>
        <textarea
          value={variablesText}
          onChange={(e) => setVariablesText(e.target.value)}
          rows={3}
          className="w-full px-2.5 py-1.5 rounded-lg font-mono"
          style={{ background: 'var(--ds-surface)', border: '1px solid var(--ds-border)', color: 'var(--ds-text)' }}
          data-testid="rule-variables"
        />
        <button onClick={() => void saveVariables()} className="px-2.5 py-1 rounded-lg" style={{ border: '1px solid var(--ds-border)', color: 'var(--ds-text-secondary)' }}>
          {t('sidepanel.ruleEngine.variablesSave')}
        </button>
      </div>
    </div>
  );
}
