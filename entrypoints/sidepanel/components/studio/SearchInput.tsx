// 统一搜索输入框（自 MemoryStudioPage 工具栏抽取；样式与 testid 语义不变）。

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  testId?: string;
}

export default function SearchInput({ value, onChange, placeholder, testId }: SearchInputProps) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="flex-1 min-w-[140px] px-2.5 py-1.5 text-xs rounded-lg"
      style={{ background: 'var(--ds-surface)', border: '1px solid var(--ds-border)', color: 'var(--ds-text)' }}
      data-testid={testId}
    />
  );
}
