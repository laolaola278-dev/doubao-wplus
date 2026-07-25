// tests/body-fields.test.ts
// core/hosts/shared/body-fields.ts 回归测试 — 点分路径读写语义
//
// 这些语义是 Prompt 增强在嵌套 body 宿主（豆包）上工作的基石，
// 后续任何修改都不允许破坏：
//   - 单段路径 = 顶层字段（DeepSeek 兼容行为）
//   - 多段路径穿透对象与数组下标
//   - 空路径：读 undefined、写 no-op
//   - 写入不自动创建中间容器（不向宿主注入未知结构）
//   - 最后一段允许在已存在的父对象上新建键

import { describe, expect, it } from 'vitest';
import { isFlagEnabled, readBodyField, writeBodyField } from '../core/hosts/shared/body-fields';

describe('readBodyField', () => {
  it('single-segment path reads a top-level field (DeepSeek flat body)', () => {
    expect(readBodyField({ prompt: 'hi' }, 'prompt')).toBe('hi');
  });

  it('multi-segment path traverses nested objects and array indices (doubao body)', () => {
    const body = {
      messages: [{ content_block: [{ content: { text_block: { text: 'hello' } } }] }],
    };
    expect(readBodyField(body, 'messages.0.content_block.0.content.text_block.text')).toBe('hello');
  });

  it('empty path returns undefined', () => {
    expect(readBodyField({ prompt: 'hi' }, '')).toBeUndefined();
  });

  it('missing intermediate container returns undefined without throwing', () => {
    expect(readBodyField({}, 'a.b.c')).toBeUndefined();
    expect(readBodyField({ a: null }, 'a.b')).toBeUndefined();
    expect(readBodyField({ a: 'scalar' }, 'a.b')).toBeUndefined();
  });

  it('out-of-range or non-integer array index returns undefined', () => {
    expect(readBodyField({ arr: ['x'] }, 'arr.5')).toBeUndefined();
    expect(readBodyField({ arr: ['x'] }, 'arr.notanum')).toBeUndefined();
  });

  it('preserves falsy leaf values (null / 0 / empty string)', () => {
    expect(readBodyField({ a: { b: null } }, 'a.b')).toBeNull();
    expect(readBodyField({ a: { b: 0 } }, 'a.b')).toBe(0);
    expect(readBodyField({ a: { b: '' } }, 'a.b')).toBe('');
  });
});

describe('writeBodyField', () => {
  it('single-segment path writes a top-level field, creating the key if absent', () => {
    const body: Record<string, unknown> = { prompt: 'old' };
    expect(writeBodyField(body, 'prompt', 'new')).toBe(true);
    expect(body.prompt).toBe('new');
    // 旧行为兼容：顶层允许新建键（DeepSeek model_type 写入依赖此语义）
    expect(writeBodyField(body, 'model_type', 'expert')).toBe(true);
    expect(body.model_type).toBe('expert');
  });

  it('multi-segment path writes through nested objects and array indices', () => {
    const body = {
      messages: [{ content_block: [{ content: { text_block: { text: 'original' } } }] }],
    };
    const path = 'messages.0.content_block.0.content.text_block.text';
    expect(writeBodyField(body, path, 'augmented')).toBe(true);
    expect(readBodyField(body, path)).toBe('augmented');
  });

  it('empty path is a no-op returning false', () => {
    const body = { a: 1 };
    expect(writeBodyField(body, '', 'x')).toBe(false);
    expect(body).toEqual({ a: 1 });
  });

  it('does NOT auto-create missing intermediate containers', () => {
    const body: Record<string, unknown> = {};
    expect(writeBodyField(body, 'messages.0.content_block.0.content.text_block.text', 'x')).toBe(false);
    // 不向宿主注入服务端不认识的结构骨架
    expect(body).toEqual({});
  });

  it('refuses to grow an array (out-of-range index write fails)', () => {
    const body = { arr: ['a'] };
    expect(writeBodyField(body, 'arr.3', 'x')).toBe(false);
    expect(body.arr).toEqual(['a']);
  });

  it('allows creating the last segment key on an existing parent object', () => {
    const body = { option: {} as Record<string, unknown> };
    expect(writeBodyField(body, 'option.need_deep_think', 1)).toBe(true);
    expect(body.option.need_deep_think).toBe(1);
  });

  it('fails when final parent is not an object', () => {
    expect(writeBodyField({ a: 'scalar' }, 'a.b', 'x')).toBe(false);
    expect(writeBodyField(null, 'a', 'x')).toBe(false);
  });
});

describe('isFlagEnabled', () => {
  it('accepts DeepSeek boolean and doubao numeric flags', () => {
    expect(isFlagEnabled(true)).toBe(true);
    expect(isFlagEnabled(1)).toBe(true);
    expect(isFlagEnabled('1')).toBe(true);
  });

  it('rejects everything else', () => {
    expect(isFlagEnabled(false)).toBe(false);
    expect(isFlagEnabled(0)).toBe(false);
    expect(isFlagEnabled('0')).toBe(false);
    expect(isFlagEnabled(undefined)).toBe(false);
    expect(isFlagEnabled(null)).toBe(false);
    expect(isFlagEnabled('true')).toBe(false);
  });
});

// 真实映射契约：两个 adapter 声明的每个非空路径都能在各自真实 body 骨架上读写。
// 防止 adapter 映射与 body-fields 实现漂移。
describe('adapter mapping contract', () => {
  it('doubao mapping round-trips against the real captured body shape', async () => {
    const { DoubaoAdapter } = await import('../core/hosts/doubao/adapter');
    const fields = new DoubaoAdapter().getRequestBodyFields();
    // 2026-07-16 真机抓包骨架（phase2-06-body-structures.json）
    const body = {
      client_meta: { conversation_id: '', bot_id: 'b', last_section_id: '', last_message_index: null },
      messages: [{
        local_message_id: 'm',
        content_block: [{ block_type: 10000, content: { text_block: { text: 'user text' }, pc_event_block: '' } }],
        message_status: 0,
      }],
      option: { need_deep_think: 0, is_regen: false, need_create_conversation: true },
    };

    expect(readBodyField(body, fields.prompt)).toBe('user text');
    expect(writeBodyField(body, fields.prompt, 'augmented')).toBe(true);
    expect(readBodyField(body, fields.prompt)).toBe('augmented');
    expect(readBodyField(body, fields.parentMessageId)).toBeNull(); // 新会话 = null
    expect(readBodyField(body, fields.chatSessionId)).toBe('');
    expect(readBodyField(body, fields.thinkingEnabled)).toBe(0);
    // 声明缺失字段：读 undefined、写 no-op
    for (const key of ['refFileIds', 'modelType', 'searchEnabled'] as const) {
      expect(fields[key]).toBe('');
      expect(readBodyField(body, fields[key])).toBeUndefined();
      expect(writeBodyField(body, fields[key], 'x')).toBe(false);
    }
  });

  it('deepseek mapping keeps legacy flat top-level behavior', async () => {
    const { DeepSeekAdapter } = await import('../core/hosts/deepseek/adapter');
    const fields = new DeepSeekAdapter().getRequestBodyFields();
    const body: Record<string, unknown> = {
      prompt: 'q',
      parent_message_id: null,
      chat_session_id: 's',
      thinking_enabled: true,
    };
    expect(readBodyField(body, fields.prompt)).toBe('q');
    expect(writeBodyField(body, fields.modelType, 'expert')).toBe(true); // 顶层允许新建键
    expect(body.model_type).toBe('expert');
  });
});
