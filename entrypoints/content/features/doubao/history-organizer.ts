export interface HistoryItem {
  sessionId: string;
  title: string;
  element: HTMLElement;
  tags: string[];
}

export interface HistoryOrganizerState {
  schemaVersion: 1;
  tagsBySessionId: Record<string, string[]>;
}

export interface HistoryOrganizerController {
  stop(): void;
  refreshLabels(): void;
}

export interface HistoryOrganizerLabels {
  enhancedSearchTitle: string;
  tagFilterLabel: string;
  tagPlaceholder: string;
  currentTagsLabel: string;
  currentTagsPlaceholder: string;
  emptySearchStatus: string;
  visibleStatus: (visibleCount: number, totalCount: number) => string;
  storageError: (action: 'load' | 'save', message: string) => string;
}

const STORAGE_KEY = 'doubao_wplus_doubao_history_organizer';
const DEPRECATED_STORAGE_KEY = 'doubao_pp_history_organizer';
const STYLE_ID = 'dwplus-history-organizer-css';
const ENHANCER_ID = 'dwplus-history-search-enhancer';
const HISTORY_LINK_SELECTOR = [
  'a[href*="/chat/"]',
].join(',');
const SYNTHETIC_HISTORY_SURFACE_SELECTOR = '[data-dwplus-history-synthetic="true"]';
const PROJECT_SIDEBAR_HIDDEN_ATTR = 'data-dwplus-project-sidebar-hidden';
const OFFICIAL_SEARCH_OPTION_SELECTOR = '[role="option"]';

export function normalizeHistoryOrganizerState(value: unknown): HistoryOrganizerState {
  const object = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Partial<HistoryOrganizerState>
    : {};
  const tagsBySessionId: Record<string, string[]> = {};
  const rawTags = object.tagsBySessionId && typeof object.tagsBySessionId === 'object' && !Array.isArray(object.tagsBySessionId)
    ? object.tagsBySessionId
    : {};
  for (const [sessionId, tags] of Object.entries(rawTags)) {
    tagsBySessionId[sessionId] = normalizeTags(tags);
  }
  return { schemaVersion: 1, tagsBySessionId };
}

export function extractHistoryItems(root: ParentNode, state: HistoryOrganizerState): HistoryItem[] {
  const seen = new Set<string>();
  const items: HistoryItem[] = [];
  for (const anchor of Array.from(root.querySelectorAll<HTMLAnchorElement>(HISTORY_LINK_SELECTOR))) {
    if (anchor.closest(SYNTHETIC_HISTORY_SURFACE_SELECTOR)) continue;
    const sessionId = parseSessionId(anchor.href);
    if (!sessionId || seen.has(sessionId)) continue;
    seen.add(sessionId);
    const element = findHistoryRow(anchor);
    const title = normalizeTitle(anchor.textContent || element.textContent || sessionId);
    items.push({
      sessionId,
      title,
      element,
      tags: state.tagsBySessionId[sessionId] ?? [],
    });
  }
  return items;
}

export function parseSessionId(href: string): string | null {
  try {
    const url = new URL(href, location.href);
    const pathMatch = url.pathname.match(/\/chat\/(?:bot\/[^/]+\/conversation\/)?([^/?#]+)/);
    const value = pathMatch?.[1] ?? null;
    return value ? decodeURIComponent(value) : null;
  } catch {
    return null;
  }
}

export function startDoubaoHistoryOrganizer(
  getLabels: () => HistoryOrganizerLabels,
): HistoryOrganizerController {
  let stopped = false;
  let state: HistoryOrganizerState = { schemaVersion: 1, tagsBySessionId: {} };
  let tagFilter = '';
  let timer: ReturnType<typeof setTimeout> | null = null;

  injectStyles();

  const refreshLabels = () => {
    const enhancer = findSearchEnhancer();
    if (enhancer) renderSearchEnhancerLabels(enhancer, getLabels());
  };

  const refresh = () => {
    if (stopped) return;
    const items = extractHistoryItems(document, state);
    for (const item of items) {
      if (item.element.getAttribute(PROJECT_SIDEBAR_HIDDEN_ATTR) !== 'true') {
        item.element.hidden = false;
      }
      item.element.dataset.dwplusHistoryTags = item.tags.join(', ');
    }

    const dialog = findOfficialSearchDialog(document);
    if (!dialog) return;

    const enhancer = ensureSearchEnhancer(dialog);
    renderSearchEnhancerLabels(enhancer, getLabels());
    bindSearchEnhancer(enhancer, {
      onTagFilterChange(value) {
        tagFilter = value;
        refresh();
      },
      onCurrentTagsChange(value, status) {
        const sessionId = getCurrentSessionId();
        if (!sessionId) return;
        state = {
          schemaVersion: 1,
          tagsBySessionId: {
            ...state.tagsBySessionId,
            [sessionId]: normalizeTags(value.split(',')),
          },
        };
        chrome.storage.local.set({ [STORAGE_KEY]: state })
          .then(refresh)
          .catch((error) => {
            reportStorageError(status, 'save', error, getLabels);
          });
      },
    });

    const tagInput = enhancer.querySelector<HTMLInputElement>('[data-dwplus-history-tag]');
    if (tagInput && tagInput.value !== tagFilter) tagInput.value = tagFilter;

    const currentTagInput = enhancer.querySelector<HTMLInputElement>('[data-dwplus-current-tags]');
    const currentSessionId = getCurrentSessionId();
    if (currentTagInput && currentSessionId && document.activeElement !== currentTagInput) {
      currentTagInput.value = (state.tagsBySessionId[currentSessionId] ?? []).join(', ');
    }

    const status = enhancer.querySelector<HTMLElement>('[data-dwplus-history-status]');
    const result = applyOfficialSearchTags(dialog, items, tagFilter);
    if (status) {
      const labels = getLabels();
      status.textContent = result.total === 0
        ? labels.emptySearchStatus
        : labels.visibleStatus(result.visible, result.total);
    }
  };

  const schedule = () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      refresh();
    }, 200);
  };

  readStorageValueWithMigration(
    chrome.storage.local,
    STORAGE_KEY,
    DEPRECATED_STORAGE_KEY,
  )
    .then((value) => {
      state = normalizeHistoryOrganizerState(value);
      refresh();
    })
    .catch((error) => {
      const status = findSearchEnhancer()?.querySelector<HTMLElement>('[data-dwplus-history-status]') ?? null;
      reportStorageError(status, 'load', error, getLabels);
      refresh();
    });

  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener('popstate', schedule);
  window.addEventListener('hashchange', schedule);
  window.addEventListener('dpp:navigation', schedule);
  refresh();

  return {
    refreshLabels,
    stop() {
      stopped = true;
      observer.disconnect();
      window.removeEventListener('popstate', schedule);
      window.removeEventListener('hashchange', schedule);
      window.removeEventListener('dpp:navigation', schedule);
      if (timer) clearTimeout(timer);
      findSearchEnhancer()?.remove();
      for (const item of extractHistoryItems(document, state)) {
        item.element.hidden = false;
        delete item.element.dataset.dwplusHistoryTags;
      }
      for (const option of document.querySelectorAll<HTMLElement>(OFFICIAL_SEARCH_OPTION_SELECTOR)) {
        option.hidden = false;
        delete option.dataset.dwplusOfficialHistoryOption;
        delete option.dataset.dwplusHistoryTags;
      }
    },
  };
}

export function findOfficialSearchDialog(root: ParentNode): HTMLElement | null {
  for (const dialog of Array.from(root.querySelectorAll<HTMLElement>('[role="dialog"]'))) {
    const hasSearchbox = Boolean(dialog.querySelector('input[role="searchbox"]'));
    const hasListbox = Boolean(dialog.querySelector('[role="listbox"]'));
    if (hasSearchbox && hasListbox) return dialog;
  }
  return null;
}

function findSearchEnhancer(): HTMLElement | null {
  return document.getElementById(ENHANCER_ID);
}

function ensureSearchEnhancer(dialog: HTMLElement): HTMLElement {
  const existing = dialog.querySelector<HTMLElement>(`#${ENHANCER_ID}`);
  if (existing) return existing;
  findSearchEnhancer()?.remove();

  const enhancer = document.createElement('section');
  enhancer.id = ENHANCER_ID;
  enhancer.dataset.dwplusHistorySearchEnhancer = 'true';
  enhancer.innerHTML = `
    <div class="dwplus-history-search-enhancer__bar">
      <span class="dwplus-history-search-enhancer__title" data-dwplus-history-title></span>
      <span class="dwplus-history-search-enhancer__status" data-dwplus-history-status></span>
    </div>
    <div class="dwplus-history-search-enhancer__controls">
      <div class="dwplus-history-search-enhancer__field">
        <label for="dwplus-history-tag-filter" data-dwplus-history-tag-label></label>
        <input id="dwplus-history-tag-filter" data-dwplus-history-tag />
      </div>
      <div class="dwplus-history-search-enhancer__field">
        <label for="dwplus-current-chat-tags" data-dwplus-current-tags-label></label>
        <input id="dwplus-current-chat-tags" data-dwplus-current-tags />
      </div>
    </div>
  `;

  const searchbox = dialog.querySelector<HTMLInputElement>('input[role="searchbox"]');
  const anchor = searchbox?.parentElement ?? null;
  if (anchor) {
    anchor.insertAdjacentElement('afterend', enhancer);
    return enhancer;
  }

  const listbox = dialog.querySelector<HTMLElement>('[role="listbox"]');
  if (listbox?.parentElement) {
    listbox.parentElement.insertBefore(enhancer, listbox);
    return enhancer;
  }

  dialog.prepend(enhancer);
  return enhancer;
}

function bindSearchEnhancer(
  enhancer: HTMLElement,
  handlers: {
    onTagFilterChange(value: string): void;
    onCurrentTagsChange(value: string, status: HTMLElement | null): void;
  },
): void {
  if (enhancer.dataset.dwplusBound === 'true') return;
  enhancer.dataset.dwplusBound = 'true';

  const tagInput = enhancer.querySelector<HTMLInputElement>('[data-dwplus-history-tag]');
  const currentTagInput = enhancer.querySelector<HTMLInputElement>('[data-dwplus-current-tags]');
  const status = enhancer.querySelector<HTMLElement>('[data-dwplus-history-status]');

  tagInput?.addEventListener('input', () => {
    handlers.onTagFilterChange(tagInput.value);
  });
  currentTagInput?.addEventListener('change', () => {
    handlers.onCurrentTagsChange(currentTagInput.value, status);
  });
}

function renderSearchEnhancerLabels(enhancer: HTMLElement, labels: HistoryOrganizerLabels): void {
  const title = enhancer.querySelector<HTMLElement>('[data-dwplus-history-title]');
  const tagLabel = enhancer.querySelector<HTMLElement>('[data-dwplus-history-tag-label]');
  const tagInput = enhancer.querySelector<HTMLInputElement>('[data-dwplus-history-tag]');
  const currentTagLabel = enhancer.querySelector<HTMLElement>('[data-dwplus-current-tags-label]');
  const currentTagInput = enhancer.querySelector<HTMLInputElement>('[data-dwplus-current-tags]');

  if (title) title.textContent = labels.enhancedSearchTitle;
  if (tagLabel) tagLabel.textContent = labels.tagFilterLabel;
  if (tagInput) {
    tagInput.placeholder = labels.tagPlaceholder;
    tagInput.setAttribute('aria-label', labels.tagFilterLabel);
  }
  if (currentTagLabel) currentTagLabel.textContent = labels.currentTagsLabel;
  if (currentTagInput) {
    currentTagInput.placeholder = labels.currentTagsPlaceholder;
    currentTagInput.setAttribute('aria-label', labels.currentTagsLabel);
  }
}

export function applyOfficialSearchTags(
  dialog: ParentNode,
  items: readonly HistoryItem[],
  tagFilter: string,
): { visible: number; total: number } {
  const options = Array.from(dialog.querySelectorAll<HTMLElement>(OFFICIAL_SEARCH_OPTION_SELECTOR));
  const normalizedFilter = tagFilter.trim().toLowerCase();
  let visible = 0;

  for (const option of options) {
    const tags = findTagsForOfficialSearchOption(option, items);
    const matches = !normalizedFilter || tags.some((tag) => tag.toLowerCase().includes(normalizedFilter));
    option.hidden = !matches;
    option.dataset.dwplusOfficialHistoryOption = 'true';
    option.dataset.dwplusHistoryTags = tags.join(', ');
    if (matches) visible += 1;
  }

  return { visible, total: options.length };
}

function findTagsForOfficialSearchOption(option: HTMLElement, items: readonly HistoryItem[]): string[] {
  const optionText = normalizeTitle(option.textContent ?? '').toLowerCase();
  if (!optionText) return [];

  return normalizeTags(items.flatMap((item) => {
    const title = item.title.toLowerCase();
    if (!title || !item.tags.length) return [];
    return optionText.includes(title) || title.includes(optionText) ? item.tags : [];
  }));
}

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #${ENHANCER_ID} {
      --dwplus-history-accent: #5d81ff;
      --dwplus-history-line: rgba(128, 136, 160, 0.22);
      --dwplus-history-field: rgba(128, 136, 160, 0.12);
      --dwplus-history-field-hover: rgba(128, 136, 160, 0.18);
      --dwplus-history-muted: color-mix(in srgb, currentColor 58%, transparent);
      display: grid;
      gap: 9px;
      padding: 10px 18px 12px;
      border-top: 1px solid var(--dwplus-history-line);
      border-bottom: 1px solid var(--dwplus-history-line);
      background: rgba(128, 136, 160, 0.06);
      background: color-mix(in srgb, currentColor 5%, transparent);
      color: inherit;
      font: 12px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif;
    }
    #${ENHANCER_ID} .dwplus-history-search-enhancer__bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      min-width: 0;
    }
    #${ENHANCER_ID} .dwplus-history-search-enhancer__title {
      flex: 0 0 auto;
      font-weight: 650;
      letter-spacing: 0;
      color: inherit;
    }
    #${ENHANCER_ID} .dwplus-history-search-enhancer__status {
      min-width: 0;
      overflow: hidden;
      color: var(--dwplus-history-muted);
      text-align: right;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    #${ENHANCER_ID} .dwplus-history-search-enhancer__controls {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      gap: 8px;
    }
    #${ENHANCER_ID} .dwplus-history-search-enhancer__field {
      display: grid;
      gap: 5px;
      min-width: 0;
    }
    #${ENHANCER_ID} label {
      overflow: hidden;
      color: var(--dwplus-history-muted);
      font-size: 11px;
      font-weight: 560;
      letter-spacing: 0;
      line-height: 1.25;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    #${ENHANCER_ID} input {
      width: 100%;
      min-width: 0;
      min-height: 34px;
      box-sizing: border-box;
      padding: 7px 10px;
      border: 1px solid var(--dwplus-history-line);
      border-radius: 8px;
      outline: none;
      background: var(--dwplus-history-field);
      color: inherit;
      font: inherit;
    }
    #${ENHANCER_ID} input::placeholder {
      color: currentColor;
      opacity: 0.48;
    }
    #${ENHANCER_ID} input:hover {
      background: var(--dwplus-history-field-hover);
    }
    #${ENHANCER_ID} input:focus {
      border-color: color-mix(in srgb, var(--dwplus-history-accent) 72%, currentColor);
      box-shadow: 0 0 0 2px color-mix(in srgb, var(--dwplus-history-accent) 26%, transparent);
    }
    [data-dwplus-history-tags]:not([data-dwplus-history-tags=""])::after {
      content: attr(data-dwplus-history-tags);
      display: inline-block;
      margin-left: 6px;
      padding: 1px 6px;
      border-radius: 999px;
      background: color-mix(in srgb, var(--dwplus-history-accent, #5d81ff) 16%, transparent);
      color: color-mix(in srgb, var(--dwplus-history-accent, #5d81ff) 86%, currentColor);
      font-size: 10px;
      font-weight: 560;
      line-height: 1.5;
      vertical-align: middle;
    }
    [role="option"][data-dwplus-history-tags]:not([data-dwplus-history-tags=""])::after {
      margin-left: 10px;
    }
    @media (max-width: 640px) {
      #${ENHANCER_ID} {
        padding-inline: 14px;
      }
      #${ENHANCER_ID} .dwplus-history-search-enhancer__controls {
        grid-template-columns: 1fr;
      }
    }
  `;
  document.head.appendChild(style);
}

function findHistoryRow(anchor: HTMLAnchorElement): HTMLElement {
  let el: HTMLElement = anchor;
  let depth = 0;
  while (el.parentElement && depth < 4) {
    const parent: HTMLElement = el.parentElement;
    if (parent.querySelectorAll('a').length === 1 && parent.textContent && parent.textContent.trim().length <= 240) {
      el = parent;
    }
    depth += 1;
  }
  return el;
}

function normalizeTitle(value: string): string {
  return value.replace(/\s+/g, ' ').trim() || 'Untitled chat';
}

function reportStorageError(
  status: HTMLElement | null,
  action: 'load' | 'save',
  error: unknown,
  getLabels: () => HistoryOrganizerLabels,
): void {
  const message = error instanceof Error ? error.message : String(error);
  if (status) status.textContent = getLabels().storageError(action, message);
  console.error(`豆包 WPlus failed to ${action} history tags`, error);
}

function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((item): item is string => typeof item === 'string')
    .flatMap((item) => item.split(','))
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 12))];
}

function getCurrentSessionId(): string | null {
  return parseSessionId(location.href);
}
import { readStorageValueWithMigration } from '../../../../core/platform/storage-migration';
