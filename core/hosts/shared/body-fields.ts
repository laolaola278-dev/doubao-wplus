// core/hosts/shared/body-fields.ts
// 请求体字段路径读写工具。
//
// RequestBodyFieldMapping 的字段值语义为「点分路径」而不仅是顶层字段名：
//   - DeepSeek: 'prompt'（单段路径，等价于旧的顶层字段名，行为不变）
//   - 豆包:    'messages.0.content_block.0.content.text_block.text'（嵌套路径，数字段为数组下标）
//   - 空字符串 '': 宿主不存在该语义字段（读返回 undefined，写为 no-op）
//
// 写入策略：不自动创建中间容器 —— 路径中某一层缺失时放弃写入，
// 避免向宿主请求体注入服务端不认识的结构骨架。
// 最后一段允许在已存在的父对象上新建键（保持 DeepSeek 顶层字段写入的旧行为）。

function pathSegments(path: string): string[] {
  return path.split('.');
}

function stepInto(node: unknown, segment: string): unknown {
  if (node == null || typeof node !== 'object') return undefined;
  if (Array.isArray(node)) {
    const index = Number(segment);
    return Number.isInteger(index) ? node[index] : undefined;
  }
  return (node as Record<string, unknown>)[segment];
}

/** 按点分路径读取字段值；路径为空或任一层缺失时返回 undefined */
export function readBodyField(body: unknown, path: string): unknown {
  if (!path) return undefined;
  let node: unknown = body;
  for (const segment of pathSegments(path)) {
    node = stepInto(node, segment);
    if (node === undefined) return undefined;
  }
  return node;
}

/**
 * 按点分路径写入字段值。
 * 仅当路径上所有中间容器都存在、且最终父节点为对象/数组时写入。
 * @returns 是否成功写入
 */
export function writeBodyField(body: unknown, path: string, value: unknown): boolean {
  if (!path) return false;
  const segments = pathSegments(path);
  let node: unknown = body;
  for (let i = 0; i < segments.length - 1; i++) {
    node = stepInto(node, segments[i]);
    if (node === undefined || node === null) return false;
  }
  if (node == null || typeof node !== 'object') return false;
  const last = segments[segments.length - 1];
  if (Array.isArray(node)) {
    const index = Number(last);
    if (!Number.isInteger(index) || index < 0 || index >= node.length) return false;
    node[index] = value;
    return true;
  }
  (node as Record<string, unknown>)[last] = value;
  return true;
}

/**
 * 布尔类开关字段的宽松判定。
 * DeepSeek 用 boolean（thinking_enabled: true），豆包用 0/1 数字（need_deep_think: 1），
 * 两种取值都视为开启。
 */
export function isFlagEnabled(value: unknown): boolean {
  return value === true || value === 1 || value === '1';
}
