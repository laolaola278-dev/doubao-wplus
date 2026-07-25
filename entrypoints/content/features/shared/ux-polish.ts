import { createMessageMarkdownArtifact } from '../../../../core/export/secondary-artifacts';

export interface ContentUxPolishController {
  stop(): void;
  refreshLabels(): void;
}

export interface ContentUxPolishLabels {
  codeDownloadButton: string;
  messageMarkdownButton: string;
  messageMarkdownTitle: string;
}

const STYLE_ID = 'dwplus-content-ux-polish-css';
const CODE_BUTTON_CLASS = 'dwplus-code-download';
const MESSAGE_BUTTON_CLASS = 'dwplus-message-download';
const MESSAGE_SELECTOR = '[data-message-id][data-message-role], [data-message-author-role]';
const POLISH_MOUNT_DELAY_MS = 50;

export function startContentUxPolish(
  getLabels: () => ContentUxPolishLabels,
): ContentUxPolishController {
  injectStyles();
  const unpatchNavigationEvents = patchNavigationEvents();
  const mount = () => mountPolish(document, getLabels());
  const refreshLabels = () => applyPolishLabels(document, getLabels());
  mount();
  const candidateMountScheduler = createCandidateMountScheduler(getLabels);
  const observer = new MutationObserver((mutations) => {
    for (const root of collectPolishCandidateRoots(mutations)) {
      candidateMountScheduler.schedule(root);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener('dpp:navigation', mount);

  return {
    refreshLabels,
    stop() {
      observer.disconnect();
      candidateMountScheduler.cancel();
      window.removeEventListener('dpp:navigation', mount);
      unpatchNavigationEvents();
      document.querySelectorAll(`.${CODE_BUTTON_CLASS}, .${MESSAGE_BUTTON_CLASS}`).forEach((button) => button.remove());
    },
  };
}

export function collectCodeBlocks(root: ParentNode): HTMLElement[] {
  return queryIncludingRoot<HTMLElement>(root, 'pre')
    .filter((pre) => !pre.querySelector(`:scope > .${CODE_BUTTON_CLASS}`));
}

export function inferCodeFilename(codeBlock: HTMLElement, index = 0): string {
  const languageClass = Array.from(codeBlock.querySelector('code')?.classList ?? [])
    .find((className) => className.startsWith('language-'));
  const language = languageClass?.replace(/^language-/, '') || codeBlock.getAttribute('data-language') || 'txt';
  const ext = extensionForLanguage(language);
  return `deepseek-code-${index + 1}.${ext}`;
}

function mountPolish(root: ParentNode, labels: ContentUxPolishLabels): void {
  collectCodeBlocks(root).forEach((pre, index) => mountCodeDownload(pre, index, labels));
  collectMessageNodes(root).forEach((message) => mountMessageDownload(message, labels));
  applyPolishLabels(root, labels);
}

function mountCodeDownload(pre: HTMLElement, index: number, labels: ContentUxPolishLabels): void {
  pre.style.position ||= 'relative';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = CODE_BUTTON_CLASS;
  button.textContent = labels.codeDownloadButton;
  button.title = labels.codeDownloadButton;
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    downloadText(inferCodeFilename(pre, index), getCodeBlockText(pre), 'text/plain;charset=utf-8');
  });
  pre.appendChild(button);
}

export function getCodeBlockText(pre: HTMLElement): string {
  const code = pre.querySelector('code');
  if (code?.textContent) return code.textContent;
  const clone = pre.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(`.${CODE_BUTTON_CLASS}`).forEach((node) => node.remove());
  return clone.textContent ?? '';
}

function collectMessageNodes(root: ParentNode): HTMLElement[] {
  return queryIncludingRoot<HTMLElement>(root, MESSAGE_SELECTOR)
    .filter((node) => !node.querySelector(`:scope > .${MESSAGE_BUTTON_CLASS}`))
    .filter((node) => node.textContent?.trim());
}

function mountMessageDownload(message: HTMLElement, labels: ContentUxPolishLabels): void {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = MESSAGE_BUTTON_CLASS;
  button.textContent = labels.messageMarkdownButton;
  button.title = labels.messageMarkdownTitle;
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    const artifact = createMessageMarkdownArtifact({
      id: message.dataset.messageId || `dom-${Date.now()}`,
      role: normalizeRole(message.dataset.messageRole ?? message.dataset.messageAuthorRole),
      content: getMessageText(message),
      createdAt: null,
    });
    downloadText(artifact.filename, artifact.content, artifact.mimeType);
  });
  message.appendChild(button);
}

function applyPolishLabels(root: ParentNode, labels: ContentUxPolishLabels): void {
  root.querySelectorAll<HTMLButtonElement>(`.${CODE_BUTTON_CLASS}`).forEach((button) => {
    button.textContent = labels.codeDownloadButton;
    button.title = labels.codeDownloadButton;
  });
  root.querySelectorAll<HTMLButtonElement>(`.${MESSAGE_BUTTON_CLASS}`).forEach((button) => {
    button.textContent = labels.messageMarkdownButton;
    button.title = labels.messageMarkdownTitle;
  });
}

function getMessageText(message: HTMLElement): string {
  const clone = message.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(`.${MESSAGE_BUTTON_CLASS}`).forEach((node) => node.remove());
  return clone.textContent?.trim() ?? '';
}

function normalizeRole(value: string | undefined): 'user' | 'assistant' | 'system' | 'tool' | 'unknown' {
  if (value === 'user' || value === 'assistant' || value === 'system' || value === 'tool') return value;
  return 'unknown';
}

function createCandidateMountScheduler(
  getLabels: () => ContentUxPolishLabels,
): { schedule(root: ParentNode): void; cancel(): void } {
  const pending = new Set<ParentNode>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  return {
    schedule(root: ParentNode): void {
      pending.add(root);
      if (timer) return;

      timer = setTimeout(() => {
        timer = null;
        const roots = Array.from(pending);
        pending.clear();
        const labels = getLabels();
        for (const candidate of roots) {
          mountPolish(candidate, labels);
        }
      }, POLISH_MOUNT_DELAY_MS);
    },
    cancel(): void {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      pending.clear();
    },
  };
}

function collectPolishCandidateRoots(mutations: readonly MutationRecord[]): ParentNode[] {
  const roots = new Set<ParentNode>();

  for (const mutation of mutations) {
    for (const node of Array.from(mutation.addedNodes)) {
      const root = getPolishCandidateRoot(node);
      if (root) roots.add(root);
    }
  }

  return Array.from(roots);
}

function getPolishCandidateRoot(node: Node): ParentNode | null {
  if (node.nodeType === Node.TEXT_NODE) {
    const parent = node.parentElement;
    return parent?.closest(`pre, ${MESSAGE_SELECTOR}`) ?? null;
  }

  if (!(node instanceof Element)) return null;
  if (node.matches(`pre, ${MESSAGE_SELECTOR}`)) return node;
  if (node.querySelector(`pre, ${MESSAGE_SELECTOR}`)) return node;
  return null;
}

function queryIncludingRoot<T extends HTMLElement>(root: ParentNode, selector: string): T[] {
  const matches: T[] = [];
  if (root instanceof Element && root.matches(selector)) {
    matches.push(root as T);
  }
  matches.push(...Array.from(root.querySelectorAll<T>(selector)));
  return matches;
}

function patchNavigationEvents(): () => void {
  const historyValue = window.history as History & { __dwplusNavigationPatched?: boolean };
  if (historyValue.__dwplusNavigationPatched) return () => undefined;
  const originalPushState = historyValue.pushState;
  const originalReplaceState = historyValue.replaceState;
  const patchedPushState: History['pushState'] = function patchedPushState(
    this: History,
    ...args: Parameters<History['pushState']>
  ) {
    const result = originalPushState.apply(this, args);
    window.dispatchEvent(new Event('dpp:navigation'));
    return result;
  };
  const patchedReplaceState: History['replaceState'] = function patchedReplaceState(
    this: History,
    ...args: Parameters<History['replaceState']>
  ) {
    const result = originalReplaceState.apply(this, args);
    window.dispatchEvent(new Event('dpp:navigation'));
    return result;
  };

  historyValue.__dwplusNavigationPatched = true;
  historyValue.pushState = patchedPushState;
  historyValue.replaceState = patchedReplaceState;

  return () => {
    if (historyValue.pushState === patchedPushState) historyValue.pushState = originalPushState;
    if (historyValue.replaceState === patchedReplaceState) historyValue.replaceState = originalReplaceState;
    delete historyValue.__dwplusNavigationPatched;
  };
}

function downloadText(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function extensionForLanguage(language: string): string {
  const normalized = language.toLowerCase();
  if (normalized === 'javascript' || normalized === 'js' || normalized === 'jsx') return 'js';
  if (normalized === 'typescript' || normalized === 'ts' || normalized === 'tsx') return 'ts';
  if (normalized === 'python' || normalized === 'py') return 'py';
  if (normalized === 'json') return 'json';
  if (normalized === 'bash' || normalized === 'shell' || normalized === 'sh') return 'sh';
  if (normalized === 'markdown' || normalized === 'md') return 'md';
  return 'txt';
}

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .${CODE_BUTTON_CLASS}, .${MESSAGE_BUTTON_CLASS} {
      border: 1px solid rgba(0, 0, 0, 0.12);
      border-radius: 6px;
      background: rgba(255, 255, 255, 0.92);
      color: #334155;
      font: 11px/1.2 -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif;
      cursor: pointer;
    }
    .${CODE_BUTTON_CLASS} {
      position: absolute;
      top: 6px;
      right: 6px;
      padding: 4px 7px;
    }
    .${MESSAGE_BUTTON_CLASS} {
      float: right;
      margin: 0 0 6px 8px;
      padding: 3px 6px;
    }
  `;
  document.head.appendChild(style);
}
