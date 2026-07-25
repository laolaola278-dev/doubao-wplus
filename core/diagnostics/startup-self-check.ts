// core/diagnostics/startup-self-check.ts
// Dev-only 启动自检 — 验证当前宿主 adapter 的关键链路在运行期是否自洽。
//
// 检查项（全部为纯函数检查，不发真实网络请求、不触碰页面 DOM）：
//   1. host-detection      宿主识别：URL 能被 registry 检出且与 active host 一致
//   2. chat-path-match     聊天接口路径：isChatStreamUrl 能命中 adapter 自己声明的 completion 路径
//   3. prompt-path-roundtrip  Prompt 路径：按 getRequestBodyFields().prompt 合成骨架后能读回写入值
//   4. augmentation-executes  增强模块：augmentRequestBody 对合成 body 返回非空且 prompt 确实被改写
//   5. mapping-compat      兼容性异常：映射路径语法、空路径 no-op 语义、非 prompt 字段读写不抛异常
//
// 设计约束：
//   - 仅在 DEV / E2E 构建启用（与 dev-diagnostics 同一门控），生产构建为 no-op
//   - 宿主无关：所有检查体从 adapter 声明的映射路径动态合成，不硬编码任何宿主的 body 结构
//   - 任何检查抛出异常都被捕获为 fail 项，自检本身绝不让页面报错
//   - 发现异常时输出明确的 [DWPLUS-SELFCHECK] console.warn，全部通过时输出一行 console.info

import type { HostAdapter } from '../hosts/types';
import { detectHost, getActiveAdapter, getActiveHostId } from '../hosts/registry';
import { readBodyField, writeBodyField } from '../hosts/shared/body-fields';
import { augmentRequestBody } from '../interceptor/request-augmentation';
import { isDevDiagnosticsEnabled, writeDevDiagnostics } from './dev-diagnostics';

/**
 * 检查项严重程度：
 * - error: 核心链路（Prompt 增强）不可用，发布阻断级
 * - warn:  次级能力降级（如 regenerate 不增强、非 prompt 字段映射问题），核心链路仍可用
 * - info:  正常通过项的记录级别
 */
export type SelfCheckSeverity = 'error' | 'warn' | 'info';

export interface SelfCheckItem {
  /** 检查项 id（稳定，供日志 grep 与测试断言） */
  id: 'host-detection' | 'chat-path-match' | 'prompt-path-roundtrip' | 'augmentation-executes' | 'mapping-compat';
  passed: boolean;
  /** 严重程度；通过项固定为 info，失败项为 error 或 warn */
  severity: SelfCheckSeverity;
  /** 人类可读的结果说明；失败时包含定位线索 */
  detail: string;
}

export interface SelfCheckReport {
  hostId: string;
  pageUrl: string;
  timestamp: number;
  /** 无 error 级失败（warn 级降级不阻断） */
  passed: boolean;
  /** error 级失败项数 */
  errorCount: number;
  /** warn 级失败项数 */
  warnCount: number;
  checks: SelfCheckItem[];
}

const SELF_CHECK_MARKER = '__dwplus_selfcheck_prompt__';

/**
 * 按点分路径合成最小 body 骨架并在叶子写入 value。
 * 数字段合成数组（补齐到该下标），其余合成对象。
 * 这是 writeBodyField「不自动创建中间容器」策略的自检专用逆操作 ——
 * 仅用于构造检查体，绝不用于真实请求。
 */
export function buildBodyScaffoldForPath(path: string, value: unknown): Record<string, unknown> | null {
  if (!path) return null;
  const segments = path.split('.');
  if (Number.isInteger(Number(segments[0]))) return null; // 根必须是对象
  const root: Record<string, unknown> = {};
  let node: Record<string, unknown> | unknown[] = root;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const isLast = i === segments.length - 1;
    const nextIsIndex = !isLast && Number.isInteger(Number(segments[i + 1]));
    const child: unknown = isLast ? value : (nextIsIndex ? [] : {});
    if (Array.isArray(node)) {
      const index = Number(seg);
      while (node.length < index) node.push(null);
      node[index] = child;
    } else {
      node[seg] = child;
    }
    if (!isLast) node = child as Record<string, unknown> | unknown[];
  }
  return root;
}

function checkHostDetection(adapter: HostAdapter, pageUrl: string): SelfCheckItem {
  const detected = detectHost(pageUrl);
  if (!detected) {
    return {
      id: 'host-detection',
      passed: false,
      severity: 'error',
      detail: `registry 无法从当前 URL 检出宿主（url=${pageUrl}）— 检查 matchUrl() 的域名判断`,
    };
  }
  if (detected.id !== adapter.id) {
    return {
      id: 'host-detection',
      passed: false,
      severity: 'error',
      detail: `URL 检出宿主 ${detected.id} 与 active host ${adapter.id} 不一致 — setActiveHostId 可能未在入口调用`,
    };
  }
  return { id: 'host-detection', passed: true, severity: 'info', detail: `host=${detected.id}` };
}

function checkChatPathMatch(adapter: HostAdapter, pageUrl: string): SelfCheckItem {
  let origin = 'https://invalid.example';
  try {
    origin = new URL(pageUrl).origin;
  } catch {
    // 保留 fallback origin；matchUrl 失败会在下方体现
  }
  const paths = adapter.getPaths();
  // 带 query 模拟真实签名参数（豆包 a_bogus/msToken 在 query 中）
  const probeUrl = `${origin}${paths.completion}?probe=1`;
  if (!adapter.isChatStreamUrl(probeUrl)) {
    return {
      id: 'chat-path-match',
      passed: false,
      severity: 'error',
      detail: `isChatStreamUrl 未命中 adapter 自己声明的 completion 路径（${probeUrl}）— ` +
        'getPaths().completion 与 isChatStreamUrl 实现不一致，Prompt 增强将全程失效',
    };
  }
  const regenUrl = `${origin}${paths.regenerate}?probe=1`;
  if (!adapter.isChatStreamUrl(regenUrl)) {
    return {
      id: 'chat-path-match',
      passed: false,
      // 普通消息仍会被增强，仅重新生成路径失守 —— 降级而非阻断
      severity: 'warn',
      detail: `isChatStreamUrl 未命中 regenerate 路径（${regenUrl}）— 重新生成的请求不会被增强`,
    };
  }
  return { id: 'chat-path-match', passed: true, severity: 'info', detail: `completion=${paths.completion}` };
}

function checkPromptPathRoundtrip(adapter: HostAdapter): SelfCheckItem {
  const promptPath = adapter.getRequestBodyFields().prompt;
  if (!promptPath) {
    return {
      id: 'prompt-path-roundtrip',
      passed: false,
      severity: 'error',
      detail: 'getRequestBodyFields().prompt 为空路径 — 宿主未声明 Prompt 位置，增强不可能执行',
    };
  }
  const scaffold = buildBodyScaffoldForPath(promptPath, SELF_CHECK_MARKER);
  if (!scaffold) {
    return {
      id: 'prompt-path-roundtrip',
      passed: false,
      severity: 'error',
      detail: `无法按路径合成检查体（path=${promptPath}）— 路径首段不能是数组下标`,
    };
  }
  const read = readBodyField(scaffold, promptPath);
  if (read !== SELF_CHECK_MARKER) {
    return {
      id: 'prompt-path-roundtrip',
      passed: false,
      severity: 'error',
      detail: `readBodyField 读回值不符（path=${promptPath}, got=${JSON.stringify(read)}）— 路径语法或 body-fields 读逻辑异常`,
    };
  }
  const written = writeBodyField(scaffold, promptPath, SELF_CHECK_MARKER + '_w');
  if (!written || readBodyField(scaffold, promptPath) !== SELF_CHECK_MARKER + '_w') {
    return {
      id: 'prompt-path-roundtrip',
      passed: false,
      severity: 'error',
      detail: `writeBodyField 写入失败（path=${promptPath}）— 增强后的 Prompt 将无法写回请求体`,
    };
  }
  return { id: 'prompt-path-roundtrip', passed: true, severity: 'info', detail: `path=${promptPath}` };
}

function checkAugmentationExecutes(adapter: HostAdapter): SelfCheckItem {
  const promptPath = adapter.getRequestBodyFields().prompt;
  const scaffold = promptPath ? buildBodyScaffoldForPath(promptPath, SELF_CHECK_MARKER) : null;
  if (!scaffold) {
    return {
      id: 'augmentation-executes',
      passed: false,
      severity: 'error',
      detail: '无法合成检查体（prompt 路径缺失或非法），跳过增强执行检查',
    };
  }
  const result = augmentRequestBody(JSON.stringify(scaffold), {
    memories: [],
    skills: [],
    activePreset: null,
    modelType: null,
    toolDescriptors: [],
    messageCount: 0,
  });
  if (!result) {
    return {
      id: 'augmentation-executes',
      passed: false,
      severity: 'error',
      detail: 'augmentRequestBody 对合成 body 返回 null — 增强管线未执行（读 prompt 失败或写回失败）',
    };
  }
  let augmentedPrompt: unknown;
  try {
    augmentedPrompt = readBodyField(JSON.parse(result.body), promptPath);
  } catch {
    return {
      id: 'augmentation-executes',
      passed: false,
      severity: 'error',
      detail: 'augmentRequestBody 返回的 body 不是合法 JSON',
    };
  }
  if (typeof augmentedPrompt !== 'string' || !augmentedPrompt.includes(SELF_CHECK_MARKER)) {
    return {
      id: 'augmentation-executes',
      passed: false,
      severity: 'error',
      detail: '增强后的 prompt 丢失了原始用户输入 — 增强逻辑破坏了用户消息',
    };
  }
  if (augmentedPrompt === SELF_CHECK_MARKER) {
    return {
      id: 'augmentation-executes',
      passed: false,
      severity: 'error',
      detail: '增强后的 prompt 与原文完全相同 — 增强内容未注入',
    };
  }
  return { id: 'augmentation-executes', passed: true, severity: 'info', detail: `augmentedLength=${augmentedPrompt.length}` };
}

function checkMappingCompat(adapter: HostAdapter): SelfCheckItem {
  const fields = adapter.getRequestBodyFields();
  const problems: string[] = [];

  for (const [key, path] of Object.entries(fields)) {
    if (typeof path !== 'string') {
      problems.push(`${key} 路径不是字符串`);
      continue;
    }
    if (!path) continue; // 空路径 = 声明缺失，合法
    if (/^\.|\.$|\.\./.test(path)) {
      problems.push(`${key} 路径语法非法（${path}）`);
      continue;
    }
    // 空路径与缺失容器的读写都必须静默降级，不抛异常
    try {
      readBodyField({}, path);
      writeBodyField({}, path, 'x');
    } catch (err) {
      problems.push(`${key} 读写空 body 时抛出异常：${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 空路径字段的 no-op 语义
  try {
    if (readBodyField({ a: 1 }, '') !== undefined || writeBodyField({ a: 1 }, '', 'x') !== false) {
      problems.push('空路径的读/写未按 no-op 语义降级');
    }
  } catch (err) {
    problems.push(`空路径读写抛出异常：${err instanceof Error ? err.message : String(err)}`);
  }

  if (problems.length > 0) {
    // prompt 字段的映射问题会阻断增强（error）；其余字段只造成对应能力降级（warn）
    const severity: SelfCheckSeverity = problems.some((p) => p.startsWith('prompt ')) ? 'error' : 'warn';
    return { id: 'mapping-compat', passed: false, severity, detail: problems.join('；') };
  }
  const emptyFields = Object.entries(fields).filter(([, p]) => !p).map(([k]) => k);
  return {
    id: 'mapping-compat',
    passed: true,
    severity: 'info',
    detail: emptyFields.length > 0 ? `声明缺失（no-op）字段: ${emptyFields.join(', ')}` : '全部字段有路径',
  };
}

/**
 * 运行启动自检（纯函数，可在测试中直接调用）。
 * @param pageUrl 当前页面 URL
 * @param adapter 待检 adapter；缺省为当前激活 adapter
 */
export function runStartupSelfCheck(pageUrl: string, adapter: HostAdapter = getActiveAdapter()): SelfCheckReport {
  const checks: SelfCheckItem[] = [];
  const safeRun = (fn: () => SelfCheckItem, id: SelfCheckItem['id']) => {
    try {
      checks.push(fn());
    } catch (err) {
      checks.push({
        id,
        passed: false,
        // 检查自身崩溃说明 adapter 契约异常，按最高严重程度处理
        severity: 'error',
        detail: `检查自身抛出异常：${err instanceof Error ? err.message : String(err)}`,
      });
    }
  };

  safeRun(() => checkHostDetection(adapter, pageUrl), 'host-detection');
  safeRun(() => checkChatPathMatch(adapter, pageUrl), 'chat-path-match');
  safeRun(() => checkPromptPathRoundtrip(adapter), 'prompt-path-roundtrip');
  safeRun(() => checkAugmentationExecutes(adapter), 'augmentation-executes');
  safeRun(() => checkMappingCompat(adapter), 'mapping-compat');

  const errorCount = checks.filter((c) => !c.passed && c.severity === 'error').length;
  const warnCount = checks.filter((c) => !c.passed && c.severity === 'warn').length;
  return {
    hostId: adapter.id,
    pageUrl,
    timestamp: Date.now(),
    // warn 级降级不阻断：passed 只看 error
    passed: errorCount === 0,
    errorCount,
    warnCount,
    checks,
  };
}

/**
 * DEV 门控入口：运行自检、写入 __DWPLUS_DIAG__.selfCheck 并输出开发者日志。
 * 生产构建（门控关闭）为完全 no-op。
 */
export function runAndReportStartupSelfCheck(pageUrl: string): SelfCheckReport | null {
  if (!isDevDiagnosticsEnabled()) return null;

  let report: SelfCheckReport;
  try {
    report = runStartupSelfCheck(pageUrl);
  } catch (err) {
    // 防御性兜底：自检绝不让页面报错
    if (typeof console !== 'undefined' && console.error) {
      console.error('[DWPLUS-SELFCHECK] self-check crashed', err);
    }
    return null;
  }

  writeDevDiagnostics({ selfCheck: report });

  if (typeof console === 'undefined') return report;
  // 按严重程度分级输出：error → console.error，warn → console.warn，通过 → 汇总一行 info
  for (const check of report.checks) {
    if (check.passed) continue;
    if (check.severity === 'error') {
      console.error?.(`[DWPLUS-SELFCHECK] ERROR ${check.id}: ${check.detail}`);
    } else {
      console.warn?.(`[DWPLUS-SELFCHECK] WARN ${check.id}: ${check.detail}`);
    }
  }
  if (report.errorCount > 0) {
    console.error?.(
      `[DWPLUS-SELFCHECK] host=${report.hostId} 自检未通过 — ` +
      `${report.errorCount} ERROR / ${report.warnCount} WARN。` +
      '核心增强链路不可用，详情见上方日志；完整报告在 window.__DWPLUS_DIAG__.selfCheck',
    );
  } else if (report.warnCount > 0) {
    console.warn?.(
      `[DWPLUS-SELFCHECK] host=${report.hostId} 自检通过（有降级）— ` +
      `${report.warnCount} WARN。核心增强链路可用，部分次级能力降级。完整报告在 window.__DWPLUS_DIAG__.selfCheck`,
    );
  } else {
    console.info?.(
      `[DWPLUS-SELFCHECK] host=${report.hostId} 全部 ${report.checks.length} 项自检通过 ✓ ` +
      report.checks.map((c) => c.id).join(', '),
    );
  }
  return report;
}
