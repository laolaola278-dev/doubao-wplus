// Studio Overview — 总览页。
// 全部数据来自共享缓存/既有通道：insights 今日聚合 + 规则执行日志 + 宿主诊断摘要。
// Health Score 为预留卡位（tone 状态色已支持，算法后续接入）。

import { useEffect, useMemo, useState } from 'react';
import { aggregateRange } from '../../../core/insights/aggregate';
import type { RuleExecutionLogEntry } from '../../../core/rules/execution-log';
import StatCard from '../components/studio/StatCard';
import { useStudioInsights } from './data-provider';
import { useI18n } from '../i18n';

interface HostDiagnostics {
  hostTabAvailable: boolean;
  selfCheck: { passed?: boolean; errorCount?: number; warnCount?: number } | null;
}

export default function OverviewPage() {
  const { t } = useI18n();
  const [state] = useStudioInsights();
  const [ruleLog, setRuleLog] = useState<RuleExecutionLogEntry[]>([]);
  const [hostDiag, setHostDiag] = useState<HostDiagnostics | null>(null);

  useEffect(() => {
    chrome.runtime.sendMessage({ type: 'GET_RULE_EXECUTION_LOG' })
      .then((entries: RuleExecutionLogEntry[] | undefined) => setRuleLog(entries ?? []))
      .catch(() => setRuleLog([]));
    chrome.runtime.sendMessage({ type: 'GET_STUDIO_HOST_DIAGNOSTICS' })
      .then((response: (HostDiagnostics & { ok?: boolean }) | undefined) => {
        if (response?.ok) setHostDiag(response);
      })
      .catch(() => undefined);
  }, []);

  const today = useMemo(() => aggregateRange(state, 'today', Date.now()), [state]);

  const topHost = useMemo(() => {
    const entries = Object.entries(today.hostCounts);
    if (entries.length === 0) return '—';
    entries.sort((a, b) => b[1] - a[1]);
    return entries.map(([host, count]) => `${host} ${count}`).join(' · ');
  }, [today]);

  const recentRuleEntries = ruleLog.slice(0, 3);

  return (
    <div className="p-4 space-y-3 overflow-y-auto" data-testid="studio-overview">
      {/* 今日核心指标 */}
      <div className="grid grid-cols-2 gap-2" data-testid="studio-overview-cards">
        <StatCard
          label={t('sidepanel.studio.overview.todayPrompts')}
          value={String(today.promptCount)}
        />
        <StatCard
          label={t('sidepanel.studio.overview.memoryHits')}
          value={String(today.memoryHitPromptCount)}
          hint={t('sidepanel.studio.overview.memoryHitsHint', { uses: today.memoryUseCount })}
        />
        <StatCard
          label={t('sidepanel.studio.overview.skillUses')}
          value={String(today.skillHitPromptCount)}
        />
        <StatCard
          label={t('sidepanel.studio.overview.host')}
          value={topHost}
        />
        {/* Health Score 预留位：算法接入前显示 N/A */}
        <StatCard
          label={t('sidepanel.studio.overview.healthScore')}
          value={t('sidepanel.studio.overview.healthScorePending')}
          hint={t('sidepanel.studio.overview.healthScoreHint')}
        />
        <StatCard
          label={t('sidepanel.studio.overview.selfCheck')}
          value={
            hostDiag?.selfCheck
              ? hostDiag.selfCheck.passed
                ? t('sidepanel.studio.overview.selfCheckPassed')
                : t('sidepanel.studio.overview.selfCheckIssues', {
                  errors: hostDiag.selfCheck.errorCount ?? 0,
                  warns: hostDiag.selfCheck.warnCount ?? 0,
                })
              : '—'
          }
          tone={hostDiag?.selfCheck ? (hostDiag.selfCheck.passed ? 'good' : 'warn') : 'default'}
          hint={hostDiag?.hostTabAvailable === false ? t('sidepanel.studio.overview.noHostTab') : undefined}
        />
      </div>

      {/* 最近诊断（规则执行日志摘要） */}
      <div className="ds-card rounded-xl p-3 space-y-2" data-testid="studio-overview-recent">
        <div className="text-xs font-medium" style={{ color: 'var(--ds-text)' }}>
          {t('sidepanel.studio.overview.recentDiagnostics')}
        </div>
        {recentRuleEntries.length === 0 ? (
          <div className="text-xs" style={{ color: 'var(--ds-text-secondary)' }}>
            {t('sidepanel.studio.overview.recentEmpty')}
          </div>
        ) : recentRuleEntries.map((entry, i) => (
          <div key={i} className="text-xs rounded-lg p-2" style={{ background: 'var(--ds-surface)', color: 'var(--ds-text-secondary)' }}>
            {new Date(entry.timestamp).toLocaleTimeString()} · {entry.hostId} ·{' '}
            {entry.blocked
              ? t('sidepanel.studio.overview.ruleBlocked')
              : t('sidepanel.studio.overview.ruleMatched', { count: entry.records.filter((r) => r.matched).length })}
            {typeof entry.durationMs === 'number' ? ` · ${entry.durationMs}ms` : ''}
          </div>
        ))}
      </div>
    </div>
  );
}
