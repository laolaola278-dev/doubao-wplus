// core/hosts/shared/selector-utils.ts
// Selector fallback 工具函数

import type {
  HostId,
  HostSelectors,
  SelectorHealthReport,
  SelectorHealthStatus,
  SelectorProbe,
} from '../types';

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

/**
 * 探测单个选择器键的命中情况（fallback 数组按优先级）。
 */
function probeSelector(
  doc: Document,
  key: keyof HostSelectors,
  candidates: string[],
): SelectorProbe {
  let matchedSelector: string | null = null;
  let matchCount = 0;
  for (const candidate of candidates) {
    try {
      const elements = doc.querySelectorAll(candidate);
      if (elements.length > 0) {
        matchedSelector = candidate;
        matchCount = elements.length;
        break;
      }
    } catch {
      continue;
    }
  }
  return { key, found: matchCount > 0, matchedSelector, matchCount };
}

/**
 * 计算选择器健康检查的 4 档状态。
 *
 * - full: 关键 + 辅助全部命中
 * - partial: 关键全部命中，辅助有缺失
 * - fallback: 关键部分缺失（至少 1 个关键命中）
 * - unsupported: 关键全部缺失
 */
function computeStatus(
  missingCriticalCount: number,
  missingEssentialCount: number,
  totalCritical: number,
): SelectorHealthStatus {
  if (missingCriticalCount >= totalCritical) return 'unsupported';
  if (missingCriticalCount > 0) return 'fallback';
  if (missingEssentialCount > 0) return 'partial';
  return 'full';
}

/**
 * 共享的 selector health check 实现。
 * 任何选择器探测异常都被吞掉，绝不向上抛出 —— 保证页面不会因为某个选择器写错就报错。
 *
 * @param hostId 宿主 id
 * @param selectors 宿主的选择器配置
 * @param doc 当前 document
 * @param criticalKeys 关键选择器键名（缺失则降级）
 * @param essentialKeys 辅助选择器键名（缺失不影响核心路径，但影响完整体验）
 * @param pageUrl 探测时的页面 URL（用于报告）
 */
export function computeSelectorHealth(
  hostId: HostId,
  selectors: HostSelectors,
  doc: Document,
  criticalKeys: ReadonlyArray<keyof HostSelectors>,
  essentialKeys: ReadonlyArray<keyof HostSelectors>,
  pageUrl: string,
): SelectorHealthReport {
  const probes: SelectorProbe[] = [];
  const missingCritical: string[] = [];
  const missingEssential: string[] = [];

  for (const key of Object.keys(selectors) as Array<keyof HostSelectors>) {
    const candidates = selectors[key];
    if (!candidates || candidates.length === 0) {
      // 未定义的 optional 选择器（如 deepseek 没有声明 stopButton），跳过探测
      continue;
    }
    const probe = probeSelector(doc, key, candidates);
    probes.push(probe);
    if (!probe.found) {
      if (criticalKeys.includes(key)) {
        missingCritical.push(key);
      } else if (essentialKeys.includes(key)) {
        missingEssential.push(key);
      }
    }
  }

  const status = computeStatus(
    missingCritical.length,
    missingEssential.length,
    criticalKeys.length,
  );
  const healthy = missingCritical.length === 0;

  return {
    hostId,
    timestamp: Date.now(),
    probes,
    healthy,
    status,
    missingCritical,
    missingEssential,
    pageUrl,
  };
}
