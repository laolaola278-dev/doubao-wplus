// core/insights/types.ts
// AI Insights（本地使用统计）数据模型。
//
// 隐私红线：
//   - 只存行为标量：计数、长度、耗时、memory id、skill 名、host id、时间戳。
//   - 绝不存 prompt 全文 / memory 内容 / URL / header —— 与 Prompt Inspector
//     的脱敏分层一致（全文只在 dev-only Inspector 环形缓冲）。
//   - 全部数据保存在 chrome.storage.local，无任何上传路径；无用户标识字段（默认匿名）。
//
// 存储形态：预聚合「日桶」而非原始事件日志 —— 体积有界（单桶 ~1-2KB，
// top 表封顶 50 键，日桶保留 366 天），天然匿名，直接支撑
// 今日 / 本周 / 本月 / 全部 的范围查询。

/** 耗时统计：累计和 + 最大值 + 次数（平均 = sumMs / count） */
export interface PerfStat {
  sumMs: number;
  maxMs: number;
  count: number;
}

/** 单日统计桶（date 为本地时区 YYYY-MM-DD） */
export interface InsightsDailyBucket {
  date: string;
  /** 当日 prompt 发送次数 */
  promptCount: number;
  /** 原始输入长度累计（平均 = sum / promptCount） */
  promptOriginalLengthSum: number;
  /** 原始输入最大长度 */
  promptOriginalLengthMax: number;
  /** 增强后长度累计（观察增强放大率） */
  promptFinalLengthSum: number;
  /** 命中 ≥1 条记忆的 prompt 数（记忆命中率分子） */
  memoryHitPromptCount: number;
  /** 记忆注入总条次 */
  memoryUseCount: number;
  /** memoryId -> 注入次数（只存 id，渲染时查名；上限 TOP_KEY_LIMIT 键） */
  memoryTop: Record<string, number>;
  /** 命中 skill 的 prompt 数（skill 命中率分子） */
  skillHitPromptCount: number;
  /** skillName -> 命中次数（上限 TOP_KEY_LIMIT 键） */
  skillTop: Record<string, number>;
  /** preset 注入次数 */
  presetUseCount: number;
  /** hostId -> prompt 数（平台占比） */
  hostCounts: Record<string, number>;
  /** 长度 24：当日各小时 prompt 数（热力图） */
  hourly: number[];
  perf: {
    /** Prompt 增强耗时（augmentRequestBody 全程） */
    augment: PerfStat;
    /** Memory 查询耗时（selectMemories） */
    memory: PerfStat;
    /** Rule Engine 耗时（引擎实际运行时才计数） */
    rules: PerfStat;
  };
}

/** 全历史累计（增量维护，不受日桶 366 天裁剪影响） */
export interface InsightsTotals {
  promptCount: number;
  memoryHitPromptCount: number;
  memoryUseCount: number;
  skillHitPromptCount: number;
  presetUseCount: number;
  hostCounts: Record<string, number>;
  promptOriginalLengthMax: number;
}

export interface InsightsState {
  version: 1;
  firstRecordedAt: number | null;
  /** date -> 日桶；加载时裁剪超过 RETENTION_DAYS 的旧桶 */
  days: Record<string, InsightsDailyBucket>;
  total: InsightsTotals;
}

/** top 表（memoryTop / skillTop）键数上限；超限淘汰计数最小键 */
export const TOP_KEY_LIMIT = 50;

/** 日桶保留天数 */
export const RETENTION_DAYS = 366;

export const INSIGHTS_STORAGE_KEY = 'dwplus_insights_v1';

export function createEmptyTotals(): InsightsTotals {
  return {
    promptCount: 0,
    memoryHitPromptCount: 0,
    memoryUseCount: 0,
    skillHitPromptCount: 0,
    presetUseCount: 0,
    hostCounts: {},
    promptOriginalLengthMax: 0,
  };
}

export function createEmptyInsightsState(): InsightsState {
  return {
    version: 1,
    firstRecordedAt: null,
    days: {},
    total: createEmptyTotals(),
  };
}

export function createEmptyPerfStat(): PerfStat {
  return { sumMs: 0, maxMs: 0, count: 0 };
}

export function createEmptyDailyBucket(date: string): InsightsDailyBucket {
  return {
    date,
    promptCount: 0,
    promptOriginalLengthSum: 0,
    promptOriginalLengthMax: 0,
    promptFinalLengthSum: 0,
    memoryHitPromptCount: 0,
    memoryUseCount: 0,
    memoryTop: {},
    skillHitPromptCount: 0,
    skillTop: {},
    presetUseCount: 0,
    hostCounts: {},
    hourly: new Array(24).fill(0),
    perf: {
      augment: createEmptyPerfStat(),
      memory: createEmptyPerfStat(),
      rules: createEmptyPerfStat(),
    },
  };
}
