// 周 × 24 小时活跃热力图。CSS grid + 透明度分档，零依赖。
// weekday 下标 0=周一（与 aggregate.ts weekdayHourly 一致）；标签由调用方传入（i18n）。

interface HeatmapProps {
  /** 7 行（周一~周日）× 24 列 */
  matrix: number[][];
  /** 7 个星期标签（周一起） */
  weekdayLabels: string[];
}

export default function Heatmap({ matrix, weekdayLabels }: HeatmapProps) {
  const max = Math.max(...matrix.flat(), 1);
  return (
    <div className="space-y-0.5 text-xs" data-testid="insights-heatmap">
      {matrix.map((row, day) => (
        <div key={day} className="flex items-center gap-1">
          <span style={{ width: 28, color: 'var(--ds-text-tertiary)' }}>{weekdayLabels[day] ?? ''}</span>
          <div className="flex-1 grid gap-0.5" style={{ gridTemplateColumns: 'repeat(24, 1fr)' }}>
            {row.map((value, hour) => (
              <div
                key={hour}
                title={`${weekdayLabels[day] ?? ''} ${hour}:00 · ${value}`}
                className="rounded-sm"
                style={{
                  aspectRatio: '1',
                  background: value > 0 ? 'var(--ds-blue, #3b82f6)' : 'var(--ds-surface)',
                  opacity: value > 0 ? 0.25 + (value / max) * 0.75 : 1,
                }}
              />
            ))}
          </div>
        </div>
      ))}
      <div className="flex justify-between" style={{ paddingLeft: 32, color: 'var(--ds-text-tertiary)' }}>
        <span>0h</span><span>6h</span><span>12h</span><span>18h</span><span>23h</span>
      </div>
    </div>
  );
}
