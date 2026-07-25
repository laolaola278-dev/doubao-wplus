import { runWorkerSandbox } from '../../core/sandbox/worker-runner';
import type { SandboxExecutionResult, SandboxRunRequest } from '../../core/sandbox';

type SandboxRunnerRequest = SandboxRunRequest & {
  pyodideBaseUrl?: string;
};

const HTML_EXECUTION_DELAY_MS = 250;
const HTML_OUTPUT_LIMIT = 12_000;

window.addEventListener('message', (event) => {
  if (event.source !== parent) return;

  const value = event.data && typeof event.data === 'object'
    ? event.data as { type?: unknown; requestId?: unknown; payload?: unknown }
    : {};
  if (value.type !== 'DWPLUS_SANDBOX_RUN' || typeof value.requestId !== 'string') return;

  void runApprovedCode(value.requestId, value.payload);
});

async function runApprovedCode(requestId: string, payload: unknown): Promise<void> {
  try {
    const request = validateRequest(payload);
    const result = request.language === 'html'
      ? await runHtmlSandbox(request)
      : await runWorkerSandbox({
        language: request.language,
        code: request.code,
        userInput: request.input,
        timeoutMs: request.timeoutMs,
        pyodideBaseUrl: request.pyodideBaseUrl,
      });
    parent.postMessage({ type: 'DWPLUS_SANDBOX_RESULT', requestId, result }, '*');
  } catch (error) {
    parent.postMessage({
      type: 'DWPLUS_SANDBOX_RESULT',
      requestId,
      result: {
        ok: false,
        stdout: '',
        stderr: error instanceof Error ? error.message : String(error),
        durationMs: 0,
        truncated: false,
        error: 'sandbox_request_invalid',
      },
    }, '*');
  }
}

function validateRequest(payload: unknown): SandboxRunnerRequest {
  const value = payload && typeof payload === 'object' ? payload as Partial<SandboxRunnerRequest> : {};
  if (
    value.language !== 'javascript' &&
    value.language !== 'typescript' &&
    value.language !== 'python' &&
    value.language !== 'html'
  ) {
    throw new Error('Sandbox runner only supports JavaScript, TypeScript, Python, and HTML.');
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
    pyodideBaseUrl: typeof value.pyodideBaseUrl === 'string' ? value.pyodideBaseUrl : undefined,
  };
}

function runHtmlSandbox(request: SandboxRunnerRequest): Promise<SandboxExecutionResult> {
  const startedAt = Date.now();
  const frame = document.createElement('iframe');
  frame.sandbox.add('allow-scripts');
  frame.style.display = 'none';
  document.body.appendChild(frame);

  const logs: string[] = [];
  const errors: string[] = [];
  let settled = false;
  const htmlRequestId = crypto.randomUUID();

  return new Promise((resolve) => {
    const finish = (result: Omit<SandboxExecutionResult, 'durationMs'>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      window.removeEventListener('message', onMessage);
      frame.remove();
      resolve({
        ...result,
        durationMs: Date.now() - startedAt,
      });
    };

    const timeout = setTimeout(() => {
      const stdout = limitText(logs.join('\n'), HTML_OUTPUT_LIMIT);
      const stderr = limitText(errors.concat('HTML sandbox execution timed out.').join('\n'), HTML_OUTPUT_LIMIT);
      finish({
        ok: false,
        stdout: stdout.text,
        stderr: stderr.text,
        truncated: stdout.truncated || stderr.truncated,
        error: 'sandbox_timeout',
      });
    }, request.timeoutMs);

    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow) return;
      const value = event.data && typeof event.data === 'object'
        ? event.data as { type?: unknown; requestId?: unknown; level?: unknown; values?: unknown; html?: unknown; text?: unknown; title?: unknown; message?: unknown }
        : {};
      if (value.requestId !== htmlRequestId) return;
      if (value.type === 'DWPLUS_HTML_LOG') {
        const level = typeof value.level === 'string' ? value.level : 'log';
        const values = Array.isArray(value.values) ? value.values : [];
        logs.push(`[${level}] ${values.map(formatHtmlValue).join(' ')}`);
        return;
      }
      if (value.type === 'DWPLUS_HTML_ERROR') {
        errors.push(typeof value.message === 'string' ? value.message : 'HTML runtime error.');
        return;
      }
      if (value.type === 'DWPLUS_HTML_DONE') {
        const stdout = limitText(logs.join('\n'), HTML_OUTPUT_LIMIT);
        const stderr = limitText(errors.join('\n'), HTML_OUTPUT_LIMIT);
        const html = typeof value.html === 'string' ? value.html : '';
        finish({
          ok: errors.length === 0,
          stdout: stdout.text,
          stderr: stderr.text,
          result: typeof value.title === 'string' && value.title ? value.title : 'HTML rendered',
          html,
          previewText: typeof value.text === 'string' ? limitText(value.text, HTML_OUTPUT_LIMIT).text : '',
          truncated: stdout.truncated || stderr.truncated || html.length > HTML_OUTPUT_LIMIT,
          error: errors.length > 0 ? 'sandbox_html_error' : undefined,
        });
      }
    };

    window.addEventListener('message', onMessage);
    frame.srcdoc = createHtmlDocument(request.code, htmlRequestId);
  });
}

function createHtmlDocument(source: string, requestId: string): string {
  const prelude = `<script>
(() => {
  const requestId = ${JSON.stringify(requestId)};
  const send = (payload) => parent.postMessage(Object.assign({ requestId }, payload), '*');
  const format = (value) => {
    if (value === undefined) return '';
    if (typeof value === 'string') return value;
    try { return JSON.stringify(value); } catch { return String(value); }
  };
  ['log', 'info', 'warn', 'error'].forEach((level) => {
    const original = console[level];
    console[level] = (...values) => {
      send({ type: 'DWPLUS_HTML_LOG', level, values: values.map(format) });
      if (typeof original === 'function') original.apply(console, values);
    };
  });
  addEventListener('error', (event) => {
    send({ type: 'DWPLUS_HTML_ERROR', message: event.message || String(event.error || 'Error') });
  });
  addEventListener('unhandledrejection', (event) => {
    send({ type: 'DWPLUS_HTML_ERROR', message: event.reason && event.reason.stack ? String(event.reason.stack) : String(event.reason) });
  });
  const done = () => setTimeout(() => {
    send({
      type: 'DWPLUS_HTML_DONE',
      title: document.title || '',
      text: document.body ? document.body.innerText : '',
      html: document.documentElement ? document.documentElement.outerHTML : (document.body ? document.body.outerHTML : ''),
    });
  }, ${HTML_EXECUTION_DELAY_MS});
  if (document.readyState === 'complete') done();
  else addEventListener('load', done, { once: true });
})();
</script>`;
  if (/<head[\s>]/i.test(source)) {
    return source.replace(/<head([^>]*)>/i, `<head$1>${prelude}`);
  }
  if (/<html[\s>]/i.test(source)) {
    return source.replace(/<html([^>]*)>/i, `<html$1><head>${prelude}</head>`);
  }
  return `<!doctype html><html><head>${prelude}</head><body>${source}</body></html>`;
}

function formatHtmlValue(value: unknown): string {
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value); } catch { return String(value); }
}

function limitText(text: string, limit: number): { text: string; truncated: boolean } {
  if (text.length <= limit) return { text, truncated: false };
  return { text: `${text.slice(0, limit)}\n...[truncated]`, truncated: true };
}
