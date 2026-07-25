// Studio Settings 页 — 统计数据管理与诊断状态展示。
// 复用 ExportMenu（insights JSON/CSV）+ CLEAR_INSIGHTS 通道；不新增任何配置项存储。

import { useState } from 'react';
import { buildInsightsCsvExport, buildInsightsJsonExport } from '../../../core/insights/export';
import ExportMenu from '../components/studio/ExportMenu';
import { useStudioInsights } from './data-provider';
import { useI18n } from '../i18n';

export default function StudioSettingsPage() {
  const { t } = useI18n();
  const [state, reload] = useStudioInsights();
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const dayCount = Object.keys(state.days).length;

  const clearAll = async () => {
    if (!window.confirm(t('sidepanel.insights.clearConfirm'))) return;
    await chrome.runtime.sendMessage({ type: 'CLEAR_INSIGHTS' });
    await reload();
    setStatusMessage(t('sidepanel.studio.settings.cleared'));
  };

  return (
    <div className="p-4 space-y-3 overflow-y-auto" data-testid="studio-settings">
      {/* 数据管理 */}
      <div className="ds-card rounded-xl p-3 space-y-2">
        <div className="text-xs font-medium" style={{ color: 'var(--ds-text)' }}>
          {t('sidepanel.studio.settings.dataTitle')}
        </div>
        <div className="text-xs" style={{ color: 'var(--ds-text-secondary)' }}>
          {t('sidepanel.studio.settings.dataSummary', {
            days: dayCount,
            prompts: state.total.promptCount,
          })}
        </div>
        <div className="text-xs" style={{ color: 'var(--ds-text-tertiary)' }}>
          {t('sidepanel.insights.privacyNote')}
        </div>
        <div className="flex gap-1.5 flex-wrap text-xs">
          <ExportMenu
            testIdPrefix="studio-settings-export"
            targets={[
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
            ]}
          />
          <button
            type="button"
            onClick={() => void clearAll()}
            className="px-2.5 py-1.5 rounded-lg"
            style={{ border: '1px solid var(--ds-border)', color: 'var(--ds-danger, #ef4444)' }}
            data-testid="studio-settings-clear"
          >
            {t('sidepanel.insights.clear')}
          </button>
        </div>
        {statusMessage && (
          <div className="text-xs" style={{ color: 'var(--ds-text-secondary)' }} data-testid="studio-settings-status">
            {statusMessage}
          </div>
        )}
      </div>

      {/* 开发者工具说明 */}
      <div className="ds-card rounded-xl p-3 space-y-1">
        <div className="text-xs font-medium" style={{ color: 'var(--ds-text)' }}>
          {t('sidepanel.studio.settings.devToolsTitle')}
        </div>
        <div className="text-xs" style={{ color: 'var(--ds-text-secondary)' }}>
          {t('sidepanel.studio.settings.devToolsHint')}
        </div>
      </div>
    </div>
  );
}
