// core/interceptor/header-borrowing.ts
// 多宿主请求签名借用机制
// 策略：拦截宿主原生请求提取 X-Bogus / a_bogus / msToken / Cookie / Authorization，
//       缓存供插件构造的请求复用。签名有时效性，过期后降级为透传模式。
// 不逆向签名算法，只复用宿主已生成的有效头。

import type { HostId } from '../hosts/types';

interface BorrowedHeaders {
  'X-Bogus'?: string;
  'a_bogus'?: string;
  'msToken'?: string;
  'Cookie'?: string;
  'User-Agent'?: string;
  'Authorization'?: string;
  'X-App-Version'?: string;
  'x-client-platform'?: string;
  'x-client-version'?: string;
  'x-client-locale'?: string;
  'x-client-timezone-offset'?: string;
  capturedAt: number;
  sourceUrl: string;
}

interface BorrowingPolicy {
  /** 缓存有效期（毫秒） */
  maxAgeMs: number;
  /** 哪些 header 需要借用 */
  borrowedHeaderNames: readonly string[];
}

const DEFAULT_POLICIES: Record<HostId, BorrowingPolicy> = {
  doubao: {
    maxAgeMs: 3 * 60 * 1000,
    borrowedHeaderNames: ['X-Bogus', 'a_bogus', 'msToken', 'Cookie', 'User-Agent'],
  },
  deepseek: {
    maxAgeMs: 5 * 60 * 1000,
    borrowedHeaderNames: ['Authorization', 'X-App-Version', 'x-client-platform', 'x-client-version', 'x-client-locale', 'x-client-timezone-offset'],
  },
};

const cache = new Map<HostId, BorrowedHeaders>();

/**
 * 从拦截到的请求头中提取并缓存宿主签名。
 * 在 fetch-hook 拦截到宿主原生请求时调用。
 */
export function captureBorrowableHeaders(
  hostId: HostId,
  url: string,
  headers: Record<string, string>,
): void {
  const policy = DEFAULT_POLICIES[hostId];
  if (!policy) return;

  const borrowed: Partial<BorrowedHeaders> = {};
  let captured = false;

  for (const name of policy.borrowedHeaderNames) {
    const value = findHeaderCaseInsensitive(headers, name);
    if (value) {
      (borrowed as Record<string, string>)[name] = value;
      captured = true;
    }
  }

  if (captured) {
    cache.set(hostId, {
      ...(borrowed as BorrowedHeaders),
      capturedAt: Date.now(),
      sourceUrl: url,
    });
  }
}

/**
 * 获取借用的请求头。缓存过期或不存在时返回 null。
 * 调用方（fetch-hook）应在构造修改过的请求时把借用头合并到 init.headers。
 */
export function getBorrowedHeaders(hostId: HostId): Record<string, string> | null {
  const policy = DEFAULT_POLICIES[hostId];
  if (!policy) return null;

  const entry = cache.get(hostId);
  if (!entry) return null;

  const age = Date.now() - entry.capturedAt;
  if (age > policy.maxAgeMs) {
    cache.delete(hostId);
    return null;
  }

  const result: Record<string, string> = {};
  for (const name of policy.borrowedHeaderNames) {
    const value = (entry as unknown as Record<string, unknown>)[name];
    if (typeof value === 'string' && value.length > 0) {
      result[name] = value;
    }
  }
  return Object.keys(result).length > 0 ? result : null;
}

/** 清除指定宿主的缓存（用于宿主切换或登出） */
export function invalidateBorrowedHeaders(hostId: HostId): void {
  cache.delete(hostId);
}

function findHeaderCaseInsensitive(
  headers: Record<string, string>,
  target: string,
): string | undefined {
  const targetLower = target.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === targetLower) {
      return headers[key];
    }
  }
  return undefined;
}
