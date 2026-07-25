// DWPlus Studio — 统一开发者/高级用户工作台壳层。
// 产品层整合：Overview / Prompt / Memory / Insights / Rules / Diagnostics / Settings
// 七个子页共用一套导航（sub-tabs 模式，同 CapabilitiesPage）与一个数据 Provider
// （缓存共享，不重复取数）。Memory/Insights/Rules 直接复用既有页面组件 ——
// 资料页与能力页的既有入口保持不变（双入口，同组件同缓存）。

import { lazy, Suspense, useState } from 'react';
import type { LocaleMessageKey } from '../../../core/i18n';
import { StudioDataProvider } from './data-provider';
import { useI18n } from '../i18n';

type StudioSubTab = 'overview' | 'prompt' | 'memory' | 'insights' | 'rules' | 'diagnostics' | 'settings';

const SUB_TABS: { key: StudioSubTab; labelKey: LocaleMessageKey }[] = [
  { key: 'overview', labelKey: 'sidepanel.studio.tabs.overview' },
  { key: 'prompt', labelKey: 'sidepanel.studio.tabs.prompt' },
  { key: 'memory', labelKey: 'sidepanel.studio.tabs.memory' },
  { key: 'insights', labelKey: 'sidepanel.studio.tabs.insights' },
  { key: 'rules', labelKey: 'sidepanel.studio.tabs.rules' },
  { key: 'diagnostics', labelKey: 'sidepanel.studio.tabs.diagnostics' },
  { key: 'settings', labelKey: 'sidepanel.studio.tabs.settings' },
];

const OverviewPage = lazy(() => import('./OverviewPage'));
const PromptStudioPage = lazy(() => import('./PromptStudioPage'));
const MemoryStudioPage = lazy(() => import('../pages/MemoryStudioPage'));
const InsightsPage = lazy(() => import('../pages/InsightsPage'));
const RuleEnginePage = lazy(() => import('../pages/RuleEnginePage'));
const DiagnosticsPage = lazy(() => import('./DiagnosticsPage'));
const StudioSettingsPage = lazy(() => import('./StudioSettingsPage'));

export default function StudioPage() {
  const [sub, setSub] = useState<StudioSubTab>('overview');
  const { t } = useI18n();

  return (
    <StudioDataProvider>
      <div className="flex flex-col h-full" data-testid="studio-shell">
        <nav className="sub-tabs" aria-label={t('sidepanel.studio.navLabel')}>
          {SUB_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setSub(tab.key)}
              className={`sub-tab${sub === tab.key ? ' sub-tab-active' : ''}`}
              data-testid={`studio-tab-${tab.key}`}
            >
              {t(tab.labelKey)}
            </button>
          ))}
        </nav>

        <div className="flex-1 overflow-y-auto">
          <Suspense fallback={<div className="p-4 text-sm" style={{ color: 'var(--ds-text-tertiary)' }}>{t('common.loading')}</div>}>
            {sub === 'overview' && <OverviewPage />}
            {sub === 'prompt' && <PromptStudioPage />}
            {sub === 'memory' && <MemoryStudioPage />}
            {sub === 'insights' && <InsightsPage />}
            {sub === 'rules' && <RuleEnginePage />}
            {sub === 'diagnostics' && <DiagnosticsPage />}
            {sub === 'settings' && <StudioSettingsPage />}
          </Suspense>
        </div>
      </div>
    </StudioDataProvider>
  );
}
