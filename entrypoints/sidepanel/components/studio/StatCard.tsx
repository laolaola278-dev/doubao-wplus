// 统计卡片 —— Studio 各页概览指标的统一呈现（自 InsightsPage 概览卡抽取）。

interface StatCardProps {
  label: string;
  value: string;
  hint?: string;
  /** 预留状态色（如 Health Score 的 good/warn/bad） */
  tone?: 'default' | 'good' | 'warn' | 'bad';
}

const TONE_COLOR: Record<NonNullable<StatCardProps['tone']>, string> = {
  default: 'var(--ds-text)',
  good: 'var(--ds-success, #10b981)',
  warn: 'var(--ds-warning, #d97706)',
  bad: 'var(--ds-danger, #ef4444)',
};

export default function StatCard({ label, value, hint, tone = 'default' }: StatCardProps) {
  return (
    <div className="ds-card rounded-xl p-3" data-testid="studio-stat-card">
      <div className="text-xs" style={{ color: 'var(--ds-text-secondary)' }}>{label}</div>
      <div className="text-lg font-semibold" style={{ color: TONE_COLOR[tone] }}>{value}</div>
      {hint && <div className="text-xs" style={{ color: 'var(--ds-text-tertiary)' }}>{hint}</div>}
    </div>
  );
}
