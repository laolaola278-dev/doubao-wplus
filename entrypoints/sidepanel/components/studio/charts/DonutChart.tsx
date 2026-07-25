// 环形占比图（Host 平台占比用）。SVG stroke-dasharray 实现，零依赖。

const PALETTE = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4'];

interface DonutChartProps {
  items: Array<{ label: string; value: number }>;
  size?: number;
}

export default function DonutChart({ items, size = 96 }: DonutChartProps) {
  const total = items.reduce((sum, i) => sum + i.value, 0);
  if (total === 0 || items.length === 0) return null;
  const r = 15.915; // 周长 ≈ 100，dasharray 直接用百分比
  let offset = 25; // 12 点方向起始

  return (
    <div className="flex items-center gap-3" data-testid="insights-donut-chart">
      <svg viewBox="0 0 42 42" width={size} height={size} role="img" aria-hidden="true">
        {items.map((item, i) => {
          const pct = (item.value / total) * 100;
          const seg = (
            <circle
              key={item.label}
              cx="21" cy="21" r={r}
              fill="transparent"
              stroke={PALETTE[i % PALETTE.length]}
              strokeWidth="6"
              strokeDasharray={`${pct} ${100 - pct}`}
              strokeDashoffset={offset}
            />
          );
          offset -= pct;
          return seg;
        })}
      </svg>
      <div className="space-y-1 text-xs">
        {items.map((item, i) => (
          <div key={item.label} className="flex items-center gap-1.5">
            <span className="rounded-full" style={{ width: 8, height: 8, background: PALETTE[i % PALETTE.length] }} />
            <span style={{ color: 'var(--ds-text-secondary)' }}>{item.label}</span>
            <span style={{ color: 'var(--ds-text)' }}>{Math.round((item.value / total) * 100)}%（{item.value}）</span>
          </div>
        ))}
      </div>
    </div>
  );
}
