// core/ui/prompt-inspector-panel.ts
// Prompt Inspector 开发者面板 — dev-only Prompt Timeline 可视化。
//
// 模式与 skill-popup.ts 一致：vanilla DOM + 懒创建 + <style id> 幂等注入。
// 生命周期：
//   installPromptInspectorPanel()（content.ts 调用，门控关闭时 no-op）
//     └─ 注册快捷键 Ctrl+Shift+P 切换面板
//   面板 DOM 懒创建 —— 首次打开才 build；关闭只 display:none，不销毁
//   数据拉取式（open/refresh 时从环形缓冲读取），不订阅、无观察者 —— 零后台开销
//
// UI 结构：
//   Header：快照选择（seq 列表）+ 刷新 + 复制最终 Prompt + 关闭
//   Timeline：raw-input → skill → memory-system → preset → final 五个节点
//   节点点击展开：当前 Prompt 全文 / 与上一阶段 Diff / 长度 / 新增字符数 / 复制按钮

import {
  getPromptSnapshots,
  isPromptInspectorEnabled,
  type PromptSnapshot,
  type PromptStageNode,
} from '../diagnostics/prompt-inspector';
import { diffPromptLines, renderDiffText, type PromptDiffResult } from '../diagnostics/prompt-diff';

const PANEL_ID = 'dwplus-prompt-inspector';
const STYLE_ID = 'dwplus-prompt-inspector-css';

const STAGE_LABELS: Record<string, string> = {
  'raw-input': 'Raw Input',
  'skill': 'Skill',
  'memory-system': 'Memory / System',
  'preset': 'Preset',
  'final': 'Final Prompt',
};

let panelEl: HTMLDivElement | null = null;
let selectedSeq: number | null = null;

/** 安装面板（快捷键 Ctrl+Shift+P）。门控关闭时 no-op —— 不注册监听、不建 DOM。 */
export function installPromptInspectorPanel(doc: Document = document): void {
  if (!isPromptInspectorEnabled()) return;
  doc.addEventListener('keydown', (event) => {
    if (event.ctrlKey && event.shiftKey && (event.key === 'P' || event.key === 'p')) {
      event.preventDefault();
      togglePromptInspectorPanel(doc);
    }
  });
  if (typeof console !== 'undefined' && console.info) {
    console.info('[DWPLUS-INSPECTOR] Prompt Inspector 就绪：Ctrl+Shift+P 打开面板');
  }
}

export function togglePromptInspectorPanel(doc: Document = document): void {
  if (!isPromptInspectorEnabled()) return;
  if (panelEl && panelEl.style.display !== 'none') {
    panelEl.style.display = 'none';
    return;
  }
  openPromptInspectorPanel(doc);
}

export function openPromptInspectorPanel(doc: Document = document): void {
  if (!isPromptInspectorEnabled()) return;
  ensureStyles(doc);
  if (!panelEl || !doc.body.contains(panelEl)) {
    panelEl = buildPanelShell(doc);
    doc.body.appendChild(panelEl);
  }
  panelEl.style.display = 'flex';
  refreshPanel(doc);
}

/** 测试辅助：读取面板元素（未创建为 null） */
export function getPromptInspectorPanelElement(): HTMLDivElement | null {
  return panelEl;
}

/** 测试/热重载：销毁面板 */
export function destroyPromptInspectorPanel(): void {
  panelEl?.remove();
  panelEl = null;
  selectedSeq = null;
}

// ============================================================
// DOM 构建
// ============================================================

function buildPanelShell(doc: Document): HTMLDivElement {
  const panel = doc.createElement('div');
  panel.id = PANEL_ID;
  panel.className = 'dwplus-pi-panel';
  panel.innerHTML = `
    <div class="dwplus-pi-header">
      <span class="dwplus-pi-title">Prompt Inspector</span>
      <select class="dwplus-pi-select" title="选择快照"></select>
      <button class="dwplus-pi-btn" data-action="refresh" title="刷新快照列表">↻</button>
      <button class="dwplus-pi-btn" data-action="copy-final" title="复制最终 Prompt">复制最终</button>
      <button class="dwplus-pi-btn" data-action="close" title="关闭 (Ctrl+Shift+P)">✕</button>
    </div>
    <div class="dwplus-pi-meta"></div>
    <div class="dwplus-pi-timeline"></div>
  `;

  panel.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const action = target.getAttribute('data-action');
    if (action === 'close') { panel.style.display = 'none'; return; }
    if (action === 'refresh') { refreshPanel(doc); return; }
    if (action === 'copy-final') {
      const snapshot = getSelectedSnapshot();
      if (snapshot) void copyText(snapshot.finalPrompt, target);
      return;
    }
    if (action === 'copy-stage') {
      const idx = Number(target.getAttribute('data-stage-index'));
      const snapshot = getSelectedSnapshot();
      const stage = snapshot?.stages[idx];
      if (stage) void copyText(stage.prompt, target);
      return;
    }
    // 节点头点击 → 展开/折叠
    const head = target.closest('.dwplus-pi-stage-head');
    if (head) {
      const body = head.parentElement?.querySelector('.dwplus-pi-stage-body') as HTMLElement | null;
      if (body) body.style.display = body.style.display === 'none' ? 'block' : 'none';
    }
  });

  panel.querySelector('.dwplus-pi-select')!.addEventListener('change', (event) => {
    selectedSeq = Number((event.target as HTMLSelectElement).value);
    renderSelected(doc);
  });

  return panel;
}

function refreshPanel(doc: Document): void {
  if (!panelEl) return;
  const snapshots = getPromptSnapshots();
  const select = panelEl.querySelector('.dwplus-pi-select') as HTMLSelectElement;
  select.innerHTML = snapshots.length === 0
    ? '<option value="">（暂无快照 — 先发送一条消息）</option>'
    : snapshots.map((s) =>
      `<option value="${s.seq}">#${s.seq} ${new Date(s.timestamp).toLocaleTimeString()} ` +
      `${s.augmentSucceeded ? '' : '⚠ 失败 '}${s.sendStatus === 'sent' ? '✓' : s.sendStatus === 'failed' ? '✗' : '…'}</option>`,
    ).join('');
  if (snapshots.length > 0) {
    const stillExists = snapshots.some((s) => s.seq === selectedSeq);
    if (!stillExists) selectedSeq = snapshots[0].seq;
    select.value = String(selectedSeq);
  } else {
    selectedSeq = null;
  }
  renderSelected(doc);
}

function getSelectedSnapshot(): PromptSnapshot | null {
  return getPromptSnapshots().find((s) => s.seq === selectedSeq) ?? null;
}

function renderSelected(doc: Document): void {
  if (!panelEl) return;
  const meta = panelEl.querySelector('.dwplus-pi-meta') as HTMLElement;
  const timeline = panelEl.querySelector('.dwplus-pi-timeline') as HTMLElement;
  const snapshot = getSelectedSnapshot();

  if (!snapshot) {
    meta.textContent = '';
    timeline.innerHTML = '<div class="dwplus-pi-empty">发送一条消息后点 ↻ 刷新</div>';
    return;
  }

  meta.innerHTML = [
    `host=<b>${escapeHtml(snapshot.host)}</b> (adapter ${escapeHtml(snapshot.adapterVersion)})`,
    `增强 ${snapshot.augmentSucceeded ? '✓' : '✗'} ${snapshot.augmentDurationMs}ms`,
    `发送 ${snapshot.sendStatus}`,
    `记忆 ${snapshot.memoryHit ? `✓ ×${snapshot.usedMemoryIds.length}` : '—'}`,
    `skill ${snapshot.matchedSkills.length > 0 ? escapeHtml(snapshot.matchedSkills.join('+')) : '—'}`,
    `preset ${snapshot.presetInjected ? '✓' : '—'}`,
    `首条 ${snapshot.isFirstMessage ? '✓' : '—'}`,
  ].join(' · ');

  timeline.innerHTML = snapshot.stages.map((stage, i) =>
    renderStageNode(stage, i, i > 0 ? snapshot.stages[i - 1] : null)).join('');
}

function renderStageNode(stage: PromptStageNode, index: number, prev: PromptStageNode | null): string {
  const label = STAGE_LABELS[stage.id] ?? stage.id;
  const delta = prev ? stage.length - prev.length : stage.length;
  const deltaText = prev ? (delta >= 0 ? `+${delta}` : `${delta}`) : `${stage.length}`;
  let diffHtml = '';
  if (prev) {
    const diff = diffPromptLines(prev.prompt, stage.prompt);
    diffHtml = `
      <div class="dwplus-pi-diff-head">与上一阶段 Diff（+${diff.addedCount} −${diff.removedCount} ~${diff.changedCount}${diff.truncated ? '，大输入降级' : ''}）</div>
      <pre class="dwplus-pi-diff">${renderDiffHtml(diff)}</pre>`;
  }
  return `
    <div class="dwplus-pi-stage ${stage.changed ? '' : 'dwplus-pi-stage-skipped'}">
      <div class="dwplus-pi-stage-head">
        <span class="dwplus-pi-stage-arrow">${index > 0 ? '↓' : ''}</span>
        <span class="dwplus-pi-stage-label">${escapeHtml(label)}</span>
        <span class="dwplus-pi-stage-len">${stage.length} 字符（${deltaText}）</span>
        <span class="dwplus-pi-stage-note">${escapeHtml(stage.note)}</span>
      </div>
      <div class="dwplus-pi-stage-body" style="display:none">
        ${diffHtml}
        <div class="dwplus-pi-diff-head">当前 Prompt
          <button class="dwplus-pi-btn" data-action="copy-stage" data-stage-index="${index}">复制</button>
        </div>
        <pre class="dwplus-pi-prompt">${escapeHtml(stage.prompt)}</pre>
      </div>
    </div>`;
}

function renderDiffHtml(diff: PromptDiffResult): string {
  // 超长 diff 截断展示（完整文本可用复制按钮获取）
  const MAX_RENDER_LINES = 400;
  const lines = diff.lines.slice(0, MAX_RENDER_LINES);
  const rendered = lines.map((line) => {
    const cls = line.kind === 'added' ? 'dwplus-pi-add'
      : line.kind === 'removed' ? 'dwplus-pi-del'
      : line.kind === 'changed' ? 'dwplus-pi-chg' : 'dwplus-pi-same';
    const prefix = line.kind === 'added' ? '+ ' : line.kind === 'removed' ? '- ' : line.kind === 'changed' ? '~ ' : '  ';
    const text = line.kind === 'changed' ? `${line.oldText} → ${line.text}` : line.text;
    return `<span class="${cls}">${escapeHtml(prefix + text)}</span>`;
  }).join('\n');
  const more = diff.lines.length > MAX_RENDER_LINES
    ? `\n<span class="dwplus-pi-same">…（其余 ${diff.lines.length - MAX_RENDER_LINES} 行省略）</span>`
    : '';
  return rendered + more;
}

// ============================================================
// 工具
// ============================================================

async function copyText(text: string, feedbackEl: HTMLElement): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    const original = feedbackEl.textContent;
    feedbackEl.textContent = '已复制✓';
    setTimeout(() => { feedbackEl.textContent = original; }, 1200);
  } catch {
    // clipboard 权限受限时退化为 console 输出
    console.info('[DWPLUS-INSPECTOR] 复制失败，文本如下：\n' + text);
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function ensureStyles(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
.dwplus-pi-panel {
  position: fixed; top: 24px; right: 24px; z-index: 2147483000;
  width: 560px; max-height: 82vh; display: flex; flex-direction: column;
  background: #1e1f24; color: #e5e7eb; border: 1px solid #3a3d46; border-radius: 10px;
  font: 12px/1.5 ui-monospace, Consolas, monospace; box-shadow: 0 8px 30px rgba(0,0,0,.45);
}
.dwplus-pi-header { display: flex; align-items: center; gap: 6px; padding: 8px 10px; border-bottom: 1px solid #3a3d46; }
.dwplus-pi-title { font-weight: 700; margin-right: auto; }
.dwplus-pi-select { max-width: 190px; background: #2a2c33; color: inherit; border: 1px solid #3a3d46; border-radius: 4px; padding: 2px 4px; }
.dwplus-pi-btn { background: #2a2c33; color: inherit; border: 1px solid #3a3d46; border-radius: 4px; padding: 2px 8px; cursor: pointer; }
.dwplus-pi-btn:hover { background: #383b44; }
.dwplus-pi-meta { padding: 6px 10px; border-bottom: 1px solid #3a3d46; color: #9ca3af; }
.dwplus-pi-timeline { overflow-y: auto; padding: 8px 10px; }
.dwplus-pi-empty { color: #9ca3af; padding: 18px; text-align: center; }
.dwplus-pi-stage { margin-bottom: 4px; }
.dwplus-pi-stage-skipped .dwplus-pi-stage-label { color: #6b7280; }
.dwplus-pi-stage-head { display: flex; gap: 8px; align-items: baseline; cursor: pointer; padding: 4px 6px; border-radius: 5px; }
.dwplus-pi-stage-head:hover { background: #2a2c33; }
.dwplus-pi-stage-arrow { width: 12px; color: #6b7280; }
.dwplus-pi-stage-label { font-weight: 700; color: #93c5fd; }
.dwplus-pi-stage-len { color: #fbbf24; }
.dwplus-pi-stage-note { color: #9ca3af; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dwplus-pi-stage-body { margin: 4px 0 8px 20px; }
.dwplus-pi-diff-head { color: #9ca3af; margin: 6px 0 2px; display: flex; gap: 8px; align-items: center; }
.dwplus-pi-diff, .dwplus-pi-prompt {
  background: #17181c; border: 1px solid #3a3d46; border-radius: 6px;
  padding: 8px; max-height: 260px; overflow: auto; white-space: pre-wrap; word-break: break-word; margin: 0;
}
.dwplus-pi-add { color: #4ade80; }
.dwplus-pi-del { color: #f87171; }
.dwplus-pi-chg { color: #fbbf24; }
.dwplus-pi-same { color: #6b7280; }
`;
  doc.head.appendChild(style);
}
