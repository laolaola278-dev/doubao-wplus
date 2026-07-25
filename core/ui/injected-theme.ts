const STYLE_ID = 'dwplus-injected-theme-css';

export function injectInjectedThemeStyles(): void {
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
body {
  --dwplus-ui-surface: #FFFFFF;
  --dwplus-ui-surface-muted: #F7F8FA;
  --dwplus-ui-surface-hover: #EFF1F4;
  --dwplus-ui-text: #1D1D1F;
  --dwplus-ui-text-muted: #6B7280;
  --dwplus-ui-text-subtle: #9CA3AF;
  --dwplus-ui-border: #E5E7EB;
  --dwplus-ui-border-muted: #EEF0F2;
  --dwplus-ui-accent: #4D6BFE;
  --dwplus-ui-accent-strong: #3151D3;
  --dwplus-ui-accent-soft: #EEF1FF;
  --dwplus-ui-accent-panel: rgba(77, 107, 254, 0.06);
  --dwplus-ui-code-bg: rgba(15, 23, 42, 0.06);
  --dwplus-ui-danger-panel: rgba(239, 68, 68, 0.08);
  --dwplus-ui-success: #10B981;
  --dwplus-ui-error: #EF4444;
  --dwplus-ui-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
  --dwplus-ui-panel-shadow: -14px 0 40px rgba(15, 23, 42, 0.14);
}

body.dwplus-theme-dark {
  --dwplus-ui-surface: #1F1F1F;
  --dwplus-ui-surface-muted: #262626;
  --dwplus-ui-surface-hover: #2E2E2E;
  --dwplus-ui-text: #F5F5F5;
  --dwplus-ui-text-muted: #D4D4D8;
  --dwplus-ui-text-subtle: #AEB4BC;
  --dwplus-ui-border: #3A3A3A;
  --dwplus-ui-border-muted: #2E2E2E;
  --dwplus-ui-accent: #A8B5FF;
  --dwplus-ui-accent-strong: #C4CCFF;
  --dwplus-ui-accent-soft: rgba(124, 145, 255, 0.18);
  --dwplus-ui-accent-panel: rgba(125, 150, 255, 0.12);
  --dwplus-ui-code-bg: rgba(255, 255, 255, 0.08);
  --dwplus-ui-danger-panel: rgba(248, 113, 113, 0.14);
  --dwplus-ui-success: #34D399;
  --dwplus-ui-error: #F87171;
  --dwplus-ui-shadow: none;
  --dwplus-ui-panel-shadow: -14px 0 40px rgba(0, 0, 0, 0.32);
}

@media (prefers-color-scheme: dark) {
  body:not(.dwplus-theme-light) {
    --dwplus-ui-surface: #1F1F1F;
    --dwplus-ui-surface-muted: #262626;
    --dwplus-ui-surface-hover: #2E2E2E;
    --dwplus-ui-text: #F5F5F5;
    --dwplus-ui-text-muted: #D4D4D8;
    --dwplus-ui-text-subtle: #AEB4BC;
    --dwplus-ui-border: #3A3A3A;
    --dwplus-ui-border-muted: #2E2E2E;
    --dwplus-ui-accent: #A8B5FF;
    --dwplus-ui-accent-strong: #C4CCFF;
    --dwplus-ui-accent-soft: rgba(124, 145, 255, 0.18);
    --dwplus-ui-accent-panel: rgba(125, 150, 255, 0.12);
    --dwplus-ui-code-bg: rgba(255, 255, 255, 0.08);
    --dwplus-ui-danger-panel: rgba(248, 113, 113, 0.14);
    --dwplus-ui-success: #34D399;
    --dwplus-ui-error: #F87171;
    --dwplus-ui-shadow: none;
    --dwplus-ui-panel-shadow: -14px 0 40px rgba(0, 0, 0, 0.32);
  }
}
`;
  document.head.appendChild(style);
}
