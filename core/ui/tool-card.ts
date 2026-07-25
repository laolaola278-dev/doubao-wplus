import type { ToolCall } from '../types';
import { injectInjectedThemeStyles } from './injected-theme';

export const TOOL_CARD_CLASS = 'dwplus-tool-card';
export const DSML_HIDDEN_CLASS = 'dwplus-dsml-hidden';
const STYLE_ID = 'dwplus-tool-card-css';

export interface ToolCardResult {
  ok: boolean;
  summary: string;
  detail?: string;
}

const collapseTimers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

export function injectToolCardStyles() {
  injectInjectedThemeStyles();
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = TOOL_CARD_CSS;
  document.head.appendChild(style);
}

export function createToolCard(call: ToolCall): HTMLElement {
  injectToolCardStyles();

  const card = document.createElement('div');
  card.className = TOOL_CARD_CLASS;
  card.setAttribute('data-state', 'running');
  card.setAttribute('data-collapsed', 'false');

  card.innerHTML = `
    <div class="dwplus-tc-header" role="button" tabindex="0" aria-expanded="true">
      <span class="dwplus-tc-icon" aria-hidden="true">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>
      </span>
      <span class="dwplus-tc-name"></span>
      <span class="dwplus-tc-status">
        <span class="dwplus-tc-spinner" aria-hidden="true"></span>
        <span class="dwplus-tc-status-text">执行中</span>
      </span>
      <span class="dwplus-tc-chevron" aria-hidden="true">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
      </span>
    </div>
    <div class="dwplus-tc-body">
      <div class="dwplus-tc-section">
        <div class="dwplus-tc-label">参数</div>
        <div class="dwplus-tc-payload"></div>
      </div>
      <div class="dwplus-tc-section dwplus-tc-result-section" data-hidden="true">
        <div class="dwplus-tc-label">结果</div>
        <div class="dwplus-tc-result"></div>
      </div>
    </div>
  `;

  const nameEl = card.querySelector('.dwplus-tc-name') as HTMLElement;
  nameEl.textContent = call.name;

  const payloadEl = card.querySelector('.dwplus-tc-payload') as HTMLElement;
  renderPayload(payloadEl, call.payload);

  const header = card.querySelector('.dwplus-tc-header') as HTMLElement;
  header.addEventListener('click', () => toggleCollapse(card));
  header.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggleCollapse(card);
    }
  });

  return card;
}

export function setToolCardResult(card: HTMLElement, result: ToolCardResult) {
  card.setAttribute('data-state', result.ok ? 'success' : 'error');

  const statusText = card.querySelector('.dwplus-tc-status-text');
  if (statusText) statusText.textContent = result.summary;

  const spinner = card.querySelector('.dwplus-tc-spinner');
  if (spinner) spinner.remove();

  if (result.detail) {
    const resultSection = card.querySelector('.dwplus-tc-result-section') as HTMLElement | null;
    const resultEl = card.querySelector('.dwplus-tc-result') as HTMLElement | null;
    if (resultSection && resultEl) {
      resultEl.textContent = result.detail;
      resultSection.removeAttribute('data-hidden');
    }
  }
}

export function autoCollapseToolCard(card: HTMLElement, delayMs = 2000) {
  cancelCollapseTimer(card);
  const timer = setTimeout(() => {
    collapseTimers.delete(card);
    if (card.getAttribute('data-collapsed') !== 'true') {
      setCollapsed(card, true);
    }
  }, delayMs);
  collapseTimers.set(card, timer);
}

function cancelCollapseTimer(card: HTMLElement) {
  const existing = collapseTimers.get(card);
  if (existing) {
    clearTimeout(existing);
    collapseTimers.delete(card);
  }
}

function toggleCollapse(card: HTMLElement) {
  const collapsed = card.getAttribute('data-collapsed') === 'true';
  setCollapsed(card, !collapsed);
  cancelCollapseTimer(card);
}

function setCollapsed(card: HTMLElement, collapsed: boolean) {
  card.setAttribute('data-collapsed', collapsed ? 'true' : 'false');
  const header = card.querySelector('.dwplus-tc-header');
  header?.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
}

function renderPayload(target: HTMLElement, payload: Record<string, unknown>) {
  target.innerHTML = '';
  const entries = Object.entries(payload);
  if (entries.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'dwplus-tc-payload-empty';
    empty.textContent = '（无参数）';
    target.appendChild(empty);
    return;
  }

  for (const [key, value] of entries) {
    const row = document.createElement('div');
    row.className = 'dwplus-tc-payload-row';

    const keyEl = document.createElement('span');
    keyEl.className = 'dwplus-tc-key';
    keyEl.textContent = key;

    const valEl = document.createElement('span');
    valEl.className = 'dwplus-tc-value';
    valEl.textContent = formatValue(value);

    row.appendChild(keyEl);
    row.appendChild(document.createTextNode(': '));
    row.appendChild(valEl);
    target.appendChild(row);
  }
}

function formatValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

const TOOL_CARD_CSS = `
.dwplus-tool-card {
  margin: 8px 0;
  background: var(--dwplus-ui-surface);
  border: 1px solid var(--dwplus-ui-border);
  border-radius: 12px;
  font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Noto Sans SC', 'Segoe UI', sans-serif;
  font-size: 13px;
  overflow: hidden;
  transition: border-color 0.2s, box-shadow 0.2s;
  animation: dwplus-tc-in 0.2s ease;
  box-shadow: var(--dwplus-ui-shadow);
}
.dwplus-tool-card:hover {
  border-color: var(--dwplus-ui-border);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
}
@keyframes dwplus-tc-in {
  from { opacity: 0; transform: translateY(-2px); }
  to { opacity: 1; transform: translateY(0); }
}
.dwplus-tool-card[data-state="success"] { border-color: #BBF7D0; }
.dwplus-tool-card[data-state="error"]   { border-color: #FECACA; }

.dwplus-tc-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  user-select: none;
  background: var(--dwplus-ui-surface-muted);
  border-bottom: 1px solid transparent;
  transition: background 0.12s, border-color 0.2s;
}
.dwplus-tool-card[data-collapsed="false"] .dwplus-tc-header {
  border-bottom-color: var(--dwplus-ui-border-muted);
}
.dwplus-tc-header:hover { background: var(--dwplus-ui-surface-hover); }
.dwplus-tc-header:focus { outline: none; box-shadow: inset 0 0 0 2px rgba(77, 107, 254, 0.2); }

.dwplus-tc-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 6px;
  background: var(--dwplus-ui-accent-soft);
  color: var(--dwplus-ui-accent);
  flex-shrink: 0;
}
.dwplus-tool-card[data-state="success"] .dwplus-tc-icon { background: #ECFDF5; color: var(--dwplus-ui-success); }
.dwplus-tool-card[data-state="error"]   .dwplus-tc-icon { background: #FEF2F2; color: var(--dwplus-ui-error); }

.dwplus-tc-name {
  font-family: 'SF Mono', Monaco, Menlo, Consolas, monospace;
  font-size: 12px;
  font-weight: 600;
  color: var(--dwplus-ui-text);
  flex-shrink: 0;
}
.dwplus-tc-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--dwplus-ui-text-muted);
  flex: 1;
  min-width: 0;
}
.dwplus-tc-status-text {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dwplus-tool-card[data-state="success"] .dwplus-tc-status-text { color: var(--dwplus-ui-success); }
.dwplus-tool-card[data-state="error"]   .dwplus-tc-status-text { color: var(--dwplus-ui-error); }

.dwplus-tc-spinner {
  width: 11px;
  height: 11px;
  border: 1.5px solid var(--dwplus-ui-border);
  border-top-color: var(--dwplus-ui-accent);
  border-radius: 50%;
  animation: dwplus-tc-spin 0.8s linear infinite;
  flex-shrink: 0;
}
@keyframes dwplus-tc-spin {
  to { transform: rotate(360deg); }
}

.dwplus-tc-chevron {
  display: inline-flex;
  color: var(--dwplus-ui-text-subtle);
  transition: transform 0.22s ease;
  flex-shrink: 0;
}
.dwplus-tool-card[data-collapsed="true"] .dwplus-tc-chevron { transform: rotate(-90deg); }

.dwplus-tc-body {
  max-height: 2000px;
  overflow: hidden;
  transition: max-height 0.3s ease, opacity 0.2s ease;
  opacity: 1;
}
.dwplus-tool-card[data-collapsed="true"] .dwplus-tc-body {
  max-height: 0;
  opacity: 0;
}

.dwplus-tc-section {
  padding: 10px 12px;
}
.dwplus-tc-section + .dwplus-tc-section {
  border-top: 1px dashed var(--dwplus-ui-border-muted);
}
.dwplus-tc-section[data-hidden] { display: none; }

.dwplus-tc-label {
  font-size: 10px;
  font-weight: 600;
  color: var(--dwplus-ui-text-subtle);
  letter-spacing: 0.6px;
  text-transform: uppercase;
  margin-bottom: 6px;
}

.dwplus-tc-payload {
  font-family: 'SF Mono', Monaco, Menlo, Consolas, monospace;
  font-size: 12px;
  line-height: 1.65;
  color: var(--dwplus-ui-text);
  white-space: pre-wrap;
  word-break: break-word;
}
.dwplus-tc-payload-row { display: block; }
.dwplus-tc-payload-empty { color: var(--dwplus-ui-text-subtle); font-style: italic; }

.dwplus-tc-key {
  color: var(--dwplus-ui-text-muted);
}
.dwplus-tc-value {
  color: var(--dwplus-ui-text);
}

.dwplus-tc-result {
  font-size: 12px;
  color: var(--dwplus-ui-text);
  line-height: 1.55;
  word-break: break-word;
  white-space: pre-wrap;
}

.dwplus-dsml-hidden { display: none !important; }
`;
