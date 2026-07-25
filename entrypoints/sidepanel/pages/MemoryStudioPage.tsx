import { useMemo, useRef, useState } from 'react';
import type { Memory, NewMemory } from '../../../core/types';
import { analyzeMemoryHits, type MemoryHitAnalysis } from '../../../core/memory/analyzer';
import { runMemoryHealthCheck, type MemoryHealthReport } from '../../../core/memory/health';
import { downloadMemoriesExport, parseMemoriesImport } from '../../../core/memory/portability';
import MemoryForm from '../components/MemoryForm';
import PageIntro from '../components/PageIntro';
import SearchInput from '../components/studio/SearchInput';
import FilterSelect from '../components/studio/FilterSelect';
import { useStudioMemories } from '../studio/data-provider';
import { useI18n } from '../i18n';

// Memory Studio — 记忆管理中心。
// 数据面：全部走既有 background 消息（GET_MEMORIES / SAVE / UPDATE / DELETE /
// DELETE_MEMORIES / IMPORT_MEMORY_DRAFTS），不新增存储路径。
// 数据访问经 Studio Provider hook（双入口共享缓存；Provider 缺席时退化直取）。
// 分析面：analyzer / health 均为纯只读模块，在面板内本地计算。

type SortKey = 'updated' | 'created' | 'hits' | 'recentUse';

const SUGGESTION_KEY = {
  'merge': 'sidepanel.memoryStudio.healthSuggestionMerge',
  'review': 'sidepanel.memoryStudio.healthSuggestionReview',
  'delete-or-pin': 'sidepanel.memoryStudio.healthSuggestionDeleteOrPin',
  'shorten': 'sidepanel.memoryStudio.healthSuggestionShorten',
} as const;

export default function MemoryStudioPage() {
  const { t } = useI18n();
  const [allScopeMemories, reloadMemories] = useStudioMemories();
  const [query, setQuery] = useState('');
  const [tagFilter, setTagFilter] = useState<string>('');
  const [sortKey, setSortKey] = useState<SortKey>('updated');
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [showForm, setShowForm] = useState(false);
  const [editingMemory, setEditingMemory] = useState<Memory | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [analysisPrompt, setAnalysisPrompt] = useState('');
  const [analysis, setAnalysis] = useState<MemoryHitAnalysis | null>(null);
  const [health, setHealth] = useState<MemoryHealthReport | null>(null);
  const [panel, setPanel] = useState<'none' | 'analysis' | 'health'>('none');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 本页只管全局记忆（project 作用域在项目页管理）—— 与原实现一致
  const memories = useMemo(
    () => allScopeMemories.filter((memory) => memory.scope !== 'project'),
    [allScopeMemories],
  );
  const load = reloadMemories;

  const allTags = useMemo(
    () => [...new Set(memories.flatMap((m) => m.tags))].sort(),
    [memories],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = memories;
    if (q) {
      list = list.filter((m) =>
        m.name.toLowerCase().includes(q) ||
        m.content.toLowerCase().includes(q) ||
        m.description.toLowerCase().includes(q) ||
        m.tags.some((tag) => tag.toLowerCase().includes(q)));
    }
    if (tagFilter) {
      list = list.filter((m) => m.tags.includes(tagFilter));
    }
    const sorted = [...list];
    switch (sortKey) {
      case 'created': sorted.sort((a, b) => b.createdAt - a.createdAt); break;
      case 'hits': sorted.sort((a, b) => b.accessCount - a.accessCount); break;
      case 'recentUse': sorted.sort((a, b) => b.lastAccessedAt - a.lastAccessedAt); break;
      default: sorted.sort((a, b) => b.updatedAt - a.updatedAt);
    }
    return sorted;
  }, [memories, query, tagFilter, sortKey]);

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    const visibleIds = filtered.map((m) => m.id!).filter((id) => id != null);
    setSelectedIds((prev) =>
      prev.size === visibleIds.length ? new Set() : new Set(visibleIds));
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!window.confirm(t('sidepanel.memoryStudio.deleteSelectedConfirm', { count: selectedIds.size }))) return;
    await chrome.runtime.sendMessage({ type: 'DELETE_MEMORIES', payload: { ids: [...selectedIds] } });
    setSelectedIds(new Set());
    void load();
  };

  const handleDelete = async (id: number) => {
    await chrome.runtime.sendMessage({ type: 'DELETE_MEMORY', payload: { id } });
    void load();
  };

  const handleSave = async (mem: NewMemory) => {
    if (editingMemory?.id) {
      await chrome.runtime.sendMessage({
        type: 'UPDATE_MEMORY',
        payload: { ...editingMemory, ...mem, updatedAt: Date.now() },
      });
    } else {
      await chrome.runtime.sendMessage({ type: 'SAVE_MEMORY', payload: { ...mem, source: 'user' } });
    }
    setShowForm(false);
    setEditingMemory(null);
    void load();
  };

  const handleExport = () => downloadMemoriesExport(filtered.length > 0 ? filtered : memories);

  const handleImportFile = async (file: File) => {
    const content = await file.text();
    const parsed = parseMemoriesImport(content);
    if (!parsed.ok) {
      setStatusMessage(t('sidepanel.memoryStudio.importFailed', { error: parsed.error ?? '' }));
      return;
    }
    const response = await chrome.runtime.sendMessage({
      type: 'IMPORT_MEMORY_DRAFTS',
      payload: { memories: parsed.memories },
    }) as { ok?: boolean; count?: number; error?: string };
    setStatusMessage(response?.ok
      ? t('sidepanel.memoryStudio.importSuccess', { count: response.count ?? 0 })
      : t('sidepanel.memoryStudio.importFailed', { error: response?.error ?? '' }));
    void load();
  };

  const runAnalysis = () => {
    if (!analysisPrompt.trim()) return;
    setAnalysis(analyzeMemoryHits(analysisPrompt, memories));
  };

  const runHealth = () => setHealth(runMemoryHealthCheck(memories));

  const sourceLabel = (m: Memory) => {
    const source = m.source ?? 'user';
    return source === 'ai-tool'
      ? t('sidepanel.memoryStudio.sourceAiTool')
      : source === 'import'
        ? t('sidepanel.memoryStudio.sourceImport')
        : t('sidepanel.memoryStudio.sourceUser');
  };

  const formatTime = (ts: number) => ts > 0 ? new Date(ts).toLocaleDateString() : t('sidepanel.memoryStudio.never');

  return (
    <div className="p-4 space-y-3" data-testid="memory-studio">
      <PageIntro
        title={t('sidepanel.memoryPage.title')}
        description={t('sidepanel.memoryPage.description')}
        meta={t('sidepanel.memoryPage.count', { count: memories.length })}
      />

      {/* 工具栏：搜索 / 标签 / 排序（共享组件；样式与 testid 不变） */}
      <div className="flex gap-1.5 flex-wrap items-center">
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder={t('sidepanel.memoryStudio.searchPlaceholder')}
          testId="studio-search"
        />
        <FilterSelect
          value={tagFilter}
          onChange={setTagFilter}
          testId="studio-tag-filter"
          options={[
            { value: '', label: t('sidepanel.memoryStudio.allTags') },
            ...allTags.map((tag) => ({ value: tag, label: tag })),
          ]}
        />
        <FilterSelect
          value={sortKey}
          onChange={(value) => setSortKey(value as SortKey)}
          testId="studio-sort"
          options={[
            { value: 'updated', label: t('sidepanel.memoryStudio.sortUpdated') },
            { value: 'created', label: t('sidepanel.memoryStudio.sortCreated') },
            { value: 'hits', label: t('sidepanel.memoryStudio.sortHits') },
            { value: 'recentUse', label: t('sidepanel.memoryStudio.sortRecentUse') },
          ]}
        />
      </div>

      {/* 操作行：新建 / 批删 / 导入导出 / 分析 / 健康 */}
      <div className="flex gap-1.5 flex-wrap items-center text-xs">
        <button onClick={() => { setEditingMemory(null); setShowForm(!showForm); }} className="ds-btn-primary px-3 py-1.5 font-medium text-white rounded-lg">
          {t('common.add')}
        </button>
        <button onClick={toggleSelectAll} className="px-2.5 py-1.5 rounded-lg" style={{ border: '1px solid var(--ds-border)', color: 'var(--ds-text-secondary)' }} data-testid="studio-select-all">
          {t('sidepanel.memoryStudio.selectAll')}
        </button>
        {selectedIds.size > 0 && (
          <button onClick={handleBulkDelete} className="px-2.5 py-1.5 rounded-lg" style={{ border: '1px solid var(--ds-danger, #ef4444)', color: 'var(--ds-danger, #ef4444)' }} data-testid="studio-bulk-delete">
            {t('sidepanel.memoryStudio.deleteSelected', { count: selectedIds.size })}
          </button>
        )}
        <button onClick={() => fileInputRef.current?.click()} className="px-2.5 py-1.5 rounded-lg" style={{ border: '1px solid var(--ds-border)', color: 'var(--ds-text-secondary)' }}>
          {t('sidepanel.memoryStudio.import')}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          data-testid="studio-import-file"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleImportFile(file);
            e.target.value = '';
          }}
        />
        <button onClick={handleExport} className="px-2.5 py-1.5 rounded-lg" style={{ border: '1px solid var(--ds-border)', color: 'var(--ds-text-secondary)' }} data-testid="studio-export">
          {t('sidepanel.memoryStudio.export')}
        </button>
        <button onClick={() => setPanel(panel === 'analysis' ? 'none' : 'analysis')} className="px-2.5 py-1.5 rounded-lg" style={{ border: '1px solid var(--ds-border)', color: panel === 'analysis' ? 'var(--ds-blue)' : 'var(--ds-text-secondary)' }} data-testid="studio-analysis-toggle">
          {t('sidepanel.memoryStudio.analysis')}
        </button>
        <button onClick={() => setPanel(panel === 'health' ? 'none' : 'health')} className="px-2.5 py-1.5 rounded-lg" style={{ border: '1px solid var(--ds-border)', color: panel === 'health' ? 'var(--ds-blue)' : 'var(--ds-text-secondary)' }} data-testid="studio-health-toggle">
          {t('sidepanel.memoryStudio.health')}
        </button>
      </div>

      {statusMessage && (
        <div className="text-xs px-2.5 py-1.5 rounded-lg" style={{ background: 'var(--ds-surface)', color: 'var(--ds-text-secondary)' }} data-testid="studio-status">
          {statusMessage}
        </div>
      )}

      {/* 命中分析面板 */}
      {panel === 'analysis' && (
        <div className="ds-card rounded-xl p-3 space-y-2" data-testid="studio-analysis-panel">
          <div className="flex gap-1.5">
            <input
              value={analysisPrompt}
              onChange={(e) => setAnalysisPrompt(e.target.value)}
              placeholder={t('sidepanel.memoryStudio.analysisPrompt')}
              className="flex-1 px-2.5 py-1.5 text-xs rounded-lg"
              style={{ background: 'var(--ds-surface)', border: '1px solid var(--ds-border)', color: 'var(--ds-text)' }}
              data-testid="studio-analysis-input"
            />
            <button onClick={runAnalysis} className="ds-btn-primary px-3 py-1.5 text-xs text-white rounded-lg" data-testid="studio-analysis-run">
              {t('sidepanel.memoryStudio.analysisRun')}
            </button>
          </div>
          {analysis && (
            <div className="space-y-2 text-xs" data-testid="studio-analysis-result">
              <div style={{ color: 'var(--ds-text-secondary)' }}>
                {t('sidepanel.memoryStudio.analysisSelected', {
                  selected: analysis.selectedCount,
                  total: analysis.candidateCount,
                  budget: analysis.budget,
                })}
              </div>
              {analysis.explanations.map((exp) => (
                <div key={exp.memoryId ?? exp.name} className="rounded-lg p-2" style={{ background: 'var(--ds-surface)', opacity: exp.selected ? 1 : 0.55 }}>
                  <div className="font-medium" style={{ color: exp.selected ? 'var(--ds-text)' : 'var(--ds-text-secondary)' }}>
                    {exp.selected ? '✓' : '·'} {exp.name}
                    {!exp.selected && <span className="ml-1">（{t('sidepanel.memoryStudio.analysisNotSelected')}）</span>}
                  </div>
                  <div style={{ color: 'var(--ds-text-secondary)' }}>
                    {t('sidepanel.memoryStudio.analysisScore', {
                      score: Math.round(exp.totalScore),
                      keyword: exp.breakdown.keywordScore,
                      decay: exp.breakdown.decayScore,
                      pinned: exp.breakdown.pinnedBonus > 0 ? t('sidepanel.memoryStudio.analysisPinnedNote') : '',
                    })}
                  </div>
                  <div style={{ color: 'var(--ds-text-secondary)' }}>
                    {t('sidepanel.memoryStudio.analysisKeywords', {
                      tags: exp.matchedKeywords.tags.join(', ') || '—',
                      name: exp.matchedKeywords.name.join(', ') || '—',
                      content: exp.matchedKeywords.content.slice(0, 8).join(', ') || '—',
                    })}
                  </div>
                  {exp.contributedLine && (
                    <div className="mt-1 px-1.5 py-1 rounded font-mono whitespace-pre-wrap break-all" style={{ background: 'var(--ds-bg, #fff)', color: 'var(--ds-text)' }}>
                      {t('sidepanel.memoryStudio.analysisContribution')}: {exp.contributedLine}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 健康检查面板 */}
      {panel === 'health' && (
        <div className="ds-card rounded-xl p-3 space-y-2 text-xs" data-testid="studio-health-panel">
          <button onClick={runHealth} className="ds-btn-primary px-3 py-1.5 text-white rounded-lg" data-testid="studio-health-run">
            {t('sidepanel.memoryStudio.healthRun')}
          </button>
          {health && (
            <div className="space-y-2" data-testid="studio-health-result">
              <div style={{ color: 'var(--ds-text-secondary)' }}>
                {health.issues.length === 0
                  ? t('sidepanel.memoryStudio.healthClean', { count: health.checkedCount })
                  : t('sidepanel.memoryStudio.healthSummary', {
                    count: health.checkedCount,
                    duplicate: health.counts.duplicate,
                    stale: health.counts.stale,
                    oversized: health.counts.oversized,
                    conflict: health.counts.conflict,
                  })}
              </div>
              {health.issues.map((issue, i) => (
                <div key={i} className="rounded-lg p-2" style={{ background: 'var(--ds-surface)' }}>
                  <span className="font-medium" style={{ color: 'var(--ds-warning, #d97706)' }}>[{issue.kind}]</span>{' '}
                  <span style={{ color: 'var(--ds-text)' }}>{issue.memoryNames.join(' / ')}</span>
                  <div style={{ color: 'var(--ds-text-secondary)' }}>{issue.detail} — {t(SUGGESTION_KEY[issue.suggestion])}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {showForm && (
        <MemoryForm
          initial={editingMemory}
          onSave={handleSave}
          onCancel={() => { setShowForm(false); setEditingMemory(null); }}
        />
      )}

      {/* 列表 */}
      <div className="space-y-2">
        {filtered.map((m) => (
          <div key={m.id} className="ds-card rounded-xl p-3 flex gap-2 items-start" data-testid="studio-row">
            <input
              type="checkbox"
              checked={m.id != null && selectedIds.has(m.id)}
              onChange={() => m.id != null && toggleSelect(m.id)}
              className="mt-0.5 shrink-0"
              data-testid="studio-row-check"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[13px] font-medium truncate" style={{ color: 'var(--ds-text)' }}>{m.name}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded-md shrink-0" style={{ background: 'var(--ds-surface)', color: 'var(--ds-text-secondary)', border: '1px solid var(--ds-border)' }}>
                  {sourceLabel(m)}
                </span>
                {m.pinned && <span className="text-[10px]" style={{ color: 'var(--ds-warning)' }}>★</span>}
                {m.tags.map((tag) => (
                  <span key={tag} className="text-[10px] px-1 rounded" style={{ color: 'var(--ds-blue)', background: 'var(--ds-blue-light)' }}>#{tag}</span>
                ))}
              </div>
              <div className="text-xs mt-0.5 line-clamp-2" style={{ color: 'var(--ds-text-secondary)' }}>{m.content}</div>
              <div className="text-[10px] mt-1 flex gap-2 flex-wrap" style={{ color: 'var(--ds-text-secondary)' }}>
                <span>{t('sidepanel.memoryStudio.createdAt', { time: formatTime(m.createdAt) })}</span>
                <span>{t('sidepanel.memoryStudio.updatedAt', { time: formatTime(m.updatedAt) })}</span>
                <span>{t('sidepanel.memoryStudio.lastUsed', { time: formatTime(m.lastAccessedAt) })}</span>
                <span>{t('sidepanel.memoryStudio.hits', { count: m.accessCount })}</span>
              </div>
            </div>
            <div className="flex gap-1 shrink-0">
              <button onClick={() => { setEditingMemory(m); setShowForm(true); }} className="text-xs px-1.5 py-0.5 rounded" style={{ color: 'var(--ds-text-secondary)' }}>
                {t('common.edit')}
              </button>
              <button onClick={() => m.id != null && handleDelete(m.id)} className="text-xs px-1.5 py-0.5 rounded" style={{ color: 'var(--ds-danger, #ef4444)' }}>
                {t('common.delete')}
              </button>
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="ds-empty-state">
            <div className="ds-empty-state-title">
              {memories.length === 0 ? t('sidepanel.memoryPage.emptyAll') : t('sidepanel.memoryPage.emptyFiltered')}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
