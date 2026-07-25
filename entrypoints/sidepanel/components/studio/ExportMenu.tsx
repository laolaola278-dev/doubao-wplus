// 统一导出按钮组（自 InsightsPage 的 JSON/CSV 下载抽取）。
// downloadBlob 收敛到此处 —— Studio 各页导出统一走这一个通道。

export function downloadBlob(content: string, mime: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

interface ExportMenuProps {
  /** 各导出目标：label 展示文本，build 惰性生成内容（点击时才计算） */
  targets: Array<{
    key: string;
    label: string;
    mime: string;
    filename: () => string;
    build: () => string;
  }>;
  testIdPrefix?: string;
}

export default function ExportMenu({ targets, testIdPrefix = 'studio-export' }: ExportMenuProps) {
  return (
    <>
      {targets.map((target) => (
        <button
          key={target.key}
          type="button"
          onClick={() => downloadBlob(target.build(), target.mime, target.filename())}
          className="px-2.5 py-1.5 rounded-lg"
          style={{ border: '1px solid var(--ds-border)', color: 'var(--ds-text-secondary)' }}
          data-testid={`${testIdPrefix}-${target.key}`}
        >
          {target.label}
        </button>
      ))}
    </>
  );
}
