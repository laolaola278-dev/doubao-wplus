// tests/host-adapter.test.ts
// HostAdapter 单元测试 — 验证豆包 / DeepSeek adapter 行为一致性

import { describe, expect, it } from 'vitest';
import { DoubaoAdapter } from '../core/hosts/doubao/adapter';
import { DeepSeekAdapter } from '../core/hosts/deepseek/adapter';

describe('DoubaoAdapter', () => {
  const adapter = new DoubaoAdapter();

  it('id 与 name 正确', () => {
    expect(adapter.id).toBe('doubao');
    expect(adapter.name).toBe('豆包 (Doubao)');
  });

  it('matchUrl 匹配 www.doubao.com', () => {
    expect(adapter.matchUrl('https://www.doubao.com/chat/abc')).toBe(true);
  });

  it('matchUrl 匹配子域', () => {
    expect(adapter.matchUrl('https://bot.doubao.com/chat/abc')).toBe(true);
  });

  it('matchUrl 不匹配其他域名', () => {
    expect(adapter.matchUrl('https://chat.deepseek.com/a/chat/s/x')).toBe(false);
    expect(adapter.matchUrl('https://example.com/')).toBe(false);
  });

  it('getSelectors 返回数组形式的 fallback 选择器', () => {
    const sels = adapter.getSelectors();
    expect(sels.messageList).toBeInstanceOf(Array);
    expect(sels.userMessage).toBeInstanceOf(Array);
    expect(sels.assistantMessage).toBeInstanceOf(Array);
    expect(sels.inputBox.length).toBeGreaterThan(0);
    expect(sels.sendButton.length).toBeGreaterThan(0);
  });

  it('用户消息和助手消息选择器数组中至少有一项包含 bg-g-send 或否定它', () => {
    const sels = adapter.getSelectors();
    const userText = sels.userMessage.join(' ');
    const assistantText = sels.assistantMessage.join(' ');
    expect(userText).toContain('bg-g-send');
    expect(assistantText).toContain(':not(.bg-g-send)');
  });

  it('getPaths 返回三段式端点', () => {
    const paths = adapter.getPaths();
    expect(paths.completion).toMatch(/^\//);
    expect(paths.regenerate).toMatch(/^\//);
    expect(paths.history).toMatch(/^\//);
  });
});

describe('DeepSeekAdapter', () => {
  const adapter = new DeepSeekAdapter();

  it('id 与 name 正确', () => {
    expect(adapter.id).toBe('deepseek');
    expect(adapter.name).toBe('DeepSeek');
  });

  it('matchUrl 匹配 chat.deepseek.com', () => {
    expect(adapter.matchUrl('https://chat.deepseek.com/a/chat/s/abc')).toBe(true);
  });

  it('matchUrl 不匹配豆包', () => {
    expect(adapter.matchUrl('https://www.doubao.com/chat/x')).toBe(false);
  });

  it('isChatStreamUrl 识别流式端点', () => {
    expect(adapter.isChatStreamUrl('https://chat.deepseek.com/api/v0/chat/completion')).toBe(true);
    expect(adapter.isChatStreamUrl('https://chat.deepseek.com/api/v0/chat/regenerate')).toBe(true);
    expect(adapter.isChatStreamUrl('https://chat.deepseek.com/api/v0/chat/history_messages')).toBe(false);
  });

  it('isHistoryUrl 识别历史端点', () => {
    expect(adapter.isHistoryUrl('https://chat.deepseek.com/api/v0/chat/history_messages')).toBe(true);
    expect(adapter.isHistoryUrl('https://chat.deepseek.com/api/v0/chat/completion')).toBe(false);
  });
});
