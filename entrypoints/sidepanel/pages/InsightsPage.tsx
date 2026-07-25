// AI Insights Dashboard — 本地使用统计。
// 数据来自 background 的日桶 state（GET_INSIGHTS_STATE），聚合在本页纯函数完成。
// 数据访问经 Studio Provider hook（缓存共享；Provider 缺席时退化直取）。
// 隐私：展示/导出内容只有行为标量（计数/长度/耗时/id/skill 名），全部本地，无上传。

import { useMemo, useState } from 'react';
import {
  aggregateRange,
  type InsightsRange,
  type InsightsSummary,
} from '../../../core/insights/aggregate';
import { buildInsightsCsvExport, buildInsightsJsonExport } from '../../../core/insights/export';
import PageIntro from '../components/PageIntro';
import LineChart from '../components/studio/charts/LineChart';
import BarChart from '../components/studio/charts/BarChart';
import DonutChart from '../components/studio/charts/DonutChart';
import Heatmap from '../components/studio/charts/Heatmap';
import StatCard from '../components/studio/StatCard';
import ExportMenu from '../components/studio/ExportMenu';
import { useStudioInsights, useStudioMemories } from '../studio/data-provider';
import { useI18n } from '../i18n';

const RANGES: InsightsRange[] = ['today', 'week', 'month', 'all'];

export default function InsightsPage() {
  const { t } = useI18n();
  const [state, reloadInsights] = useStudioInsights();
  const [range, setRange] = useState<InsightsRange>('today');
  const [memories] = useStudioMemories();

  // memory 榜只存 id；名称映射从共享缓存派生（已删除的显示占位）
  const memoryNames = useMemo(() => {
    const names: Record<string, string> = {};
    for (const m of memories) {
      if (m.id != null) names[String(m.id)] = m.name;
    }
    return names;
  }, [memories]);

  const summary: InsightsSummary = useMemo(
    () => aggregateRange(state, range, Date.now()),
    [state, range],
  );

  const weekdayLabels = [
    t('sidepanel.insights.weekdays.mon'),
    t('sidepanel.insights.weekdays.tue'),
    t('sidepanel.insights.weekdays.wed'),
    t('sidepanel.insights.weekdays.thu'),
    t('sidepanel.insights.weekdays.fri'),
    t('sidepanel.insights.weekdays.sat'),
    t('sidepanel.insights.weekdays.sun'),
  ];

  const exportTargets = [
    {
      key: 'json',
      label: t('sidepanel.insights.exportJson'),
      mime: 'application/json',
      filename: () => `wplus-insights-${new Date().toISOString().slice(0, 10)}.json`,
      build: () => JSON.stringify(buildInsightsJsonExport(state, Date.now()), null, 2),
    },
    {
      key: 'csv',
      label: t('sidepanel.insights.exportCsv'),
      mime: 'text/csv',
      filename: () => `wplus-insights-${new Date().toISOString().slice(0, 10)}.csv`,
      build: () => buildInsightsCsvExport(state),
    },
  ];

  const clearAll = async () => {
    if (!window.confirm(t('sidepanel.insights.clearConfirm'))) return;
    await chrome.runtime.sendMessage({ type: 'CLEAR_INSIGHTS' });
    void reloadInsights();
  };

  const pct = (value: number) => `${Math.round(value * 100)}%`;
  const ms = (value: number) => `${value.toFixed(1)}ms`;

  const cards: Array<{ label: string; value: string; hint?: string }> = [
    { label: t('sidepanel.insights.cardPrompts'), value: String(summary.promptCount) },
    {
      label: t('sidepanel.insights.cardMemoryHitRate'),
      value: pct(summary.memoryHitRate),
      hint: t('sidepanel.insights.cardMemoryHitHint', { hits: summary.memoryHitPromptCount, uses: summary.memoryUseCount }),
    },
    {
      label: t('sidepanel.insights.cardSkillHitRate'),
      value: pct(summary.skillHitRate),
      hint: t('sidepanel.insights.cardSkillHitHint', { hits: summary.skillHitPromptCount }),
    },
    { label: t('sidepanel.insights.cardPresetUses'), value: String(summary.presetUseCount) },
    {
      label: t('sidepanel.insights.cardAvgLength'),
      value: String(Math.round(summary.avgOriginalLength)),
      hint: t('sidepanel.insights.cardMaxLength', { max: summary.maxOriginalLength }),
    },
  ];

  const perfRows: Array<{ label: string; stat: InsightsSummary['perf']['augment'] }> = [
    { label: t('sidepanel.insights.perfAugment'), stat: summary.perf.augment },
    { label: t('sidepanel.insights.perfMemory'), stat: summary.perf.memory },
    { label: t('sidepanel.insights.perfRules'), stat: summary.perf.rules },
  ];

  return (
    <div className="p-4 space-y-3 overflow-y-auto" data-testid="insights-page">
      <PageIntro
        title={t('sidepanel.insights.title')}
        description={t('sidepanel.insights.description')}
        meta={t('sidepanel.insights.privacyNote')}
      />

      {/* 范围切换 + 导出/清空 */}
      <div className="flex gap-1.5 flex-wrap items-center text-xs">
        {RANGES.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setRange(r)}
            className="px-2.5 py-1.5 rounded-lg"
            style={{
              border: '1px solid var(--ds-border)',
              color: range === r ? 'var(--ds-blue)' : 'var(--ds-text-secondary)',
            }}
            data-testid={`insights-range-${r}`}
          >
            {t(`sidepanel.insights.range.${r}` as never)}
          </button>
        ))}
        <span className="flex-1" />
        <ExportMenu targets={exportTargets} testIdPrefix="insights-export" />
        <button type="button" onClick={() => void clearAll()} className="px-2.5 py-1.5 rounded-lg" style={{ border: '1px solid var(--ds-border)', color: 'var(--ds-danger, #ef4444)' }} data-testid="insights-clear">
          {t('sidepanel.insights.clear')}
        </button>
      </div>

      {summary.promptCount === 0 ? (
        <div className="ds-card rounded-xl p-6 text-center text-xs" style={{ color: 'var(--ds-text-secondary)' }} data-testid="insights-empty">
          {t('sidepanel.insights.empty')}
        </div>
      ) : (
        <>
          {/* 概览卡片 */}
          <div className="grid grid-cols-2 gap-2" data-testid="insights-cards">
            {cards.map((card) => (
              <StatCard key={card.label} label={card.label} value={card.value} hint={card.hint} />
            ))}
          </div>

          {/* 趋势 */}
          {summary.dailyTrend.length > 1 && (
            <div className="ds-card rounded-xl p-3 space-y-2">
              <div className="text-xs font-medium" style={{ color: 'var(--ds-text)' }}>{t('sidepanel.insights.trend')}</div>
              <LineChart points={summary.dailyTrend.map((d) => ({ label: d.date.slice(5), value: d.count }))} />
            </div>
          )}

          {/* Host 占比 */}
          {Object.keys(summary.hostCounts).length > 0 && (
            <div className="ds-card rounded-xl p-3 space-y-2">
              <div className="text-xs font-medium" style={{ color: 'var(--ds-text)' }}>{t('sidepanel.insights.hosts')}</div>
              <DonutChart items={Object.entries(summary.hostCounts).map(([label, value]) => ({ label, value }))} />
            </div>
          )}

          {/* Skill 排行 */}
          {summary.topSkills.length > 0 && (
            <div className="ds-card rounded-xl p-3 space-y-2">
              <div className="text-xs font-medium" style={{ color: 'var(--ds-text)' }}>{t('sidepanel.insights.topSkills')}</div>
              <BarChart items={summary.topSkills.map((s) => ({ label: s.key, value: s.count }))} />
            </div>
          )}

          {/* 最常用 Memory */}
          {summary.topMemories.length > 0 && (
            <div className="ds-card rounded-xl p-3 space-y-2">
              <div className="text-xs font-medium" style={{ color: 'var(--ds-text)' }}>{t('sidepanel.insights.topMemories')}</div>
              <BarChart
                color="#10b981"
                items={summary.topMemories.map((m) => ({
                  label: memoryNames[m.key] ?? t('sidepanel.insights.deletedMemory', { id: m.key }),
                  value: m.count,
                }))}
              />
            </div>
          )}

          {/* 活跃热力图 */}
          <div className="ds-card rounded-xl p-3 space-y-2">
            <div className="text-xs font-medium" style={{ color: 'var(--ds-text)' }}>{t('sidepanel.insights.heatmap')}</div>
            <Heatmap matrix={summary.weekdayHourly} weekdayLabels={weekdayLabels} />
          </div>

          {/* Performance */}
          <div className="ds-card rounded-xl p-3 space-y-2" data-testid="insights-perf">
            <div className="text-xs font-medium" style={{ color: 'var(--ds-text)' }}>{t('sidepanel.insights.perf')}</div>
            <table className="w-full text-xs">
              <thead>
                <tr style={{ color: 'var(--ds-text-tertiary)' }}>
                  <th className="text-left font-normal">{t('sidepanel.insights.perfStage')}</th>
                  <th className="text-right font-normal">{t('sidepanel.insights.perfAvg')}</th>
                  <th className="text-right font-normal">{t('sidepanel.insights.perfMax')}</th>
                  <th className="text-right font-normal">{t('sidepanel.insights.perfCount')}</th>
                </tr>
              </thead>
              <tbody style={{ color: 'var(--ds-text-secondary)' }}>
                {perfRows.map((row) => (
                  <tr key={row.label}>
                    <td>{row.label}</td>
                    <td className="text-right">{row.stat.count > 0 ? ms(row.stat.avgMs) : '—'}</td>
                    <td className="text-right">{row.stat.count > 0 ? ms(row.stat.maxMs) : '—'}</td>
                    <td className="text-right">{row.stat.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
