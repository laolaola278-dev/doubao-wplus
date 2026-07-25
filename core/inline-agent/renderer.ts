import { renderInlineMarkdown } from './markdown';
import { injectInjectedThemeStyles } from '../ui/injected-theme';

const AGENT_STEP_STYLE_ID = 'dwplus-inline-agent-css';

export interface InlineAgentRendererLabels {
  step: (stepNumber: number) => string;
  streaming: string;
  stop: string;
  footerComplete: (totalSteps: number, totalTools: number) => string;
  footerError: (totalSteps: number, totalTools: number) => string;
}

export function injectInlineAgentStyles(): void {
  injectInjectedThemeStyles();
  if (document.getElementById(AGENT_STEP_STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = AGENT_STEP_STYLE_ID;
  style.textContent = `
    .dwplus-agent-container {
      margin-top: 12px;
      border-left: 3px solid var(--dwplus-ui-accent);
      padding-left: 12px;
    }
    [data-dwplus-agent-host-hidden] > :not(.dwplus-agent-container):not(.dwplus-tool-block) {
      display: none !important;
    }
    .dwplus-agent-container[data-restored="true"] {
      margin-bottom: 12px;
    }
    .dwplus-agent-step {
      margin-bottom: 8px;
      border: 1px solid var(--dwplus-ui-border);
      border-radius: 8px;
      overflow: hidden;
      background: var(--dwplus-ui-surface);
      color: var(--dwplus-ui-text);
    }
    .dwplus-agent-step[data-status="streaming"] {
      border-color: var(--dwplus-ui-accent);
    }
    .dwplus-agent-step[data-status="executing_tools"] {
      border-color: #f59e0b;
    }
    .dwplus-agent-step[data-status="error"] {
      border-color: #ef4444;
    }
    .dwplus-agent-step-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 10px;
      font-size: 12px;
      color: var(--dwplus-ui-text-muted);
      background: var(--dwplus-ui-surface-muted);
      cursor: pointer;
      user-select: none;
    }
    .dwplus-agent-step-header::after {
      content: '\\25BC';
      font-size: 9px;
      margin-left: auto;
      transition: transform 0.2s ease;
    }
    .dwplus-agent-step[data-collapsed="true"] .dwplus-agent-step-header::after {
      transform: rotate(-90deg);
    }
    .dwplus-agent-step-indicator {
      font-weight: 600;
      color: var(--dwplus-ui-accent);
    }
    .dwplus-agent-step-status {
      flex: 1;
    }
    .dwplus-agent-stop-btn {
      padding: 2px 8px;
      font-size: 11px;
      border: 1px solid #ef4444;
      border-radius: 4px;
      background: transparent;
      color: #ef4444;
      cursor: pointer;
    }
    .dwplus-agent-stop-btn:hover {
      background: #fef2f2;
    }
    .dwplus-agent-step-body {
      padding: 8px 10px;
      font-size: 13px;
      line-height: 1.5;
      color: var(--dwplus-ui-text);
      word-break: break-word;
      max-height: 300px;
      overflow-y: auto;
      transition: max-height 0.3s ease, padding 0.3s ease, opacity 0.2s ease;
    }
    .dwplus-agent-step-body:empty {
      display: none;
    }
    .dwplus-agent-step-body * { color: inherit; }
    .dwplus-agent-step-body h2,
    .dwplus-agent-step-body h3,
    .dwplus-agent-step-body h4 {
      margin: 8px 0 5px;
      font-weight: 600;
      line-height: 1.35;
    }
    .dwplus-agent-step-body h2 { font-size: 1.1em; }
    .dwplus-agent-step-body h3,
    .dwplus-agent-step-body h4 { font-size: 1.02em; }
    .dwplus-agent-step-body p { margin: 4px 0; }
    .dwplus-agent-step-body ul,
    .dwplus-agent-step-body ol {
      margin: 4px 0 4px 18px;
    }
    .dwplus-agent-step-body li {
      margin: 2px 0;
    }
    .dwplus-agent-step-body strong {
      font-weight: 600;
    }
    .dwplus-agent-step-body em {
      font-style: italic;
    }
    .dwplus-agent-step-body code {
      padding: 1px 4px;
      border-radius: 4px;
      background: var(--dwplus-ui-code-bg);
      font-family: 'SF Mono', Monaco, Menlo, Consolas, monospace;
      font-size: 0.92em;
    }
    .dwplus-agent-step-body pre {
      margin: 6px 0;
      padding: 8px;
      border-radius: 6px;
      background: var(--dwplus-ui-code-bg);
      overflow-x: auto;
    }
    .dwplus-agent-step-body pre code {
      padding: 0;
      background: transparent;
      white-space: pre;
    }
    .dwplus-agent-step-body table {
      width: 100%;
      margin: 8px 0;
      border-collapse: collapse;
      font-size: 12px;
    }
    .dwplus-agent-step-body th,
    .dwplus-agent-step-body td {
      padding: 5px 6px;
      border-bottom: 1px solid var(--dwplus-ui-border);
      text-align: left;
      vertical-align: top;
    }
    .dwplus-agent-step-body th {
      font-weight: 600;
      color: var(--dwplus-ui-text-muted);
    }
    .dwplus-agent-step[data-collapsed="true"] .dwplus-agent-step-body {
      max-height: 0;
      padding: 0 10px;
      opacity: 0;
      overflow: hidden;
    }
    .dwplus-agent-step[data-collapsed="true"] .dwplus-agent-step-tools {
      max-height: 0;
      padding: 0 10px;
      opacity: 0;
      overflow: hidden;
    }
    .dwplus-agent-step-tools {
      padding: 4px 10px 8px;
      font-size: 12px;
      color: var(--dwplus-ui-text-muted);
      transition: max-height 0.3s ease, padding 0.3s ease, opacity 0.2s ease;
    }
    .dwplus-agent-step-tool-item {
      padding: 2px 0;
    }
    .dwplus-agent-step-tool-item.ok::before {
      content: '\\2713 ';
      color: #10b981;
    }
    .dwplus-agent-step-tool-item.err::before {
      content: '\\2717 ';
      color: #ef4444;
    }
    .dwplus-agent-footer {
      margin-top: 8px;
      padding: 6px 0;
      font-size: 12px;
      color: var(--dwplus-ui-text-muted);
    }
    .dwplus-agent-footer.complete::before {
      content: '\\25A0 ';
      color: #10b981;
    }
    .dwplus-agent-footer.error::before {
      content: '\\25A0 ';
      color: #ef4444;
    }

    body.dwplus-theme-dark .dwplus-agent-stop-btn:hover {
      background: #1f1f2e;
    }
    [data-dwplus-body-text] {
      font-size: inherit;
      line-height: 1.7;
      margin-top: 12px;
      color: var(--dwplus-ui-text);
      word-break: break-word;
    }
    [data-dwplus-body-text] * { color: inherit; }
    [data-dwplus-body-text] h3 { font-size: 1.1em; font-weight: 600; margin: 10px 0 4px; }
    [data-dwplus-body-text] p { margin: 3px 0; }
    [data-dwplus-body-text] ul, [data-dwplus-body-text] ol { margin: 3px 0 3px 16px; }
    [data-dwplus-body-text] strong { font-weight: 600; }
    [data-dwplus-body-text] a { color: var(--dwplus-ui-accent); text-decoration: underline; }
    [data-dwplus-body-text] table {
      width: 100%;
      margin: 10px 0;
      border-collapse: collapse;
      font-size: 0.95em;
    }
    [data-dwplus-body-text] th,
    [data-dwplus-body-text] td {
      padding: 7px 8px;
      border-bottom: 1px solid var(--dwplus-ui-border);
      text-align: left;
      vertical-align: top;
    }
    [data-dwplus-body-text] th { font-weight: 600; }
  `;
  document.head.appendChild(style);
}

export function createAgentContainer(): HTMLElement {
  const container = document.createElement('div');
  container.className = 'dwplus-agent-container';
  container.setAttribute('data-dwplus-agent', 'true');
  return container;
}

export function createAgentStepElement(
  stepIndex: number,
  onStop?: () => void,
  labels?: Partial<InlineAgentRendererLabels>,
): HTMLElement {
  const step = document.createElement('div');
  step.className = 'dwplus-agent-step';
  step.setAttribute('data-step-index', String(stepIndex));
  step.setAttribute('data-status', 'streaming');

  const header = document.createElement('div');
  header.className = 'dwplus-agent-step-header';
  header.addEventListener('click', () => {
    const collapsed = step.getAttribute('data-collapsed') === 'true';
    step.setAttribute('data-collapsed', collapsed ? 'false' : 'true');
  });

  const indicator = document.createElement('span');
  indicator.className = 'dwplus-agent-step-indicator';
  indicator.textContent = labels?.step?.(stepIndex + 1) ?? `Step ${stepIndex + 1}`;

  const status = document.createElement('span');
  status.className = 'dwplus-agent-step-status';
  status.textContent = labels?.streaming ?? 'streaming...';

  header.appendChild(indicator);
  header.appendChild(status);

  if (onStop) {
    const stopBtn = document.createElement('button');
    stopBtn.className = 'dwplus-agent-stop-btn';
    stopBtn.textContent = labels?.stop ?? 'Stop';
    stopBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      onStop();
    });
    header.appendChild(stopBtn);
  }

  const body = document.createElement('div');
  body.className = 'dwplus-agent-step-body';

  const tools = document.createElement('div');
  tools.className = 'dwplus-agent-step-tools';

  step.appendChild(header);
  step.appendChild(body);
  step.appendChild(tools);

  return step;
}

export function updateStepStreamText(step: HTMLElement, visibleText: string): void {
  const body = step.querySelector<HTMLElement>('.dwplus-agent-step-body');
  if (!body) return;

  body.setAttribute('data-dwplus-raw-text', visibleText);
  body.innerHTML = renderInlineMarkdown(visibleText);
  scrollStepBodyToBottom(body);
}

function scrollStepBodyToBottom(body: HTMLElement): void {
  body.scrollTop = body.scrollHeight;
  if (typeof requestAnimationFrame !== 'function') return;

  requestAnimationFrame(() => {
    body.scrollTop = body.scrollHeight;
  });
}

export function updateStepStatus(step: HTMLElement, status: string, label?: string): void {
  step.setAttribute('data-status', status);
  const statusEl = step.querySelector('.dwplus-agent-step-status');
  if (statusEl && label) statusEl.textContent = label;
  if (status === 'complete' || status === 'error') {
    const stopBtn = step.querySelector('.dwplus-agent-stop-btn');
    stopBtn?.remove();
  }
}

export function addToolResultToStep(
  step: HTMLElement,
  toolName: string,
  ok: boolean,
  summary: string,
): void {
  const tools = step.querySelector('.dwplus-agent-step-tools');
  if (!tools) return;

  const item = document.createElement('div');
  item.className = `dwplus-agent-step-tool-item ${ok ? 'ok' : 'err'}`;
  item.textContent = `${toolName}: ${summary.slice(0, 100)}`;
  tools.appendChild(item);
}

export function createAgentFooter(
  totalSteps: number,
  totalTools: number,
  isError: boolean,
  labelOverride?: string,
  labels?: Partial<InlineAgentRendererLabels>,
): HTMLElement {
  const footer = document.createElement('div');
  footer.className = `dwplus-agent-footer ${isError ? 'error' : 'complete'}`;
  if (labelOverride) {
    footer.textContent = labelOverride;
  } else if (isError) {
    footer.textContent = labels?.footerError?.(totalSteps, totalTools) ??
      `Agent error (${totalSteps} steps, ${totalTools} tool calls)`;
  } else {
    footer.textContent = labels?.footerComplete?.(totalSteps, totalTools) ??
      `Agent complete (${totalSteps} steps, ${totalTools} tool calls)`;
  }
  return footer;
}
