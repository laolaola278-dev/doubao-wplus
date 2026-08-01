import { describe, expect, it } from 'vitest';
import {
  containsInternalPromptMarker,
  DEPRECATED_VISIBLE_USER_PROMPT_END,
  DEPRECATED_VISIBLE_USER_PROMPT_START,
  extractVisibleUserPrompt,
  markVisibleUserPrompt,
  sanitizeInternalPromptText,
} from '../core/prompt/visibility';

describe('visible user prompt markers', () => {
  it('writes only the Doubao WPlus marker', () => {
    const marked = markVisibleUserPrompt('请生成 test.md');
    expect(marked).toContain('doubao-wplus-visible-user-prompt:start');
    expect(marked).toContain('doubao-wplus-visible-user-prompt:end');
    expect(marked).not.toContain(DEPRECATED_VISIBLE_USER_PROMPT_START);
  });

  it('reads the new marker and sanitizes the internal prompt', () => {
    const marked = markVisibleUserPrompt('请生成 test.md');
    const text = `internal instructions\n${marked}`;
    expect(extractVisibleUserPrompt(text)).toBe('请生成 test.md');
    expect(sanitizeInternalPromptText(text)).toBe('请生成 test.md');
    expect(containsInternalPromptMarker(text)).toBe(true);
  });

  it('keeps reading the deprecated marker for existing conversations', () => {
    // backward compat: old brand
    const legacy = `${DEPRECATED_VISIBLE_USER_PROMPT_START}\n旧会话\n${DEPRECATED_VISIBLE_USER_PROMPT_END}`;
    expect(extractVisibleUserPrompt(legacy)).toBe('旧会话');
    expect(sanitizeInternalPromptText(`internal\n${legacy}`)).toBe('旧会话');
    expect(containsInternalPromptMarker(legacy)).toBe(true);
  });
});
