// Studio Diagnostics 页 — 启动自检 + 规则执行日志观测。
// 数据：GET_STUDIO_HOST_DIAGNOSTICS（宿主 tab 只读）+ GET_RULE_EXECUTION_LOG（background）。
// 自检报告 dev-only 生成；生产构建/无宿主 tab 时显示对应空态。

import { useEffect, useState } from 'react';
import type { RuleExecutionLogEntry } from '../../../core/rules/execution-log';
import { useI18n } from '../i18n';

interface SelfCheckItemView {
  id?: string;
  severity?: 'error' | 'warn' | 'info';
  label?: string;
  passed?: boolean;
  detail?: string;
}

interface SelfCheckView {
  hostId?: string;
  timestamp?: number;
  passed?: boolean;
  errorCount?: number;
  warnCount?: number;
  checks?: SelfCheckItemView[];
}

interface HostDiagnosticsResponse {
  ok?: boolean;
  hostTabAvailable?: boolean;
  selfCheck?: SelfCheckView | null;
}

const SEVERITY_COLOR: Record<string, string> = {
  error: 'var(--ds-danger, #ef4444)',
  warn: 'var(--ds-warning, #d97706)',
  info: 'var(--ds-text-tertiary)',
};

export default function DiagnosticsPage() {
  const { t } = useI18n();
  const [loaded, setLoaded] = useState(false);
  const [hostTabAvailable, setHostTabAvailable] = useState(false);
  const [selfCheck, setSelfCheck] = useState<SelfCheckView | null>(null);
  const [ruleLog, setRuleLog] = useState<RuleExecutionLogEntry[]>([]);

  const load = async () => {
    try {
      const [diag, log] = await Promise.all([
        chrome.runtime.sendMessage({ type: 'GET_STUDIO_HOST_DIAGNOSTICS' }) as Promise<HostDiagnosticsResponse | undefined>,
        chrome.runtime.sendMessage({ type: 'GET_RULE_EXECUTION_LOG' }) as Promise<RuleExecutionLogEntry[] | undefined>,
      ]);
      if (diag?.ok) {
        setHostTabAvailable(diag.hostTabAvailable === true);
        setSelfCheck(diag.selfCheck ?? null);
      }
      setRuleLog(log ?? []);
    } catch {
      // 保持空态
    } finally {
      setLoaded(true);
    }
  };

  useEffect(() => { void load(); }, []);

  if (!loaded) return null;

  return (
    <div className="p-4 space-y-3 overflow-y-auto" data-testid="studio-diagnostics">
      <div className="flex gap-1.5 items-center text-xs">
        <button
          type="button"
          onClick={() => void load()}
          className="px-2.5 py-1.5 rounded-lg"
          style={{ border: '1px solid var(--ds-border)', color: 'var(--ds-text-secondary)' }}
          data-testid="studio-diagnostics-refresh"
        >
          ↻ {t('common.refresh')}
        </button>
      </div>

      {/* 启动自检 */}
      <div className="ds-card rounded-xl p-3 space-y-2" data-testid="studio-diagnostics-selfcheck">
        <div className="text-xs font-medium" style={{ color: 'var(--ds-text)' }}>
          {t('sidepanel.studio.diagnostics.selfCheckTitle')}
        </div>
        {!hostTabAvailable ? (
          <div className="text-xs" style={{ color: 'var(--ds-text-secondary)' }} data-testid="studio-diagnostics-no-host">
            {t('sidepanel.studio.prompt.noHostTab')}
          </div>
        ) : !selfCheck ? (
          <div className="text-xs" style={{ color: 'var(--ds-text-secondary)' }} data-testid="studio-diagnostics-dev-only">
            {t('sidepanel.studio.diagnostics.devOnly')}
          </div>
        ) : (
          <>
            <div className="text-xs" style={{ color: selfCheck.passed ? 'var(--ds-success, #10b981)' : 'var(--ds-warning, #d97706)' }}>
              {selfCheck.passed
                ? t('sidepanel.studio.overview.selfCheckPassed')
                : t('sidepanel.studio.overview.selfCheckIssues', { errors: selfCheck.errorCount ?? 0, warns: selfCheck.warnCount ?? 0 })}
              {' · '}{selfCheck.hostId}
              {selfCheck.timestamp ? ` · ${new Date(selfCheck.timestamp).toLocaleTimeString()}` : ''}
            </div>
            {(selfCheck.checks ?? []).map((check, i) => (
              <div key={check.id ?? i} className="text-xs flex items-center gap-1.5" style={{ color: 'var(--ds-text-secondary)' }}>
                <span style={{ color: check.passed ? 'var(--ds-success, #10b981)' : SEVERITY_COLOR[check.severity ?? 'info'] }}>
                  {check.passed ? '✓' : '✗'}
                </span>
                <span>{check.label ?? check.id}</span>
                {!check.passed && check.detail && <span style={{ color: 'var(--ds-text-tertiary)' }}>— {check.detail}</span>}
              </div>
            ))}
          </>
        )}
      </div>

      {/* 规则执行日志（与 RuleEnginePage 同源数据，此处只读展示） */}
      <div className="ds-card rounded-xl p-3 space-y-2" data-testid="studio-diagnostics-rulelog">
        <div className="text-xs font-medium" style={{ color: 'var(--ds-text)' }}>
          {t('sidepanel.studio.diagnostics.ruleLogTitle')}
        </div>
        {ruleLog.length === 0 ? (
          <div className="text-xs" style={{ color: 'var(--ds-text-secondary)' }}>
            {t('sidepanel.ruleEngine.logEmpty')}
          </div>
        ) : ruleLog.slice(0, 10).map((entry, i) => (
          <div key={i} className="text-xs rounded-lg p-2" style={{ background: 'var(--ds-surface)', color: 'var(--ds-text-secondary)' }}>
            {new Date(entry.timestamp).toLocaleTimeString()} · {entry.hostId} ·{' '}
            {entry.blocked
              ? `${t('sidepanel.ruleEngine.logBlocked')}: ${entry.blockedReason}`
              : entry.records.some((r) => r.matched)
                ? t('sidepanel.ruleEngine.logMatched', { count: entry.records.filter((r) => r.matched).length })
                : t('sidepanel.ruleEngine.logNoMatch')}
            {' · '}{entry.promptLengthBefore}→{entry.promptLengthAfter}
            {typeof entry.durationMs === 'number' ? ` · ${entry.durationMs}ms` : ''}
          </div>
        ))}
      </div>
    </div>
  );
}
