import { getActiveAdapter } from '../hosts/registry';
import type { HostSelectors } from '../hosts/types';

export interface SkillPopupItem {
  name: string;
  description: string;
}

export interface SkillPopupCopy {
  hint: string;
}

const DEFAULT_COPY: SkillPopupCopy = {
  hint: '↑↓ Navigate · Enter Select · Esc Close',
};

let popupEl: HTMLElement | null = null;
let skills: SkillPopupItem[] = [];
let filtered: SkillPopupItem[] = [];
let activeIdx = 0;
let textarea: HTMLTextAreaElement | null = null;
let copy: SkillPopupCopy = DEFAULT_COPY;

let initialized = false;

export function initSkillPopup(initialSkills: SkillPopupItem[], nextCopy: Partial<SkillPopupCopy> = {}) {
  skills = initialSkills;
  copy = { ...DEFAULT_COPY, ...nextCopy };
  if (isVisible()) buildItems();
  if (initialized) return;
  initialized = true;
  injectStyles();
  watchTextarea();
  document.addEventListener('keydown', onKeydown, true);
  document.addEventListener('mousedown', onClickOutside);
  if (typeof console !== 'undefined' && console.info) {
    console.info(`[DWPLUS-SKILLPOPUP] initSkillPopup: ${skills.length} skills registered, watching for textarea`);
  }
}

function watchTextarea() {
  tryAttach();
  // main-world 脚本在 document_start 运行，SYNC_HOOK_STATE 可能在 <body>
  // 存在之前到达 —— 此时 observe(document.body) 会抛 TypeError 并中断
  // initSkillPopup（keydown/input 监听器不再注册，弹窗永久失效）。
  // 因此 body 未就绪时延迟到 DOMContentLoaded 再启动 observer。
  const startObserver = () => {
    new MutationObserver(() => {
      if (!textarea || !document.contains(textarea)) {
        textarea = null;
        tryAttach();
      }
    }).observe(document.body, { childList: true, subtree: true });
  };
  if (document.body) {
    startObserver();
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      tryAttach();
      startObserver();
    }, { once: true });
  }
}

function tryAttach() {
  if (textarea) return;

  // 优先使用 host adapter 的 inputBox selector（fallback 数组按优先级）
  let el: HTMLTextAreaElement | null = null;
  try {
    const selectors: HostSelectors = getActiveAdapter().getSelectors();
    for (const candidate of selectors.inputBox) {
      try {
        el = document.querySelector<HTMLTextAreaElement>(candidate);
        if (el) break;
      } catch {
        continue;
      }
    }
  } catch {
    // adapter 不可用时兜底
  }

  // 最终兜底：任何 textarea
  if (!el) {
    el = document.querySelector<HTMLTextAreaElement>('textarea');
  }

  if (!el) return;
  textarea = el;
  el.addEventListener('input', onInput);
  if (typeof console !== 'undefined' && console.info) {
    console.info('[DWPLUS-SKILLPOPUP] Attached to textarea, /command interception active');
  }
}

function onInput() {
  if (!textarea) return;
  const val = textarea.value;

  if (val.startsWith('/') && !val.slice(1).includes(' ')) {
    const query = val.slice(1).toLowerCase();
    filtered = query === ''
      ? [...skills]
      : skills.filter(s => s.name.toLowerCase().startsWith(query));
    if (typeof console !== 'undefined' && console.debug) {
      console.debug(`[DWPLUS-SKILLPOPUP] /${query} → ${filtered.length} matches`);
    }
    if (filtered.length > 0) {
      activeIdx = 0;
      showPopup();
      return;
    }
  }
  hidePopup();
}

function onKeydown(e: KeyboardEvent) {
  // 当 popup 可见时，拦截导航和选择键
  if (isVisible()) {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        e.stopImmediatePropagation();
        activeIdx = (activeIdx + 1) % filtered.length;
        highlightActive();
        return;
      case 'ArrowUp':
        e.preventDefault();
        e.stopImmediatePropagation();
        activeIdx = (activeIdx - 1 + filtered.length) % filtered.length;
        highlightActive();
        return;
      case 'Tab':
      case 'Enter':
        e.preventDefault();
        e.stopImmediatePropagation();
        selectSkill(filtered[activeIdx]);
        return;
      case 'Escape':
        e.preventDefault();
        e.stopImmediatePropagation();
        hidePopup();
        return;
    }
  }

  // 即使 popup 不可见，如果当前输入是 /命令（/ 开头无空格），
  // 也要拦截 Enter，防止命令被作为普通提示词发送给豆包
  if (e.key === 'Enter' && !e.shiftKey && textarea && textarea.value.startsWith('/')) {
    const val = textarea.value;
    if (!val.slice(1).includes(' ')) {
      // 纯 /命令（无空格），拦截 Enter
      e.preventDefault();
      e.stopImmediatePropagation();
      if (typeof console !== 'undefined' && console.info) {
        console.info(`[DWPLUS-SKILLPOPUP] Intercepted Enter on /command: ${val}`);
      }
      // 如果有匹配的 skill 就选中，否则提示无匹配
      if (filtered.length > 0) {
        selectSkill(filtered[activeIdx]);
      } else {
        hidePopup();
      }
    }
  }
}

function onClickOutside(e: MouseEvent) {
  if (!isVisible()) return;
  if (popupEl?.contains(e.target as Node)) return;
  if (e.target === textarea) return;
  hidePopup();
}

function selectSkill(skill: SkillPopupItem) {
  if (!textarea || !skill) return;

  const newVal = `/${skill.name} `;

  // Invalidate React's value tracker so it detects the change
  const tracker = (textarea as any)._valueTracker;
  if (tracker) tracker.setValue('');

  const nativeSetter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype, 'value',
  )?.set;
  if (nativeSetter) {
    nativeSetter.call(textarea, newVal);
  } else {
    textarea.value = newVal;
  }

  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  textarea.focus();
  textarea.setSelectionRange(newVal.length, newVal.length);
  hidePopup();
}

function showPopup() {
  if (!textarea) return;

  if (!popupEl) {
    popupEl = document.createElement('div');
    popupEl.className = 'dwplus-skill-popup';
    document.body.appendChild(popupEl);
  }

  const rect = textarea.getBoundingClientRect();
  Object.assign(popupEl.style, {
    display: 'block',
    left: `${rect.left}px`,
    bottom: `${window.innerHeight - rect.top + 6}px`,
    width: `${Math.min(rect.width * 0.5, 280)}px`,
  });

  buildItems();
}

function buildItems() {
  if (!popupEl) return;

  popupEl.innerHTML = filtered.map((s, i) => `
    <div class="dwplus-skill-item${i === activeIdx ? ' dwplus-active' : ''}" data-i="${i}">
      <div class="dwplus-skill-head">
        <code class="dwplus-skill-trigger">/${escapeHtml(s.name)}</code>
      </div>
      <div class="dwplus-skill-desc">${escapeHtml(s.description)}</div>
    </div>
  `).join('')
    + `<div class="dwplus-skill-hint">${escapeHtml(copy.hint)}</div>`;

  popupEl.querySelectorAll('.dwplus-skill-item').forEach(el => {
    const i = parseInt((el as HTMLElement).dataset.i || '0');
    el.addEventListener('mouseenter', () => {
      activeIdx = i;
      highlightActive();
    });
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      selectSkill(filtered[i]);
    });
  });
}

function highlightActive() {
  if (!popupEl) return;
  popupEl.querySelectorAll('.dwplus-skill-item').forEach((el, i) => {
    el.classList.toggle('dwplus-active', i === activeIdx);
    if (i === activeIdx) el.scrollIntoView({ block: 'nearest' });
  });
}

function hidePopup() {
  if (popupEl) popupEl.style.display = 'none';
}

function isVisible() {
  return popupEl !== null && popupEl.style.display !== 'none';
}

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function injectStyles() {
  if (document.getElementById('dwplus-skill-popup-css')) return;
  const style = document.createElement('style');
  style.id = 'dwplus-skill-popup-css';
  style.textContent = `
:root {
  --dwplus-skill-popup-bg: #FFFFFF;
  --dwplus-skill-popup-surface: #F7F8FA;
  --dwplus-skill-popup-border: #E5E7EB;
  --dwplus-skill-popup-divider: #F3F4F6;
  --dwplus-skill-popup-trigger-bg: #EEF1FF;
  --dwplus-skill-popup-trigger: #4D6BFE;
  --dwplus-skill-popup-desc: #9CA3AF;
  --dwplus-skill-popup-hint: #D1D5DB;
  --dwplus-skill-popup-shadow: 0 4px 24px rgba(0,0,0,0.08), 0 1px 4px rgba(0,0,0,0.04);
}
body.dwplus-theme-dark {
  --dwplus-skill-popup-bg: #151922;
  --dwplus-skill-popup-surface: #1B202A;
  --dwplus-skill-popup-border: #2B3240;
  --dwplus-skill-popup-divider: #2B3240;
  --dwplus-skill-popup-trigger-bg: rgba(125, 145, 255, 0.16);
  --dwplus-skill-popup-trigger: #7D91FF;
  --dwplus-skill-popup-desc: #B5BDCB;
  --dwplus-skill-popup-hint: #838C9D;
  --dwplus-skill-popup-shadow: none;
}
@media (prefers-color-scheme: dark) {
  body:not(.dwplus-theme-light) {
    --dwplus-skill-popup-bg: #151922;
    --dwplus-skill-popup-surface: #1B202A;
    --dwplus-skill-popup-border: #2B3240;
    --dwplus-skill-popup-divider: #2B3240;
    --dwplus-skill-popup-trigger-bg: rgba(125, 145, 255, 0.16);
    --dwplus-skill-popup-trigger: #7D91FF;
    --dwplus-skill-popup-desc: #B5BDCB;
    --dwplus-skill-popup-hint: #838C9D;
    --dwplus-skill-popup-shadow: none;
  }
}
.dwplus-skill-popup {
  position: fixed;
  z-index: 99999;
  background: var(--dwplus-skill-popup-bg);
  border: 1px solid var(--dwplus-skill-popup-border);
  border-radius: 12px;
  padding: 4px;
  box-shadow: var(--dwplus-skill-popup-shadow);
  display: none;
  animation: dwplus-slide-up .15s ease;
  font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Segoe UI', sans-serif;
  backdrop-filter: blur(8px);
  max-height: 220px;
  overflow-y: auto;
  overscroll-behavior: contain;
}
@keyframes dwplus-slide-up {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: translateY(0); }
}
.dwplus-skill-item {
  padding: 8px 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: background .1s;
}
.dwplus-skill-item.dwplus-active {
  background: var(--dwplus-skill-popup-surface);
}
.dwplus-skill-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.dwplus-skill-trigger {
  color: var(--dwplus-skill-popup-trigger);
  font-size: 13px;
  font-family: 'SF Mono', Monaco, Consolas, monospace;
  font-weight: 600;
  background: var(--dwplus-skill-popup-trigger-bg);
  padding: 1px 6px;
  border-radius: 4px;
}
.dwplus-skill-desc {
  color: var(--dwplus-skill-popup-desc);
  font-size: 11px;
  margin-top: 2px;
}
.dwplus-skill-hint {
  text-align: center;
  color: var(--dwplus-skill-popup-hint);
  font-size: 10px;
  padding: 4px 0 2px;
  border-top: 1px solid var(--dwplus-skill-popup-divider);
  margin-top: 4px;
}
`;
  document.head.appendChild(style);
}
