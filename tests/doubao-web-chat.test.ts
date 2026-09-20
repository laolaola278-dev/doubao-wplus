import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildDoubaoWebChatBody,
  extractDoubaoConversationId,
  isSnapshotFresh,
  runDoubaoWebChatTurn,
  type DoubaoWebChatSnapshot,
} from '../core/chat/doubao-web';
import { refreshDoubaoWebChatReady, submitDoubaoWebChat } from '../core/chat/doubao-web-relay';

// 与 tests/request-augmentation.test.ts 的真机抓包骨架保持同构的字段模板
function createSnapshotBodyTemplate(): string {
  return JSON.stringify({
    client_meta: {
      local_conversation_id: 'local_123',
      conversation_id: '',
      bot_id: '7338286299411103781',
      last_section_id: '',
      last_message_index: null,
    },
    messages: [{
      local_message_id: 'uuid-1',
      content_block: [{
        block_type: 10000,
        content: {
          text_block: { text: '旧文本', icon_url: '', icon_url_dark: '', summary: '' },
          pc_event_block: '',
        },
        block_id: 'uuid-2',
        parent_id: '',
        meta_info: [],
        append_fields: [],
      }],
      message_status: 0,
    }],
    option: { need_deep_think: 0, is_regen: false, need_create_conversation: true },
    ext: { use_deep_think: '0' },
  });
}

function createSnapshot(): DoubaoWebChatSnapshot {
  return {
    url: 'https://www.doubao.com/samantha/chat/completion?aid=497858&msToken=token&a_bogus=bogus',
    headers: { 'content-type': 'application/json' },
    body: createSnapshotBodyTemplate(),
    capturedAt: Date.now(),
  };
}

function createSseResponse(frames: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(frame));
      controller.close();
    },
  });
  return { ok: true, status: 200, body: stream } as unknown as Response;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('buildDoubaoWebChatBody', () => {
  it('首轮：写回 prompt、清空会话字段并保留 need_create_conversation=true', () => {
    const body = JSON.parse(buildDoubaoWebChatBody(createSnapshotBodyTemplate(), {
      prompt: '你好豆包',
      conversationId: null,
      lastMessageIndex: null,
    }, 'msg-new')) as Record<string, any>;

    expect(body.messages[0].content_block[0].content.text_block.text).toBe('你好豆包');
    expect(body.client_meta.conversation_id).toBe('');
    expect(body.client_meta.last_message_index).toBeNull();
    expect(body.client_meta.bot_id).toBe('7338286299411103781');
    expect(body.option.need_create_conversation).toBe(true);
    expect(body.local_message_id).toBe('msg-new');
  });

  it('续轮：携带会话 ID 与消息序号并关闭 need_create_conversation', () => {
    const body = JSON.parse(buildDoubaoWebChatBody(createSnapshotBodyTemplate(), {
      prompt: '继续',
      conversationId: 'c-42',
      lastMessageIndex: 3,
    }, 'msg-next')) as Record<string, any>;

    expect(body.client_meta.conversation_id).toBe('c-42');
    expect(body.client_meta.last_message_index).toBe(3);
    expect(body.option.need_create_conversation).toBe(false);
  });

  it('模板缺失 prompt 字段时抛错（写不进即失败，不构造残缺请求）', () => {
    const broken = JSON.stringify({ client_meta: { conversation_id: '' } });
    expect(() => buildDoubaoWebChatBody(broken, {
      prompt: 'x',
      conversationId: null,
      lastMessageIndex: null,
    }, 'm')).toThrow('doubao_web_template_missing_prompt_field');
  });

  it('模板 JSON 非法时抛错', () => {
    expect(() => buildDoubaoWebChatBody('not-json', {
      prompt: 'x',
      conversationId: null,
      lastMessageIndex: null,
    }, 'm')).toThrow('doubao_web_snapshot_body_unreadable');
  });
});

describe('extractDoubaoConversationId', () => {
  it('从嵌套结构中提取 conversation_id', () => {
    expect(extractDoubaoConversationId({ data: { conversation_id: 'c-1' } })).toBe('c-1');
    expect(extractDoubaoConversationId({ a: [{ b: { conversation_id: 'c-2' } }] })).toBe('c-2');
  });

  it('缺失或空值返回 null', () => {
    expect(extractDoubaoConversationId({ data: {} })).toBeNull();
    expect(extractDoubaoConversationId({ conversation_id: '' })).toBeNull();
    expect(extractDoubaoConversationId(null)).toBeNull();
  });
});

describe('runDoubaoWebChatTurn', () => {
  it('流式聚合文本增量并提取会话 ID，请求带 Bypass 头与签名 URL', async () => {
    const fetchImpl = vi.fn(async (url: unknown, init?: RequestInit) => {
      expect(String(url)).toContain('a_bogus=bogus');
      expect((init?.headers as Record<string, string>)['X-DWPLUS-Bypass-Hook']).toBe('1');
      const sentBody = JSON.parse(String(init?.body)) as Record<string, any>;
      expect(sentBody.messages[0].content_block[0].content.text_block.text).toBe('测试输入');
      return createSseResponse([
        'data: {"data":{"conversation_id":"c-9"}}\n\n',
        'data: {"v":"你"}\n\n',
        'data: {"v":"好，","o":"APPEND","p":"response/message"}\n\n',
        'data: {"o":"BATCH","v":[{"v":"世界"}]}\n\n',
      ]);
    });

    const deltas: string[] = [];
    const result = await runDoubaoWebChatTurn({
      snapshot: createSnapshot(),
      payload: { prompt: '测试输入', conversationId: null, lastMessageIndex: null },
      fetchImpl: fetchImpl as unknown as typeof fetch,
      onChunk: (delta) => deltas.push(delta),
    });

    expect(result.text).toBe('你好，世界');
    expect(result.conversationId).toBe('c-9');
    expect(deltas).toEqual(['你', '好，', '世界']);
  });

  it('HTTP 非 2xx 时抛错并携带状态码', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 403, body: null }) as unknown as Response);
    await expect(runDoubaoWebChatTurn({
      snapshot: createSnapshot(),
      payload: { prompt: 'x', conversationId: null, lastMessageIndex: null },
      fetchImpl,
      onChunk: () => {},
    })).rejects.toThrow('doubao_web_chat_http_403');
  });
});

describe('isSnapshotFresh', () => {
  it('3 分钟内的快照可用，过期不可用', () => {
    const fresh = { ...createSnapshot(), capturedAt: Date.now() - 60_000 };
    const stale = { ...createSnapshot(), capturedAt: Date.now() - 4 * 60_000 };
    expect(isSnapshotFresh(fresh)).toBe(true);
    expect(isSnapshotFresh(stale)).toBe(false);
    expect(isSnapshotFresh(null)).toBe(false);
  });
});

describe('doubao-web relay（后台侧）', () => {
  it('ready 探测：命中 ready=true 的 tab 即成功，活跃 tab 优先', async () => {
    const queried: chrome.tabs.QueryInfo[] = [];
    const sendTabMessage = vi.fn(async (_tabId: number, message: unknown) => {
      expect((message as { type: string }).type).toBe('DOUBAO_WEB_CHAT_READY');
      return { ready: true };
    });
    const ok = await refreshDoubaoWebChatReady({
      queryTabs: async (query) => {
        queried.push(query);
        return [{ id: 7, active: false }, { id: 3, active: true }] as chrome.tabs.Tab[];
      },
      sendTabMessage,
      preferredTabId: 3,
    });
    expect(ok).toBe(true);
    expect(queried[0]).toEqual({ url: '*://*.doubao.com/*' });
    expect(sendTabMessage.mock.calls[0][0]).toBe(3);
  });

  it('ready 探测：所有 tab 均未就绪或查询失败时返回 false', async () => {
    const allMiss = await refreshDoubaoWebChatReady({
      queryTabs: async () => [{ id: 7, active: true }] as chrome.tabs.Tab[],
      sendTabMessage: async () => ({ ready: false }),
    });
    expect(allMiss).toBe(false);

    const queryFailed = await refreshDoubaoWebChatReady({
      queryTabs: async () => {
        throw new Error('context invalidated');
      },
      sendTabMessage: async () => ({ ready: true }),
    });
    expect(queryFailed).toBe(false);
  });

  it('提交转发：命中 ok=true 的 tab 即接受，且跳过 excludeTabId', async () => {
    const sendTabMessage = vi.fn(async (_tabId: number, message: unknown) => {
      expect((message as { type: string }).type).toBe('DOUBAO_WEB_CHAT_SUBMIT');
      expect((message as { payload: { prompt: string } }).payload.prompt).toBe('任务');
      return { ok: true };
    });
    const ok = await submitDoubaoWebChat({
      queryTabs: async () => [{ id: 9, active: true }, { id: 4, active: false }] as chrome.tabs.Tab[],
      sendTabMessage,
      excludeTabId: 9,
    }, { prompt: '任务', conversationId: null, lastMessageIndex: null });
    expect(ok).toBe(true);
    expect(sendTabMessage.mock.calls[0][0]).toBe(4);
  });
});
