// core/chat/doubao-web.ts
// 豆包网页会话直连（sidepanel 对话页 doubao-web 模式）
// 策略红线：不逆向签名算法。补全请求的 a_bogus/msToken 签名位于 URL query 且不绑定 body hash
// （见 docs/host-compatibility-matrix.md），因此复用宿主页最近一次真实补全请求的 URL 与
// 借用头，在 MAIN 世界以 X-DWPLUS-Bypass-Hook 绕过自身 hook 重新发起请求，仅替换 body 中的
// prompt 与会话字段。快照不存在（页面未发过消息）时明确报错，不构造伪造签名。

import { parseSSEChunk, parseSSEData, extractTextFromParsed } from '../interceptor/sse-parser';
import { readBodyField, writeBodyField } from '../hosts/shared/body-fields';

/** 豆包嵌套请求体的字段映射（与 DoubaoAdapter.getRequestBodyFields 保持一致） */
export const DOUBAO_BODY_FIELDS = {
  prompt: 'messages.0.content_block.0.content.text_block.text',
  chatSessionId: 'client_meta.conversation_id',
} as const;

/** 最近一次真实补全请求的页面内快照（MAIN 世界持有；3 分钟时效同 borrowing 策略） */
export interface DoubaoWebChatSnapshot {
  /** 完整 URL（含 a_bogus/msToken/fp 等签名 query） */
  url: string;
  /** 页面请求头（content-type 等；Cookie 由浏览器 credentials 自动携带） */
  headers: Record<string, string>;
  /** 原始请求体（JSON 字符串，作为字段模板：bot_id/local ids 等宿主字段保真复用） */
  body: string;
  capturedAt: number;
}

export const DOUBAO_SNAPSHOT_MAX_AGE_MS = 3 * 60 * 1000;

export interface DoubaoWebChatSubmitPayload {
  /** 增强后的用户输入（已完成记忆/Skill/预设拼装） */
  prompt: string;
  /** 续轮会话 ID；首轮为 null（模板 conversation_id 为空 + need_create_conversation=true） */
  conversationId: string | null;
  /**
   * 续轮消息序号（client_meta.last_message_index）；首轮为 null。
   * 语义按首条消息为 null、其后从 0 递增处理。
   */
  lastMessageIndex: number | null;
}

export interface DoubaoWebChatTurnResult {
  text: string;
  /** 从响应中尽力提取的会话 ID（提取失败为 null，多轮上下文将退化为每轮新建） */
  conversationId: string | null;
}

/**
 * 基于真机请求体模板构造本轮补全请求体。
 * 写入不自动建层：模板缺失目标字段时抛错（模板来自真实请求，正常必然存在）。
 */
export function buildDoubaoWebChatBody(
  snapshotBody: string,
  payload: DoubaoWebChatSubmitPayload,
  newMessageId: string,
): string {
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(snapshotBody) as Record<string, unknown>;
  } catch {
    throw new Error('doubao_web_snapshot_body_unreadable');
  }
  if (!writeBodyField(body, DOUBAO_BODY_FIELDS.prompt, payload.prompt)) {
    throw new Error('doubao_web_template_missing_prompt_field');
  }
  const clientMeta = body.client_meta;
  if (!clientMeta || typeof clientMeta !== 'object') {
    throw new Error('doubao_web_template_missing_client_meta');
  }
  const meta = clientMeta as Record<string, unknown>;
  meta.conversation_id = payload.conversationId ?? '';
  meta.last_message_index = payload.lastMessageIndex;
  const option = body.option;
  if (option && typeof option === 'object') {
    (option as Record<string, unknown>).need_create_conversation = payload.conversationId == null;
  }
  body.local_message_id = newMessageId;
  return JSON.stringify(body);
}

/** 从响应 JSON 中递归提取 conversation_id（豆包响应在多个层级出现过该字段） */
export function extractDoubaoConversationId(value: unknown, depth = 0): string | null {
  if (depth > 6 || value == null || typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = extractDoubaoConversationId(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  const record = value as Record<string, unknown>;
  for (const [key, item] of Object.entries(record)) {
    if (key === 'conversation_id' && typeof item === 'string' && item.length > 0) return item;
  }
  for (const item of Object.values(record)) {
    const found = extractDoubaoConversationId(item, depth + 1);
    if (found) return found;
  }
  return null;
}

/**
 * 执行一轮豆包网页补全：复用快照 URL/头，流式解析 SSE（JSON-Patch 风格，与
 * fetch-hook 处理宿主响应同一套解析器），输出文本增量与最终全文。
 * fetchImpl 注入以便单元测试；signal 透传取消。
 */
export async function runDoubaoWebChatTurn(options: {
  snapshot: DoubaoWebChatSnapshot;
  payload: DoubaoWebChatSubmitPayload;
  messageId?: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  onChunk: (delta: string, fullText: string) => void;
}): Promise<DoubaoWebChatTurnResult> {
  const { snapshot, payload, signal, onChunk } = options;
  const doFetch = options.fetchImpl ?? fetch;
  const body = buildDoubaoWebChatBody(
    snapshot.body,
    payload,
    options.messageId ?? generateMessageId(),
  );
  const response = await doFetch(snapshot.url, {
    method: 'POST',
    credentials: 'include',
    signal,
    headers: {
      ...snapshot.headers,
      'X-DWPLUS-Bypass-Hook': '1',
    },
    body,
  });
  if (!response.ok || !response.body) {
    throw new Error(`doubao_web_chat_http_${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = '';
  let fullText = '';
  let conversationId: string | null = null;

  const consumeEvent = (raw: unknown): void => {
    const text = extractTextFromParsed(raw);
    if (text) {
      fullText += text;
      onChunk(text, fullText);
    }
    if (!conversationId) {
      conversationId = extractDoubaoConversationId(raw);
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffered += decoder.decode(value, { stream: true });
    const frames = buffered.split('\n\n');
    buffered = frames.pop() ?? '';
    for (const frame of frames) {
      for (const event of parseSSEChunk(frame)) {
        if (event.data) consumeEvent(parseSSEData(event.data));
      }
    }
  }
  if (buffered.trim()) {
    for (const event of parseSSEChunk(buffered)) {
      if (event.data) consumeEvent(parseSSEData(event.data));
    }
  }

  return { text: fullText, conversationId };
}

/** 快照是否可用（存在且未过期） */
export function isSnapshotFresh(snapshot: DoubaoWebChatSnapshot | null, now = Date.now()): snapshot is DoubaoWebChatSnapshot {
  return !!snapshot && now - snapshot.capturedAt <= DOUBAO_SNAPSHOT_MAX_AGE_MS;
}

function generateMessageId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }
}

// readBodyField 当前仅用于类型对齐引用，避免后续映射扩展时遗漏导入约束
void readBodyField;
