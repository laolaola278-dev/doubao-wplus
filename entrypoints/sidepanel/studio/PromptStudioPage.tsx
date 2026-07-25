// Studio Prompt 页 — Prompt 处理管线观测（sidepanel 侧）。
// 数据：GET_STUDIO_HOST_DIAGNOSTICS 返回的 PromptSnapshotSummary[]（脱敏：
// 只有长度/阶段/耗时/结果，无 prompt 全文 —— 与 diagnostics-export 同一分层）。
// 全文调试仍走宿主页内的 Prompt Inspector 面板（Ctrl+Shift+P），本页只做行为观测。

import { useEffect, useState } from 'react';
import type { PromptSnapshotSummary } from '../../../core/diagnostics/prompt-inspector';
import StatCard from '../components/studio/StatCard';
import { useI18n } from '../i18n';

interface HostDiagnosticsResponse {
  ok?: boolean;
  hostTabAvailable?: boolean;
  promptInspector?: { enabled: boolean; summaries: PromptSnapshotSummary[] } | null;
}

export default function PromptStudioPage() {
  const { t } = useI18n();
  const [loaded, setLoaded] = useState(false);
  const [hostTabAvailable, setHostTabAvailable] = useState(false);
  const [inspectorEnabled, setInspectorEnabled] = useState(false);
  const [summaries, setSummaries] = useState<PromptSnapshotSummary[]>([]);
  const [expandedSeq, setExpandedSeq] = useState<number | null>(null);

  const load = async () => {
    try {
      const response: HostDiagnosticsResponse | undefined =
        await chrome.runtime.sendMessage({ type: 'GET_STUDIO_HOST_DIAGNOSTICS' });
      if (response?.ok) {
        setHostTabAvailable(response.hostTabAvailable === true);
        setInspectorEnabled(response.promptInspector?.enabled === true);
        setSummaries(response.promptInspector?.summaries ?? []);
      }
    } catch {
      setHostTabAvailable(false);
    } finally {
      setLoaded(true);
    }
  };

  useEffect(() => { void load(); }, []);

  if (!loaded) return null;

  if (!hostTabAvailable) {
    return (
      <div className="p-4" data-testid="studio-prompt">
        <div className="ds-card rounded-xl p-6 text-center text-xs" style={{ color: 'var(--ds-text-secondary)' }} data-testid="studio-prompt-no-host">
          {t('sidepanel.studio.prompt.noHostTab')}
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-3 overflow-y-auto" data-testid="studio-prompt">
      <div className="flex gap-1.5 items-center text-xs">
        <button
          type="button"
          onClick={() => void load()}
          className="px-2.5 py-1.5 rounded-lg"
          style={{ border: '1px solid var(--ds-border)', color: 'var(--ds-text-secondary)' }}
          data-testid="studio-prompt-refresh"
        >
          ↻ {t('common.refresh')}
        </button>
        <span style={{ color: 'var(--ds-text-tertiary)' }}>
          {t('sidepanel.studio.prompt.fullTextHint')}
        </span>
      </div>

      {!inspectorEnabled ? (
        <div className="ds-card rounded-xl p-6 text-center text-xs" style={{ color: 'var(--ds-text-secondary)' }} data-testid="studio-prompt-disabled">
          {t('sidepanel.studio.prompt.inspectorDisabled')}
        </div>
      ) : summaries.length === 0 ? (
        <div className="ds-card rounded-xl p-6 text-center text-xs" style={{ color: 'var(--ds-text-secondary)' }} data-testid="studio-prompt-empty">
          {t('sidepanel.studio.prompt.empty')}
        </div>
      ) : (
        <>
          {/* 最近一条快照的核心指标 */}
          <div className="grid grid-cols-2 gap-2">
            <StatCard
              label={t('sidepanel.studio.prompt.lastAugmentMs')}
              value={`${summaries[0].augmentDurationMs}ms`}
            />
            <StatCard
              label={t('sidepanel.studio.prompt.lastExpansion')}
              value={`${summaries[0].originalLength} → ${summaries[0].finalLength}`}
            />
          </div>

          {/* 快照列表（新→旧） */}
          <div className="space-y-1.5" data-testid="studio-prompt-list">
            {summaries.map((snapshot) => (
              <div key={snapshot.seq} className="ds-card rounded-xl p-2.5 text-xs">
                <button
                  type="button"
                  className="w-full text-left"
                  onClick={() => setExpandedSeq(expandedSeq === snapshot.seq ? null : snapshot.seq)}
                  data-testid={`studio-prompt-row-${snapshot.seq}`}
                >
                  <div style={{ color: 'var(--ds-text)' }}>
                    #{snapshot.seq} · {new Date(snapshot.timestamp).toLocaleTimeString()} · {snapshot.host} ·{' '}
                    {snapshot.originalLength}→{snapshot.finalLength} · {snapshot.augmentDurationMs}ms ·{' '}
                    <span style={{
                      color: snapshot.sendStatus === 'sent'
                        ? 'var(--ds-success, #10b981)'
                        : snapshot.sendStatus === 'failed'
                          ? 'var(--ds-danger, #ef4444)'
                          : 'var(--ds-text-tertiary)',
                    }}>
                      {snapshot.sendStatus}
                    </span>
                  </div>
                  <div style={{ color: 'var(--ds-text-tertiary)' }}>
                    {snapshot.matchedSkills.length > 0 && `skills: ${snapshot.matchedSkills.join('+')} · `}
                    {snapshot.memoryHit && `${t('sidepanel.studio.prompt.memories', { count: snapshot.usedMemoryCount })} · `}
                    {snapshot.presetInjected && 'preset · '}
                    {!snapshot.augmentSucceeded && `⚠ ${t('sidepanel.studio.prompt.augmentFailed')}`}
                  </div>
                </button>
                {/* 阶段长度瀑布（脱敏数据里能安全展示的部分） */}
                {expandedSeq === snapshot.seq && snapshot.stageLengths.length > 0 && (
                  <div className="mt-1.5 space-y-0.5" data-testid="studio-prompt-stages">
                    {snapshot.stageLengths.map((stage, i) => {
                      const prev = i > 0 ? snapshot.stageLengths[i - 1].length : 0;
                      const delta = stage.length - prev;
                      return (
                        <div key={stage.id} className="flex items-center gap-2" style={{ color: 'var(--ds-text-secondary)' }}>
                          <span style={{ width: 110 }}>{stage.id}</span>
                          <span style={{ width: 64, textAlign: 'right' }}>{stage.length}</span>
                          <span style={{ color: stage.changed ? 'var(--ds-blue)' : 'var(--ds-text-tertiary)' }}>
                            {i > 0 ? (delta >= 0 ? `+${delta}` : String(delta)) : ''}
                            {!stage.changed && i > 0 ? ` (${t('sidepanel.studio.prompt.stageUnchanged')})` : ''}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
