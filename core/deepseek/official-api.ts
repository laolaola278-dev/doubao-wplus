import {
  DEFAULT_OFFICIAL_API_CHAT_CONFIG,
  normalizeOfficialApiChatConfig,
  type OfficialApiChatConfig,
} from '../chat/official-api-config';
import { parseSSEChunk, parseSSEData } from '../interceptor/sse-parser';

// 豆包官方 API（火山方舟 Ark）兼容 OpenAI 样式的 chat/completions 端点。
// 默认指向北京地域；如有需要可通过 SubmitOfficialDoubaoInput.endpoint 覆盖。
export const DOUBAO_OFFICIAL_API_URL = 'https://ark.cn-beijing.volces.com/api/v3/chat/completions';

export interface OfficialDoubaoMessage {
  role: 'user' | 'assistant';
  content: string;
  reasoningContent?: string;
}

export interface OfficialDoubaoTurn {
  assistantText: string;
  reasoningText: string;
  finished: boolean;
}

export interface OfficialDoubaoCallbacks {
  onTextChunk?(text: string, fullText: string): void;
  onReasoningChunk?(text: string, fullText: string): void;
  onFinished?(): void;
}

export interface SubmitOfficialDoubaoInput {
  apiKey: string;
  config?: OfficialApiChatConfig;
  messages: OfficialDoubaoMessage[];
  fetchImpl?: typeof fetch;
  endpoint?: string;
}

export class DoubaoOfficialApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DoubaoOfficialApiError';
  }
}

export async function submitOfficialDoubaoStreaming(
  input: SubmitOfficialDoubaoInput,
  callbacks: OfficialDoubaoCallbacks,
  signal?: AbortSignal,
): Promise<OfficialDoubaoTurn> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl(input.endpoint ?? DOUBAO_OFFICIAL_API_URL, {
    method: 'POST',
    signal,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${input.apiKey}`,
    },
    body: JSON.stringify(createOfficialDoubaoRequestBody(input)),
  });

  if (!response.ok) {
    throw new DoubaoOfficialApiError(await readOfficialApiFailure(response));
  }

  if (!response.body) {
    throw new DoubaoOfficialApiError('豆包官方 API 响应未包含流式 body。');
  }

  return readOfficialApiStream(response, callbacks);
}

export function createOfficialDoubaoRequestBody(input: Pick<SubmitOfficialDoubaoInput, 'config' | 'messages'>) {
  const config = normalizeOfficialApiChatConfig(input.config ?? DEFAULT_OFFICIAL_API_CHAT_CONFIG);
  return {
    model: config.model,
    messages: input.messages.map((message) => ({
      role: message.role,
      content: message.content,
      ...(config.thinking === 'enabled' && message.reasoningContent
        ? { reasoning_content: message.reasoningContent }
        : {}),
    })),
    stream: true,
    thinking: {
      type: config.thinking,
    },
    ...(config.thinking === 'enabled' ? { reasoning_effort: config.reasoningEffort } : {}),
  };
}

async function readOfficialApiStream(
  response: Response,
  callbacks: OfficialDoubaoCallbacks,
): Promise<OfficialDoubaoTurn> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const turn: OfficialDoubaoTurn = { assistantText: '', reasoningText: '', finished: false };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const boundary = buffer.lastIndexOf('\n\n');
    if (boundary === -1) continue;

    const complete = buffer.slice(0, boundary + 2);
    buffer = buffer.slice(boundary + 2);
    consumeOfficialApiSse(complete, turn, callbacks);
  }

  if (buffer.trim()) {
    consumeOfficialApiSse(buffer, turn, callbacks);
  }

  callbacks.onFinished?.();
  return turn;
}

function consumeOfficialApiSse(
  text: string,
  turn: OfficialDoubaoTurn,
  callbacks: OfficialDoubaoCallbacks,
) {
  const events = parseSSEChunk(text);
  for (const event of events) {
    if (event.data === '[DONE]') {
      turn.finished = true;
      continue;
    }

    const parsed = parseSSEData(event.data);
    const newReasoningText = extractOfficialApiDeltaReasoningText(parsed);
    if (newReasoningText) {
      turn.reasoningText += newReasoningText;
      callbacks.onReasoningChunk?.(newReasoningText, turn.reasoningText);
    }

    const newText = extractOfficialApiDeltaText(parsed);
    if (newText) {
      turn.assistantText += newText;
      callbacks.onTextChunk?.(newText, turn.assistantText);
    }

    if (isOfficialApiFinished(parsed)) {
      turn.finished = true;
    }
  }
}

function extractOfficialApiDeltaReasoningText(parsed: unknown): string {
  if (!parsed || typeof parsed !== 'object') return '';
  const choices = (parsed as { choices?: unknown }).choices;
  if (!Array.isArray(choices)) return '';

  return choices
    .map((choice) => {
      if (!choice || typeof choice !== 'object') return '';
      const delta = (choice as { delta?: unknown }).delta;
      if (!delta || typeof delta !== 'object') return '';
      const content = (delta as { reasoning_content?: unknown; thinking_content?: unknown }).reasoning_content ??
        (delta as { thinking_content?: unknown }).thinking_content;
      return typeof content === 'string' ? content : '';
    })
    .join('');
}

function extractOfficialApiDeltaText(parsed: unknown): string {
  if (!parsed || typeof parsed !== 'object') return '';
  const choices = (parsed as { choices?: unknown }).choices;
  if (!Array.isArray(choices)) return '';

  return choices
    .map((choice) => {
      if (!choice || typeof choice !== 'object') return '';
      const delta = (choice as { delta?: unknown }).delta;
      if (!delta || typeof delta !== 'object') return '';
      const content = (delta as { content?: unknown }).content;
      return typeof content === 'string' ? content : '';
    })
    .join('');
}

function isOfficialApiFinished(parsed: unknown): boolean {
  if (!parsed || typeof parsed !== 'object') return false;
  const choices = (parsed as { choices?: unknown }).choices;
  return Array.isArray(choices) && choices.some((choice) =>
    choice &&
    typeof choice === 'object' &&
    typeof (choice as { finish_reason?: unknown }).finish_reason === 'string'
  );
}

async function readOfficialApiFailure(response: Response): Promise<string> {
  const text = await response.text().catch(() => '');
  if (!text) return `豆包官方 API 请求失败，HTTP 状态码 ${response.status}。`;

  try {
    const parsed = JSON.parse(text);
    const message = parsed?.error?.message ?? parsed?.message;
    if (typeof message === 'string' && message.trim()) {
      return message;
    }
  } catch {}

  return text;
}
