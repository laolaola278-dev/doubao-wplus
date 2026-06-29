// tests/host-url-parser.test.ts
// URL 会话解析测试 — 覆盖 DeepSeek / Doubao 各种 URL 场景

import { describe, expect, it } from 'vitest';
import { parseSessionId } from '../core/hosts/shared/url-utils';

describe('parseSessionId', () => {
  describe('deepseek', () => {
    it('提取普通 /a/chat/s/{id} 会话', () => {
      expect(parseSessionId('https://chat.deepseek.com/a/chat/s/abc-123', 'deepseek'))
        .toBe('abc-123');
    });

    it('提取无前缀 /chat/s/{id} 会话', () => {
      expect(parseSessionId('https://chat.deepseek.com/chat/s/xyz-789', 'deepseek'))
        .toBe('xyz-789');
    });

    it('URL 编码的 session id 能被解码', () => {
      expect(parseSessionId('https://chat.deepseek.com/a/chat/s/abc%2D123', 'deepseek'))
        .toBe('abc-123');
    });

    it('带 query 参数也能正确解析', () => {
      expect(parseSessionId('https://chat.deepseek.com/a/chat/s/sess_01?from=share', 'deepseek'))
        .toBe('sess_01');
    });

    it('带 hash 也能正确解析', () => {
      expect(parseSessionId('https://chat.deepseek.com/a/chat/s/sess_02#messages', 'deepseek'))
        .toBe('sess_02');
    });

    it('非会话页面（首页）返回 null', () => {
      expect(parseSessionId('https://chat.deepseek.com/', 'deepseek')).toBeNull();
    });

    it('非会话页面（设置）返回 null', () => {
      expect(parseSessionId('https://chat.deepseek.com/settings/profile', 'deepseek')).toBeNull();
    });

    it('分享页（无 session id）返回 null', () => {
      expect(parseSessionId('https://chat.deepseek.com/share/xyz', 'deepseek')).toBeNull();
    });

    it('非 deepseek 域名返回 null', () => {
      expect(parseSessionId('https://www.doubao.com/chat/abc', 'deepseek')).toBeNull();
    });
  });

  describe('doubao', () => {
    it('提取 /chat/{id} 会话', () => {
      expect(parseSessionId('https://www.doubao.com/chat/sess_01', 'doubao'))
        .toBe('sess_01');
    });

    it('子域 doubao.com 也能解析', () => {
      expect(parseSessionId('https://bot.doubao.com/chat/sess_02', 'doubao'))
        .toBe('sess_02');
    });

    it('非目标路径返回 null', () => {
      expect(parseSessionId('https://www.doubao.com/', 'doubao')).toBeNull();
    });
  });

  describe('边界情况', () => {
    it('非法 URL 返回 null 而不抛错', () => {
      expect(parseSessionId('not-a-url', 'deepseek')).toBeNull();
    });

    it('空字符串返回 null', () => {
      expect(parseSessionId('', 'deepseek')).toBeNull();
    });

    it('未知 host 返回 null', () => {
      // @ts-expect-error 测试非法 host
      expect(parseSessionId('https://example.com/chat/x', 'unknown')).toBeNull();
    });
  });
});
