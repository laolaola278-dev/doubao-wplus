import type { SandboxExecutionResult, SandboxRunRequest } from '../../core/sandbox';

const SANDBOX_FRAME_URL = chrome.runtime.getURL('sandbox-runner.html');
const PYODIDE_BASE_URL = chrome.runtime.getURL('pyodide/');
const FRAME_READY_TIMEOUT_MS = 5_000;

let framePromise: Promise<HTMLIFrameElement> | null = null;
const pendingRuns = new Map<string, {
  resolve: (result: SandboxExecutionResult) => void;
  timeout: ReturnType<typeof setTimeout>;
}>();

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'sandbox-offscreen') return;

  port.onMessage.addListener((message: unknown) => {
    const value = message && typeof message === 'object'
      ? message as { type?: unknown; requestId?: unknown; payload?: unknown }
      : {};
    if (value.type !== 'OFFSCREEN_SANDBOX_RUN' || typeof value.requestId !== 'string') return;

    runSandboxInFrame(value.payload)
      .then((result) => port.postMessage({ type: 'OFFSCREEN_SANDBOX_RESULT', requestId: value.requestId, result }))
      .catch((error) => {
        port.postMessage({
          type: 'OFFSCREEN_SANDBOX_RESULT',
          requestId: value.requestId,
          result: createFailure(error instanceof Error ? error.message : String(error)),
        });
      });
  });
});

window.addEventListener('message', (event) => {
  const frame = document.querySelector<HTMLIFrameElement>('iframe[data-dwplus-sandbox-frame="true"]');
  if (!frame || event.source !== frame.contentWindow) return;

  const value = event.data && typeof event.data === 'object'
    ? event.data as { type?: unknown; requestId?: unknown; result?: unknown }
    : {};
  if (value.type !== 'DWPLUS_SANDBOX_RESULT' || typeof value.requestId !== 'string') return;

  const pending = pendingRuns.get(value.requestId);
  if (!pending) return;
  pendingRuns.delete(value.requestId);
  clearTimeout(pending.timeout);
  pending.resolve(normalizeFrameResult(value.result));
});

async function runSandboxInFrame(payload: unknown): Promise<SandboxExecutionResult> {
  const request = validateRequest(payload);
  const frame = await ensureSandboxFrame();
  const contentWindow = frame.contentWindow;
  if (!contentWindow) return createFailure('Sandbox frame is unavailable.');

  const requestId = crypto.randomUUID();
  const timeoutMs = Math.max(1_000, request.timeoutMs + 1_000);

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      pendingRuns.delete(requestId);
      resolve(createFailure('Sandbox frame timed out.', 'sandbox_frame_timeout', timeoutMs));
    }, timeoutMs);

    pendingRuns.set(requestId, { resolve, timeout });
    contentWindow.postMessage({
      type: 'DWPLUS_SANDBOX_RUN',
      requestId,
      payload: {
        ...request,
        pyodideBaseUrl: PYODIDE_BASE_URL,
      },
    }, '*');
  });
}

function ensureSandboxFrame(): Promise<HTMLIFrameElement> {
  if (framePromise) return framePromise;

  framePromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLIFrameElement>('iframe[data-dwplus-sandbox-frame="true"]');
    if (existing?.contentWindow) {
      resolve(existing);
      return;
    }

    const frame = document.createElement('iframe');
    frame.dataset.dwplusSandboxFrame = 'true';
    frame.src = SANDBOX_FRAME_URL;
    frame.style.display = 'none';

    const timeout = setTimeout(() => {
      reject(new Error('Sandbox frame failed to load.'));
      frame.remove();
      framePromise = null;
    }, FRAME_READY_TIMEOUT_MS);

    frame.addEventListener('load', () => {
      clearTimeout(timeout);
      resolve(frame);
    }, { once: true });

    document.body.appendChild(frame);
  });

  return framePromise;
}

function validateRequest(payload: unknown): SandboxRunRequest {
  const value = payload && typeof payload === 'object' ? payload as Partial<SandboxRunRequest> : {};
  if (
    value.language !== 'javascript' &&
    value.language !== 'typescript' &&
    value.language !== 'python' &&
    value.language !== 'html'
  ) {
    throw new Error('Only JavaScript, TypeScript, Python, and HTML use the browser sandbox.');
  }
  if (typeof value.code !== 'string' || value.code.trim().length === 0) {
    throw new Error('Sandbox code must be a non-empty string.');
  }
  return {
    language: value.language,
    code: value.code,
    input: typeof value.input === 'string' ? value.input : undefined,
    timeoutMs: typeof value.timeoutMs === 'number' && Number.isFinite(value.timeoutMs)
      ? Math.max(1_000, Math.min(15_000, Math.floor(value.timeoutMs)))
      : value.language === 'python' ? 15_000 : 5_000,
  };
}

function normalizeFrameResult(value: unknown): SandboxExecutionResult {
  const result = value && typeof value === 'object' ? value as Partial<SandboxExecutionResult> : {};
  return {
    ok: result.ok === true,
    stdout: typeof result.stdout === 'string' ? result.stdout : '',
    stderr: typeof result.stderr === 'string' ? result.stderr : '',
    result: typeof result.result === 'string' ? result.result : undefined,
    html: typeof result.html === 'string' ? result.html : undefined,
    previewText: typeof result.previewText === 'string' ? result.previewText : undefined,
    durationMs: typeof result.durationMs === 'number' && Number.isFinite(result.durationMs) ? result.durationMs : 0,
    truncated: result.truncated === true,
    error: typeof result.error === 'string' ? result.error : undefined,
  };
}

function createFailure(message: string, code = 'sandbox_offscreen_error', durationMs = 0): SandboxExecutionResult {
  return {
    ok: false,
    stdout: '',
    stderr: message,
    durationMs,
    truncated: false,
    error: code,
  };
}
