// Diff Viewer —— 行级差异展示（React 组件）。
// 渲染引擎复用 core/diagnostics/prompt-diff（Prompt Inspector 同款 LCS 算法，零新实现）。
// 用途：Studio Prompt 页阶段对比、未来 preset/rule 修订对比。

import { useMemo } from 'react';
import { diffPromptLines, type DiffLine } from '../../../../core/diagnostics/prompt-diff';

const KIND_STYLE: Record<DiffLine['kind'], { marker: string; color: string; background: string }> = {
  same: { marker: ' ', color: 'var(--ds-text-secondary)', background: 'transparent' },
  added: { marker: '+', color: 'var(--ds-success, #10b981)', background: 'rgba(16,185,129,0.08)' },
  removed: { marker: '-', color: 'var(--ds-danger, #ef4444)', background: 'rgba(239,68,68,0.08)' },
  changed: { marker: '~', color: 'var(--ds-warning, #d97706)', background: 'rgba(217,119,6,0.08)' },
};

interface DiffViewerProps {
  oldText: string;
  newText: string;
  /** 折叠连续相同行（保留首尾 context 行数）；0 = 不折叠 */
  collapseContext?: number;
  maxHeight?: number;
}

export default function DiffViewer({ oldText, newText, collapseContext = 2, maxHeight = 240 }: DiffViewerProps) {
  const diff = useMemo(() => diffPromptLines(oldText, newText), [oldText, newText]);

  const visible = useMemo(() => {
    if (collapseContext <= 0) return diff.lines.map((line) => ({ line, collapsed: 0 }));
    const out: Array<{ line: DiffLine | null; collapsed: number }> = [];
    let sameRun: DiffLine[] = [];
    const flush = () => {
      if (sameRun.length <= collapseContext * 2 + 1) {
        for (const line of sameRun) out.push({ line, collapsed: 0 });
      } else {
        for (const line of sameRun.slice(0, collapseContext)) out.push({ line, collapsed: 0 });
        out.push({ line: null, collapsed: sameRun.length - collapseContext * 2 });
        for (const line of sameRun.slice(-collapseContext)) out.push({ line, collapsed: 0 });
      }
      sameRun = [];
    };
    for (const line of diff.lines) {
      if (line.kind === 'same') {
        sameRun.push(line);
      } else {
        flush();
        out.push({ line, collapsed: 0 });
      }
    }
    flush();
    return out;
  }, [diff, collapseContext]);

  return (
    <div data-testid="studio-diff-viewer">
      <div className="text-xs mb-1" style={{ color: 'var(--ds-text-tertiary)' }} data-testid="studio-diff-summary">
        +{diff.addedCount} / -{diff.removedCount} / ~{diff.changedCount}
        {diff.truncated ? ' (truncated)' : ''}
      </div>
      <pre
        className="text-xs rounded-lg p-2 overflow-auto"
        style={{ background: 'var(--ds-surface)', maxHeight, margin: 0 }}
      >
        {visible.map((item, i) => {
          if (item.line === null) {
            return (
              <div key={i} style={{ color: 'var(--ds-text-tertiary)' }} data-testid="studio-diff-collapsed">
                ··· {item.collapsed} ···
              </div>
            );
          }
          const style = KIND_STYLE[item.line.kind];
          return (
            <div key={i} style={{ color: style.color, background: style.background }} data-diff-kind={item.line.kind}>
              {style.marker} {item.line.kind === 'changed' && item.line.oldText !== undefined
                ? `${item.line.oldText} → ${item.line.text}`
                : item.line.text}
            </div>
          );
        })}
      </pre>
    </div>
  );
}
