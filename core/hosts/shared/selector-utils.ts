// core/hosts/shared/selector-utils.ts
// Selector fallback 工具函数

/**
 * 按优先级依次尝试多个选择器，返回第一个命中的元素。
 * 当豆包 DOM 改版时，只需在选择器数组末尾追加新选择器。
 */
export function queryFirst(
  selectors: string[],
  root: ParentNode = document,
): Element | null {
  for (const selector of selectors) {
    try {
      const el = root.querySelector(selector);
      if (el) return el;
    } catch {
      // 无效选择器跳过，尝试下一个
    }
  }
  return null;
}

/**
 * 按优先级依次尝试多个选择器，返回第一个有结果的数组。
 */
export function queryAll(
  selectors: string[],
  root: ParentNode = document,
): Element[] {
  for (const selector of selectors) {
    try {
      const els = root.querySelectorAll(selector);
      if (els.length > 0) return Array.from(els);
    } catch {
      // 无效选择器跳过
    }
  }
  return [];
}
