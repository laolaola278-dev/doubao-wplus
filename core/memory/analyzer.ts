// core/memory/analyzer.ts
// Memory 命中分析 — Memory Studio 的"为什么命中"解释器。
//
// 与生产注入路径的一致性保证：
//   - 打分复用 selector.ts 导出的 keywordScore / decayScore / segmentText（同一实现，非复刻）
//   - 选取复用 selectMemories 本身 —— 分析结果的 selected 集与真实注入完全一致
//   - 本模块只做「解释」：把每条 memory 的分数拆解为可读的命中原因
// 纯只读：不 touch、不改分、不写库。

import type { Memory } from '../types';
import { DEFAULT_LOCALE, type SupportedLocale } from '../i18n';
import {
  decayScore,
  estimateTokens,
  formatMemoryLine,
  getMemoryBudget,
  keywordScore,
  segmentText,
  selectMemories,
  type SelectOptions,
} from './selector';

/** 单条 memory 的命中解释 */
export interface MemoryHitExplanation {
  memoryId: number | null;
  name: string;
  /** 是否入选（在 token 预算内被注入） */
  selected: boolean;
  /** 总分（与 selectMemories 内部打分一致；pinned +1000、近 1 小时活跃 +5 已计入） */
  totalScore: number;
  /** 分数构成 */
  breakdown: {
    pinnedBonus: number;
    keywordScore: number;
    decayScore: number;
    recentActivityBonus: number;
  };
  /** 命中的关键词（prompt 分词与 tag/name/content 的交集，按来源分组） */
  matchedKeywords: {
    tags: string[];
    name: string[];
    content: string[];
  };
  /** 注入到 prompt 的实际文本行（贡献内容）；未入选为 null */
  contributedLine: string | null;
  /** 该行的 token 成本估算 */
  tokenCost: number;
}

export interface MemoryHitAnalysis {
  prompt: string;
  /** prompt 分词结果（解释匹配依据） */
  promptWords: string[];
  /** token 预算（与生产一致：随 prompt 长度衰减） */
  budget: number;
  /** 入选条数 / 候选总数 */
  selectedCount: number;
  candidateCount: number;
  explanations: MemoryHitExplanation[];
}

const RECENT_ACTIVITY_WINDOW_MS = 3600_000;
const RECENT_ACTIVITY_BONUS = 5;
const PINNED_BONUS = 1000;

/**
 * 解释给定 prompt 会命中哪些 memory、为什么、贡献什么内容。
 * selected 集与 selectMemories（真实注入）逐条一致。
 */
export function analyzeMemoryHits(
  prompt: string,
  memories: Memory[],
  options?: SelectOptions & { locale?: SupportedLocale },
): MemoryHitAnalysis {
  const locale = options?.locale ?? DEFAULT_LOCALE;
  const promptWords = segmentText(prompt);
  const budget = options?.budget ?? getMemoryBudget(estimateTokens(prompt));

  // 真实选取（与注入路径同一函数、同一参数）
  const selected = selectMemories(prompt, [...memories], { ...options, budget });
  const selectedIds = new Set(selected.map((m) => m.syncId));

  const promptSet = new Set(promptWords);
  const explanations = memories.map((memory): MemoryHitExplanation => {
    const kw = keywordScore(promptWords, memory);
    const decay = decayScore(memory);
    const pinnedBonus = memory.pinned ? PINNED_BONUS : 0;
    const recentBonus = Date.now() - memory.lastAccessedAt < RECENT_ACTIVITY_WINDOW_MS ? RECENT_ACTIVITY_BONUS : 0;
    const isSelected = selectedIds.has(memory.syncId);
    const line = formatMemoryLine(memory);

    return {
      memoryId: memory.id ?? null,
      name: memory.name,
      selected: isSelected,
      totalScore: pinnedBonus + kw + decay + recentBonus,
      breakdown: {
        pinnedBonus,
        keywordScore: kw,
        decayScore: Math.round(decay * 100) / 100,
        recentActivityBonus: recentBonus,
      },
      matchedKeywords: {
        tags: memory.tags.filter((tag) => promptSet.has(tag.toLowerCase())),
        name: segmentText(memory.name).filter((w) => promptSet.has(w)),
        content: [...new Set(segmentText(memory.content).filter((w) => promptSet.has(w)))],
      },
      contributedLine: isSelected ? line : null,
      tokenCost: estimateTokens(line),
    };
  });

  // 展示排序：入选优先，其余按总分降序
  explanations.sort((a, b) =>
    (Number(b.selected) - Number(a.selected)) || (b.totalScore - a.totalScore));

  void locale; // 预留：后续解释文案本地化
  return {
    prompt,
    promptWords,
    budget,
    selectedCount: selected.length,
    candidateCount: memories.length,
    explanations,
  };
}
