// 自绘轻量 SVG 图表组件（AI Insights Dashboard 用）。
// 零依赖、纯 props 驱动、无状态、无动画循环 —— 与项目克制依赖的风格一致。

interface LineChartProps {
  /** 按序数据点（如每日 prompt 数） */
  points: Array<{ label: string; value: number }>;
  height?: number;
  /** 曲线/填充色（CSS 变量或色值） */
  color?: string;
}

/** 趋势折线图（含面积填充与首尾标签） */
export default function LineChart({ points, height = 96, color = 'var(--ds-blue, #3b82f6)' }: LineChartProps) {
  const width = 280;
  const padX = 6;
  const padY = 8;
  if (points.length === 0) return null;
  const max = Math.max(...points.map((p) => p.value), 1);
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;
  const stepX = points.length > 1 ? innerW / (points.length - 1) : 0;
  const coords = points.map((p, i) => ({
    x: padX + (points.length > 1 ? i * stepX : innerW / 2),
    y: padY + innerH - (p.value / max) * innerH,
  }));
  const path = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
  const area = `${path} L${coords[coords.length - 1].x.toFixed(1)},${height - padY} L${coords[0].x.toFixed(1)},${height - padY} Z`;

  return (
    <div data-testid="insights-line-chart">
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} role="img" aria-hidden="true">
        <path d={area} fill={color} opacity={0.12} />
        <path d={path} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
        {coords.map((c, i) => (
          <circle key={i} cx={c.x} cy={c.y} r={points.length > 30 ? 0 : 2} fill={color} />
        ))}
      </svg>
      <div className="flex justify-between text-xs" style={{ color: 'var(--ds-text-tertiary)' }}>
        <span>{points[0].label}</span>
        {points.length > 1 && <span>{points[points.length - 1].label}</span>}
      </div>
    </div>
  );
}
