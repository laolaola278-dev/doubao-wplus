// core/diagnostics/prompt-diff.ts
// 行级 Prompt Diff — Prompt Inspector 的阶段对比引擎。
//
// 算法：行级 LCS（最长公共子序列）。Prompt 阶段间的变化以「块状新增」为主
// （前缀/尾缀注入），LCS 对此产出干净的 +/- 行；相邻的 -/+ 对合并为 ~（修改）。
// 输入规模：prompt 通常 < 1000 行，LCS O(n*m) 在此规模下毫秒级。
// 防御：超过 MAX_LINES 行时降级为「首尾对齐」快速 diff，避免病态输入卡 UI。

export type DiffLineKind = 'same' | 'added' | 'removed' | 'changed';

export interface DiffLine {
  kind: DiffLineKind;
  /** 行文本（changed 时为新文本） */
  text: string;
  /** changed 时的旧文本 */
  oldText?: string;
}

export interface PromptDiffResult {
  lines: DiffLine[];
  addedCount: number;
  removedCount: number;
  changedCount: number;
  /** 是否走了降级快速路径（超大输入） */
  truncated: boolean;
}

const MAX_LINES = 4000;

/** 行级 diff：old → new */
export function diffPromptLines(oldText: string, newText: string): PromptDiffResult {
  const oldLines = oldText === '' ? [] : oldText.split('\n');
  const newLines = newText === '' ? [] : newText.split('\n');

  if (oldLines.length + newLines.length > MAX_LINES) {
    return fastPrefixSuffixDiff(oldLines, newLines);
  }

  const lcs = computeLcsTable(oldLines, newLines);
  const raw = backtrack(lcs, oldLines, newLines);
  return finalize(mergeChangedPairs(raw));
}

// ---- LCS ----

function computeLcsTable(a: string[], b: string[]): Int32Array[] {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const table: Int32Array[] = new Array(rows);
  for (let i = 0; i < rows; i++) table[i] = new Int32Array(cols);
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      table[i][j] = a[i - 1] === b[j - 1]
        ? table[i - 1][j - 1] + 1
        : Math.max(table[i - 1][j], table[i][j - 1]);
    }
  }
  return table;
}

function backtrack(table: Int32Array[], a: string[], b: string[]): DiffLine[] {
  const out: DiffLine[] = [];
  let i = a.length;
  let j = b.length;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      out.push({ kind: 'same', text: a[i - 1] });
      i--; j--;
    } else if (table[i - 1][j] > table[i][j - 1]) {
      // 严格大于才走 removed：相等时先消费 added，使反转后 removed 排在 added 前
      // （常规 diff 顺序，也让 -/+ 相邻对可被合并为 ~）
      out.push({ kind: 'removed', text: a[i - 1] });
      i--;
    } else {
      out.push({ kind: 'added', text: b[j - 1] });
      j--;
    }
  }
  while (i > 0) { out.push({ kind: 'removed', text: a[--i] }); }
  while (j > 0) { out.push({ kind: 'added', text: b[--j] }); }
  return out.reverse();
}

/** 相邻的 removed+added 对合并为 changed（~）：removed 行与紧随的首个 added 行配对 */
function mergeChangedPairs(lines: DiffLine[]): DiffLine[] {
  const out: DiffLine[] = [];
  for (let i = 0; i < lines.length; i++) {
    const cur = lines[i];
    const next = lines[i + 1];
    if (cur.kind === 'removed' && next?.kind === 'added') {
      out.push({ kind: 'changed', text: next.text, oldText: cur.text });
      i++;
      continue;
    }
    out.push(cur);
  }
  return out;
}

// ---- 降级路径 ----

function fastPrefixSuffixDiff(a: string[], b: string[]): PromptDiffResult {
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < a.length - prefix && suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) suffix++;

  const lines: DiffLine[] = [];
  for (let i = 0; i < prefix; i++) lines.push({ kind: 'same', text: a[i] });
  for (let i = prefix; i < a.length - suffix; i++) lines.push({ kind: 'removed', text: a[i] });
  for (let i = prefix; i < b.length - suffix; i++) lines.push({ kind: 'added', text: b[i] });
  for (let i = a.length - suffix; i < a.length; i++) lines.push({ kind: 'same', text: a[i] });
  const result = finalize(lines);
  result.truncated = true;
  return result;
}

function finalize(lines: DiffLine[]): PromptDiffResult {
  let addedCount = 0, removedCount = 0, changedCount = 0;
  for (const line of lines) {
    if (line.kind === 'added') addedCount++;
    else if (line.kind === 'removed') removedCount++;
    else if (line.kind === 'changed') changedCount++;
  }
  return { lines, addedCount, removedCount, changedCount, truncated: false };
}

/** 渲染为文本（UI 兜底与测试可读性用）：+ 新增 / - 删除 / ~ 修改 / 空格 不变 */
export function renderDiffText(diff: PromptDiffResult): string {
  return diff.lines.map((line) => {
    switch (line.kind) {
      case 'added': return `+ ${line.text}`;
      case 'removed': return `- ${line.text}`;
      case 'changed': return `~ ${line.oldText} → ${line.text}`;
      default: return `  ${line.text}`;
    }
  }).join('\n');
}
