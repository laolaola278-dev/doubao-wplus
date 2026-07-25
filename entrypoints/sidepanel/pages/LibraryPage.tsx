import { useState } from 'react';
import type { LocaleMessageKey } from '../../../core/i18n';
import MemoryStudioPage from './MemoryStudioPage';
import SavedPage from './SavedPage';
import { useI18n } from '../i18n';

type LibrarySubTab = 'memory' | 'saved';

const SUB_TABS: { key: LibrarySubTab; labelKey: LocaleMessageKey }[] = [
  { key: 'memory', labelKey: 'sidepanel.libraryPage.tabs.memory' },
  { key: 'saved', labelKey: 'sidepanel.libraryPage.tabs.saved' },
];

interface LibraryPageProps {
  onInsertPrompt: (text: string) => void;
}

export default function LibraryPage({ onInsertPrompt }: LibraryPageProps) {
  const [sub, setSub] = useState<LibrarySubTab>('memory');
  const { t } = useI18n();

  return (
    <div className="flex flex-col h-full">
      <nav className="sub-tabs" aria-label={t('sidepanel.libraryPage.navLabel')}>
        {SUB_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setSub(tab.key)}
            className={`sub-tab${sub === tab.key ? ' sub-tab-active' : ''}`}
          >
            {t(tab.labelKey)}
          </button>
        ))}
      </nav>

      <div className="flex-1 overflow-y-auto">
        {/* Memory Studio 取代原 MemoryPage：功能超集（列表+搜索+批量+分析+健康） */}
        {sub === 'memory' && <MemoryStudioPage />}
        {sub === 'saved' && <SavedPage onInsertPrompt={onInsertPrompt} />}
      </div>
    </div>
  );
}
