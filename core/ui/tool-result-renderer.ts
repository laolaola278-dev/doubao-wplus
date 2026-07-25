import type { ToolCardResult } from '../types';
import type { ArtifactOutput, ArtifactRuntimeLanguage } from '../artifact';
import { injectInjectedThemeStyles } from './injected-theme';

export type ToolResultRenderer = (input: {
  target: HTMLElement;
  result: ToolCardResult;
  sendMessage: <T = unknown>(message: unknown) => Promise<T | undefined>;
}) => boolean;

const renderers: ToolResultRenderer[] = [];
let artifactPreviewRoute: string | null = null;
let artifactPreviewRouteTimer: number | null = null;

export function registerToolResultRenderer(renderer: ToolResultRenderer): void {
  if (!renderers.includes(renderer)) renderers.push(renderer);
}

export function renderToolResultWithRegistry(input: {
  target: HTMLElement;
  result: ToolCardResult;
  sendMessage: <T = unknown>(message: unknown) => Promise<T | undefined>;
}): boolean {
  for (const renderer of renderers) {
    if (renderer(input)) return true;
  }
  return false;
}

export function registerDefaultToolResultRenderers(): void {
  registerToolResultRenderer(renderArtifactResult);
  registerToolResultRenderer(renderSkillDraftResult);
  registerToolResultRenderer(renderMemoryImportPreviewResult);
  registerToolResultRenderer(renderDownloadAttachedFileResult);
}

function renderSkillDraftResult(input: {
  target: HTMLElement;
  result: ToolCardResult;
  sendMessage: <T = unknown>(message: unknown) => Promise<T | undefined>;
}): boolean {
  const draft = getSkillDraftOutput(input.result.output);
  if (!draft) return false;

  const wrapper = createResultPanel('dwplus-skill-draft-result');
  const meta = document.createElement('div');
  meta.className = 'dwplus-result-meta';
  meta.textContent = `/${draft.draft.name} · ${draft.draft.memoryEnabled ? 'memory on' : 'memory off'}`;
  const description = document.createElement('div');
  description.className = 'dwplus-result-text';
  description.textContent = draft.draft.description;
  const button = createSmallButton('Save Skill');
  button.addEventListener('click', () => {
    void saveSkillDraft(draft.draft, input.sendMessage, button);
  });
  wrapper.append(meta, description, button);
  input.target.appendChild(wrapper);
  ensureResultStyles();
  return true;
}

async function saveSkillDraft(
  draft: unknown,
  sendMessage: <T = unknown>(message: unknown) => Promise<T | undefined>,
  button: HTMLButtonElement,
): Promise<void> {
  button.disabled = true;
  const previous = button.textContent;
  button.textContent = 'Saving...';
  try {
    const result = await sendMessage<{ ok?: boolean; error?: string }>({
      type: 'SAVE_SKILL',
      payload: draft,
    });
    if (result?.ok === false) throw new Error(result.error || 'Save failed');
    button.textContent = 'Saved';
  } catch (error) {
    button.textContent = error instanceof Error ? error.message : 'Save failed';
  } finally {
    setTimeout(() => {
      button.disabled = false;
      button.textContent = previous;
    }, 2000);
  }
}

function renderMemoryImportPreviewResult(input: {
  target: HTMLElement;
  result: ToolCardResult;
  sendMessage: <T = unknown>(message: unknown) => Promise<T | undefined>;
}): boolean {
  const preview = getMemoryImportPreviewOutput(input.result.output);
  if (!preview) return false;

  const wrapper = createResultPanel('dwplus-memory-import-result');
  const meta = document.createElement('div');
  meta.className = 'dwplus-result-meta';
  meta.textContent = `${preview.memories.length} memories · ${preview.duplicates} duplicates`;
  const list = document.createElement('div');
  list.className = 'dwplus-result-text';
  list.textContent = preview.memories.slice(0, 5).map((memory) => `- ${memory.name}`).join('\n');
  const button = createSmallButton('Import memories');
  button.disabled = preview.memories.length === 0;
  button.addEventListener('click', () => {
    void importMemoryDrafts(preview.memories, input.sendMessage, button);
  });
  wrapper.append(meta, list, button);
  input.target.appendChild(wrapper);
  ensureResultStyles();
  return true;
}

async function importMemoryDrafts(
  memories: unknown[],
  sendMessage: <T = unknown>(message: unknown) => Promise<T | undefined>,
  button: HTMLButtonElement,
): Promise<void> {
  button.disabled = true;
  const previous = button.textContent;
  button.textContent = 'Importing...';
  try {
    const result = await sendMessage<{ ok?: boolean; count?: number; error?: string }>({
      type: 'IMPORT_MEMORY_DRAFTS',
      payload: { memories },
    });
    if (result?.ok === false) throw new Error(result.error || 'Import failed');
    button.textContent = `Imported ${result?.count ?? memories.length}`;
  } catch (error) {
    button.textContent = error instanceof Error ? error.message : 'Import failed';
  } finally {
    setTimeout(() => {
      button.disabled = false;
      button.textContent = previous;
    }, 2000);
  }
}

function renderArtifactResult(input: {
  target: HTMLElement;
  result: ToolCardResult;
  sendMessage: <T = unknown>(message: unknown) => Promise<T | undefined>;
}): boolean {
  const artifact = getArtifactOutput(input.result.output);
  if (!artifact) return false;

  const wrapper = document.createElement('div');
  wrapper.className = 'dwplus-artifact-result';
  const meta = document.createElement('div');
  meta.className = 'dwplus-artifact-meta';
  meta.textContent = `${artifact.filename} · ${formatBytes(artifact.sizeBytes)}${artifact.fileCount ? ` · ${artifact.fileCount} files` : ''}`;
  const actions = document.createElement('div');
  actions.className = 'dwplus-artifact-actions';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'dwplus-artifact-download';
  button.textContent = 'Download';
  button.addEventListener('click', () => {
    void downloadArtifact(artifact, input.sendMessage, button);
  });
  actions.appendChild(button);

  const output = document.createElement('pre');
  output.className = 'dwplus-artifact-run-output';
  output.hidden = true;

  if (isRunnableCodeArtifact(artifact)) {
    const runButton = document.createElement('button');
    runButton.type = 'button';
    runButton.className = 'dwplus-artifact-run';
    runButton.textContent = 'Run';
    runButton.addEventListener('click', () => {
      void runArtifactCode(artifact, input.sendMessage, runButton, output);
    });
    actions.prepend(runButton);
  }

  if (isHtmlPreviewArtifact(artifact)) {
    const previewButton = document.createElement('button');
    previewButton.type = 'button';
    previewButton.className = 'dwplus-artifact-preview';
    previewButton.textContent = 'Preview';
    previewButton.addEventListener('click', () => {
      void openArtifactPreviewPanel(artifact, input.sendMessage);
    });
    actions.prepend(previewButton);
  }

  wrapper.append(meta, actions);
  input.target.appendChild(wrapper);
  if (isRunnableCodeArtifact(artifact)) input.target.appendChild(output);
  ensureArtifactStyles();
  return true;
}

function isHtmlPreviewArtifact(artifact: ArtifactOutput): boolean {
  return artifact.artifactKind === 'file' &&
    artifact.view?.previewMode === 'html' &&
    artifact.view.language === 'html';
}

function isRunnableCodeArtifact(artifact: ArtifactOutput): boolean {
  return artifact.artifactKind === 'file' &&
    artifact.view?.previewMode === 'code' &&
    isRunnableArtifactLanguage(artifact.view.language);
}

function isRunnableArtifactLanguage(language: ArtifactRuntimeLanguage): language is 'javascript' | 'typescript' | 'python' {
  return language === 'javascript' || language === 'typescript' || language === 'python';
}

async function openArtifactPreviewPanel(
  artifact: ArtifactOutput,
  sendMessage: <T = unknown>(message: unknown) => Promise<T | undefined>,
): Promise<void> {
  ensureResultStyles();
  closeArtifactPreviewPanel();

  const panel = document.createElement('section');
  panel.className = 'dwplus-artifact-preview-panel';
  panel.setAttribute('aria-label', 'Artifact preview');
  const header = document.createElement('div');
  header.className = 'dwplus-artifact-preview-panel-header';
  const title = document.createElement('div');
  title.className = 'dwplus-artifact-preview-panel-title';
  title.textContent = artifact.filename;
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'dwplus-artifact-preview-panel-close';
  closeButton.setAttribute('aria-label', 'Close preview');
  closeButton.textContent = 'x';
  closeButton.addEventListener('click', closeArtifactPreviewPanel);
  header.append(title, closeButton);

  const stage = document.createElement('div');
  stage.className = 'dwplus-artifact-preview-panel-stage';
  const frame = document.createElement('iframe');
  frame.className = 'dwplus-artifact-preview-panel-frame';
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.setAttribute('title', artifact.filename);
  stage.appendChild(frame);
  panel.append(header, stage);
  document.body.appendChild(panel);
  document.body.classList.add('dwplus-artifact-preview-panel-open');
  startArtifactPreviewRouteWatcher(location.href);

  try {
    const record = await getArtifactRecord(artifact, sendMessage);
    if (!panel.isConnected) return;
    frame.srcdoc = record.content;
  } catch (error) {
    if (!panel.isConnected) return;
    frame.remove();
    const message = document.createElement('div');
    message.className = 'dwplus-artifact-preview-error';
    message.textContent = error instanceof Error ? error.message : 'Preview failed';
    stage.appendChild(message);
  }
}

function closeArtifactPreviewPanel(): void {
  document.querySelector('.dwplus-artifact-preview-panel')?.remove();
  document.body.classList.remove('dwplus-artifact-preview-panel-open');
  stopArtifactPreviewRouteWatcher();
}

function startArtifactPreviewRouteWatcher(route: string): void {
  artifactPreviewRoute = route;
  window.addEventListener('popstate', closeArtifactPreviewPanelIfRouteChanged);
  window.addEventListener('hashchange', closeArtifactPreviewPanelIfRouteChanged);

  if (!artifactPreviewRouteTimer) {
    artifactPreviewRouteTimer = window.setInterval(closeArtifactPreviewPanelIfRouteChanged, 250);
  }
}

function stopArtifactPreviewRouteWatcher(): void {
  artifactPreviewRoute = null;
  window.removeEventListener('popstate', closeArtifactPreviewPanelIfRouteChanged);
  window.removeEventListener('hashchange', closeArtifactPreviewPanelIfRouteChanged);
  if (!artifactPreviewRouteTimer) return;
  window.clearInterval(artifactPreviewRouteTimer);
  artifactPreviewRouteTimer = null;
}

function closeArtifactPreviewPanelIfRouteChanged(): void {
  if (!artifactPreviewRoute || location.href === artifactPreviewRoute) return;
  closeArtifactPreviewPanel();
}

async function downloadArtifact(
  artifact: ArtifactOutput,
  sendMessage: <T = unknown>(message: unknown) => Promise<T | undefined>,
  button: HTMLButtonElement,
): Promise<void> {
  button.disabled = true;
  const previous = button.textContent;
  button.textContent = 'Downloading...';
  try {
    const record = await getArtifactRecord(artifact, sendMessage);
    const content = record.kind === 'bundle'
      ? base64ToBlob(record.content, record.mimeType)
      : new Blob([record.content], { type: record.mimeType });
    const url = URL.createObjectURL(content);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = record.filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    button.textContent = 'Downloaded';
  } catch (error) {
    button.textContent = error instanceof Error ? error.message : 'Download failed';
  } finally {
    setTimeout(() => {
      button.disabled = false;
      button.textContent = previous;
    }, 2000);
  }
}

async function runArtifactCode(
  artifact: ArtifactOutput,
  sendMessage: <T = unknown>(message: unknown) => Promise<T | undefined>,
  button: HTMLButtonElement,
  output: HTMLPreElement,
): Promise<void> {
  const language = artifact.view?.language;
  if (!language || !isRunnableArtifactLanguage(language)) return;

  button.disabled = true;
  const previous = button.textContent;
  button.textContent = 'Running...';
  output.hidden = false;
  output.textContent = '';

  try {
    const record = await getArtifactRecord(artifact, sendMessage);
    const result = await runArtifactThroughBackground(record.content, language, sendMessage);
    output.textContent = formatArtifactRunResult(result);
    button.textContent = result.ok ? 'Run again' : 'Failed';
  } catch (error) {
    output.textContent = error instanceof Error ? error.message : String(error);
    button.textContent = 'Failed';
  } finally {
    setTimeout(() => {
      button.disabled = false;
      button.textContent = previous;
    }, 2000);
  }
}

async function getArtifactRecord(
  artifact: ArtifactOutput,
  sendMessage: <T = unknown>(message: unknown) => Promise<T | undefined>,
): Promise<{ filename: string; mimeType: string; content: string; kind: string }> {
  if (typeof artifact.transientContent === 'string') {
    return {
      filename: artifact.filename,
      mimeType: artifact.mimeType,
      content: artifact.transientContent,
      kind: artifact.artifactKind,
    };
  }

  const record = await sendMessage<{ ok?: boolean; artifact?: { filename: string; mimeType: string; content: string; kind: string } }>({
    type: 'GET_ARTIFACT',
    payload: { id: artifact.artifactId },
  });
  if (!record?.artifact) throw new Error('Artifact not found');
  return record.artifact;
}

async function runArtifactThroughBackground(
  code: string,
  language: 'javascript' | 'typescript' | 'python',
  sendMessage: <T = unknown>(message: unknown) => Promise<T | undefined>,
): Promise<ToolCardResult> {
  const result = await sendMessage<ToolCardResult>({
    type: 'RUN_ARTIFACT_CODE',
    payload: {
      language,
      code,
      timeoutMs: language === 'python' ? 15_000 : 5_000,
    },
  });
  if (!result) throw new Error('Code runner did not return a result');
  return result;
}

function formatArtifactRunResult(result: ToolCardResult): string {
  const output = result.output && typeof result.output === 'object'
    ? result.output as Record<string, unknown>
    : {};
  const lines = [
    result.ok ? 'Code executed' : 'Code failed',
    result.detail && !output.stdout && !output.stderr && !output.result ? String(result.detail) : '',
    typeof output.stdout === 'string' && output.stdout ? `stdout:\n${output.stdout}` : '',
    typeof output.stderr === 'string' && output.stderr ? `stderr:\n${output.stderr}` : '',
    typeof output.result === 'string' && output.result ? `result:\n${output.result}` : '',
    result.error?.message ? `error:\n${result.error.message}` : '',
  ];
  return lines.filter(Boolean).join('\n\n') || (result.ok ? 'Done' : 'Failed');
}

function getArtifactOutput(value: unknown): ArtifactOutput | null {
  if (!value || typeof value !== 'object') return null;
  const output = value as ArtifactOutput;
  if (output.kind !== 'artifact') return null;
  if (typeof output.artifactId !== 'string' || typeof output.filename !== 'string') return null;
  if (typeof output.mimeType !== 'string' || typeof output.sizeBytes !== 'number') return null;
  return output;
}

function getSkillDraftOutput(value: unknown): { kind: 'skill_draft'; draft: { name: string; description: string; instructions: string; memoryEnabled: boolean } } | null {
  if (!value || typeof value !== 'object') return null;
  const output = value as { kind?: unknown; draft?: unknown };
  if (output.kind !== 'skill_draft' || !output.draft || typeof output.draft !== 'object') return null;
  const draft = output.draft as { name?: unknown; description?: unknown; instructions?: unknown; memoryEnabled?: unknown };
  if (typeof draft.name !== 'string' || typeof draft.description !== 'string' || typeof draft.instructions !== 'string') return null;
  return value as { kind: 'skill_draft'; draft: { name: string; description: string; instructions: string; memoryEnabled: boolean } };
}

function getMemoryImportPreviewOutput(value: unknown): { kind: 'memory_import_preview'; memories: Array<{ name: string }>; duplicates: number; rejected: number } | null {
  if (!value || typeof value !== 'object') return null;
  const output = value as { kind?: unknown; memories?: unknown; duplicates?: unknown; rejected?: unknown };
  if (output.kind !== 'memory_import_preview' || !Array.isArray(output.memories)) return null;
  if (typeof output.duplicates !== 'number' || typeof output.rejected !== 'number') return null;
  return value as { kind: 'memory_import_preview'; memories: Array<{ name: string }>; duplicates: number; rejected: number };
}

function renderDownloadAttachedFileResult(input: {
  target: HTMLElement;
  result: ToolCardResult;
  sendMessage: <T = unknown>(message: unknown) => Promise<T | undefined>;
}): boolean {
  // B-08: 给 `download_attached_file` 的成功结果加上"打开文件夹 / 复制路径"按钮，
  // 让用户在网页对话里就能直接定位刚拉下来的附件。
  if (!input.result.ok) return false;
  const output = input.result.output;
  if (!isDownloadAttachedFileOutput(output)) return false;

  const wrapper = createResultPanel('dwplus-download-attached-file-result');
  const meta = document.createElement('div');
  meta.className = 'dwplus-result-meta';
  meta.textContent = `📁 ${output.fileName} · ${formatBytes(output.sizeBytes)}`;

  const pathLine = document.createElement('div');
  pathLine.className = 'dwplus-result-text dwplus-download-attached-file-path';
  pathLine.textContent = output.localPath;

  const actions = document.createElement('div');
  actions.className = 'dwplus-artifact-actions';

  const copyButton = createSmallButton('📋 复制路径');
  copyButton.addEventListener('click', () => {
    void copyTextToClipboard(output.localPath, copyButton);
  });
  actions.appendChild(copyButton);

  if (typeof output.downloadId === 'number' && output.downloadId >= 0) {
    const revealButton = createSmallButton('📂 打开文件夹');
    revealButton.addEventListener('click', () => {
      void revealDownload(output.downloadId as number, input.sendMessage, revealButton);
    });
    actions.appendChild(revealButton);
  }

  wrapper.append(meta, pathLine, actions);
  input.target.appendChild(wrapper);
  ensureResultStyles();
  return true;
}

interface DownloadAttachedFileOutput {
  localPath: string;
  fileName: string;
  sizeBytes: number;
  mimeType: string | null;
  fileId: string;
  downloadId?: number | null;
}

function isDownloadAttachedFileOutput(value: unknown): value is DownloadAttachedFileOutput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.localPath === 'string'
    && typeof candidate.fileName === 'string'
    && typeof candidate.sizeBytes === 'number'
    && typeof candidate.fileId === 'string'
    && candidate.localPath.length > 0;
}

async function copyTextToClipboard(text: string, button: HTMLButtonElement): Promise<void> {
  button.disabled = true;
  const previous = button.textContent;
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else if (typeof document !== 'undefined') {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    } else {
      throw new Error('clipboard_unavailable');
    }
    button.textContent = '✅ 已复制';
  } catch {
    button.textContent = '❌ 复制失败';
  } finally {
    setTimeout(() => {
      button.disabled = false;
      button.textContent = previous;
    }, 2000);
  }
}

async function revealDownload(
  downloadId: number,
  sendMessage: <T = unknown>(message: unknown) => Promise<T | undefined>,
  button: HTMLButtonElement,
): Promise<void> {
  button.disabled = true;
  const previous = button.textContent;
  button.textContent = '⏳ 打开中…';
  try {
    const result = await sendMessage<{ ok?: boolean; supported?: boolean; error?: string }>({
      type: 'REVEAL_DOWNLOAD',
      payload: { downloadId },
    });
    if (result?.ok === false && result?.supported === false) {
      button.textContent = '❌ 当前浏览器不支持';
    } else if (result?.ok === false) {
      button.textContent = `❌ ${result.error ?? '打开失败'}`;
    } else {
      button.textContent = '✅ 已打开';
    }
  } catch (error) {
    button.textContent = error instanceof Error ? `❌ ${error.message}` : '❌ 打开失败';
  } finally {
    setTimeout(() => {
      button.disabled = false;
      button.textContent = previous;
    }, 2000);
  }
}

function createResultPanel(className: string): HTMLDivElement {
  const wrapper = document.createElement('div');
  wrapper.className = `dwplus-rich-result ${className}`;
  return wrapper;
}

function createSmallButton(text: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'dwplus-result-action';
  button.textContent = text;
  return button;
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function ensureArtifactStyles(): void {
  ensureResultStyles();
}

function ensureResultStyles(): void {
  injectInjectedThemeStyles();
  if (document.getElementById('dwplus-artifact-result-css')) return;
  const style = document.createElement('style');
  style.id = 'dwplus-artifact-result-css';
  style.textContent = `
.dwplus-artifact-result,
.dwplus-rich-result {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid var(--dwplus-ui-border);
  border-radius: 8px;
  background: var(--dwplus-ui-accent-panel);
}
.dwplus-artifact-meta {
  min-width: 0;
  font-size: 12px;
  color: var(--dwplus-ui-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dwplus-artifact-actions {
  display: inline-flex;
  flex: 0 0 auto;
  gap: 6px;
  align-items: center;
}
.dwplus-rich-result {
  display: block;
}
.dwplus-result-meta {
  min-width: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--dwplus-ui-text);
}
.dwplus-result-text {
  margin-top: 6px;
  white-space: pre-wrap;
  font-size: 12px;
  color: var(--dwplus-ui-text-muted);
}
.dwplus-download-attached-file-path {
  font-family: 'SF Mono', Monaco, Menlo, Consolas, monospace;
  font-size: 11px;
  word-break: break-all;
  user-select: all;
  margin-top: 4px;
}
.dwplus-download-attached-file-result {
  display: block;
}
.dwplus-artifact-preview-panel {
  position: fixed;
  top: 0;
  right: 0;
  z-index: 2147483000;
  display: flex;
  width: min(48vw, 760px);
  min-width: 420px;
  height: 100vh;
  height: 100dvh;
  flex-direction: column;
  border-left: 1px solid var(--dwplus-ui-border);
  background: var(--dwplus-ui-surface);
  box-shadow: var(--dwplus-ui-panel-shadow);
  color: var(--dwplus-ui-text);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
.dwplus-artifact-preview-panel-header {
  display: flex;
  min-height: 54px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 16px;
  border-bottom: 1px solid var(--dwplus-ui-border-muted);
  background: var(--dwplus-ui-surface-muted);
  color: var(--dwplus-ui-text);
  font-size: 14px;
  line-height: 20px;
}
.dwplus-artifact-preview-panel-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
}
.dwplus-artifact-preview-panel-close {
  display: inline-flex;
  width: 28px;
  height: 28px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--dwplus-ui-text-muted);
  cursor: pointer;
  font-size: 18px;
  line-height: 1;
}
.dwplus-artifact-preview-panel-close:hover {
  background: var(--dwplus-ui-surface-hover);
}
.dwplus-artifact-preview-panel-stage {
  flex: 1 1 auto;
  min-height: 0;
  background: #FFFFFF;
}
.dwplus-artifact-preview-panel-frame {
  display: block;
  width: 100%;
  height: 100%;
  border: 0;
  background: #FFFFFF;
}
.dwplus-artifact-preview-error {
  padding: 16px;
  color: #B42318;
  font-size: 12px;
}
.dwplus-result-code,
.dwplus-result-output,
.dwplus-artifact-run-output {
  margin: 8px 0 0;
  max-height: 160px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  border-radius: 7px;
  background: var(--dwplus-ui-code-bg);
  color: var(--dwplus-ui-text);
  font-size: 11px;
  line-height: 1.45;
  padding: 8px;
}
.dwplus-result-action,
.dwplus-artifact-download,
.dwplus-artifact-preview,
.dwplus-artifact-run {
  border: 0;
  border-radius: 7px;
  background: var(--dwplus-ui-accent);
  color: white;
  font-size: 11px;
  font-weight: 600;
  padding: 5px 9px;
  cursor: pointer;
}
.dwplus-result-action {
  margin-top: 8px;
}
.dwplus-artifact-download {
  background: var(--dwplus-ui-accent-soft);
  color: var(--dwplus-ui-accent-strong);
}
.dwplus-result-action:disabled,
.dwplus-artifact-download:disabled,
.dwplus-artifact-preview:disabled,
.dwplus-artifact-run:disabled {
  opacity: 0.65;
  cursor: default;
}
body.dwplus-theme-dark .dwplus-artifact-preview-panel-stage {
  background: #FFFFFF;
}
@media (max-width: 900px) {
  .dwplus-artifact-preview-panel {
    width: 100vw;
    min-width: 0;
  }
}
`;
  document.head.appendChild(style);
}
