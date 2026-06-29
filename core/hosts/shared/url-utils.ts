// core/hosts/shared/url-utils.ts
// URL 会话解析 — 独立可测试模块

import type { HostId } from '../types';

/**
 * 从 URL 解析会话 ID。
 * 不同宿主有不同的 URL 结构。
 */
export function parseSessionId(url: string, host: HostId): string | null {
  try {
    const parsed = new URL(url);
    switch (host) {
      case 'deepseek':
        // /a/chat/s/{sessionId}  或  /chat/s/{sessionId}
        const dsMatch = parsed.pathname.match(/\/(?:a\/)?chat\/s\/([^/?#]+)/);
        return dsMatch?.[1] ? decodeURIComponent(dsMatch[1]) : null;

      case 'doubao':
        // 豆包 URL 结构待确认后补充
        // 占位：/chat/{sessionId}
        const dbMatch = parsed.pathname.match(/\/chat\/([^/?#]+)/);
        return dbMatch?.[1] ? decodeURIComponent(dbMatch[1]) : null;

      default:
        return null;
    }
  } catch {
    return null;
  }
}
