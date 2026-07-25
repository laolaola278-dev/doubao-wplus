// 横向柱状图（排行榜用：Skill 排行 / 最常用 Memory）。零依赖，纯 CSS 宽度百分比。

interface BarChartProps {
  items: Array<{ label: string; value: number }>;
  color?: string;
}

export default function BarChart({ items, color = 'var(--ds-blue, #3b82f6)' }: BarChartProps) {
  if (items.length === 0) return null;
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <div className="space-y-1.5" data-testid="insights-bar-chart">
      {items.map((item) => (
        <div key={item.label} className="flex items-center gap-2 text-xs">
          <span className="truncate" style={{ width: 96, color: 'var(--ds-text-secondary)' }} title={item.label}>
            {item.label}
          </span>
          <div className="flex-1 rounded" style={{ background: 'var(--ds-surface)', height: 14 }}>
            <div
              className="rounded"
              style={{ width: `${Math.max((item.value / max) * 100, 2)}%`, height: '100%', background: color, opacity: 0.75 }}
            />
          </div>
          <span style={{ width: 32, textAlign: 'right', color: 'var(--ds-text)' }}>{item.value}</span>
        </div>
      ))}
    </div>
  );
}
