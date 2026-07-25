// scripts/gen-doubao-features.mjs
// 由 entrypoints/content/features/deepseek/ 的 feature 生成 doubao 版（仅替换宿主专属常量）。
// 这是一次性代码生成辅助脚本，用于把 DeepSeek++ 的 DOM 增强功能复刻到豆包宿主。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const SRC = 'entrypoints/content/features/deepseek';
const DST = 'entrypoints/content/features/doubao';

function transformHistoryOrganizer(src) {
  let out = src;
  out = out.replace(
    "const STORAGE_KEY = 'deepseek_pp_history_organizer';",
    "const STORAGE_KEY = 'doubao_pp_history_organizer';",
  );
  // 历史链接选择器：豆包侧边栏历史条目为 /chat/{id}
  out = out.replace(
    /const HISTORY_LINK_SELECTOR = \[[\s\S]*?\]\.join\(','\);/,
    "const HISTORY_LINK_SELECTOR = [\n  'a[href*=\"/chat/\"]',\n].join(',');",
  );
  // 会话 ID 解析：豆包 URL 形如 /chat/{id} 或 /chat/bot/{botId}/conversation/{convId}
  out = out.replace(
    "    const pathMatch = url.pathname.match(/\\/(?:a\\/)?chat\\/s\\/([^/?#]+)/);",
    "    const pathMatch = url.pathname.match(/\\/chat\\/(?:bot\\/[^/]+\\/conversation\\/)?([^/?#]+)/);",
  );
  out = out.replace(
    "    const value = pathMatch?.[1] ?? url.searchParams.get('chat_session_id');",
    "    const value = pathMatch?.[1] ?? null;",
  );
  out = out.replace(
    'console.error(`DeepSeek++ failed to ${action} history tags`, error);',
    'console.error(`豆包 WPlus failed to ${action} history tags`, error);',
  );
  out = out.replace(
    'export function startDeepSeekHistoryOrganizer',
    'export function startDoubaoHistoryOrganizer',
  );
  return out;
}

function transformProjectSidebar(src) {
  let out = src;
  // 新建会话路径（占位：豆包新对话为 /chat）
  out = out.replace(
    "new URL('/a/chat/new', location.origin).href",
    "new URL('/chat', location.origin).href",
  );
  // 会话 URL：/a/chat/s/{id} -> /chat/{id}（两处出现，全局替换）
  out = out.split("/a/chat/s/${encodeURIComponent(sessionId)}").join("/chat/${encodeURIComponent(sessionId)}");
  // 历史分隔线判定里的链接选择器
  out = out.replace(
    'a[href*="/chat/s/"], a[href*="/a/chat/s/"], a[href*="chat_session_id="]',
    'a[href*="/chat/"]',
  );
  // 标题去品牌：DeepSeek -> 豆包/Doubao
  out = out.replace(
    "replace(/\\s*[-|]\\s*DeepSeek.*$/i, '')",
    "replace(/\\s*[-|]\\s*(豆包|Doubao).*$/i, '')",
  );
  out = out.replace(
    "section.setAttribute('aria-label', 'DeepSeek++ projects');",
    "section.setAttribute('aria-label', '豆包 WPlus projects');",
  );
  out = out.replace(
    "console.error('DeepSeek++ failed to load project sidebar state', error);",
    "console.error('豆包 WPlus failed to load project sidebar state', error);",
  );
  out = out.replace(
    "console.error('DeepSeek++ failed to update project sidebar state', error);",
    "console.error('豆包 WPlus failed to update project sidebar state', error);",
  );
  out = out.replace(
    'export function startDeepSeekProjectSidebarOrganizer',
    'export function startDoubaoProjectSidebarOrganizer',
  );
  return out;
}

function transformThemeSync(src) {
  let out = src;
  // 主题消息改用宿主无关的 SET_CLIENT_THEME（background 已处理）
  out = out.replace(
    "chrome.runtime.sendMessage({ type: 'SET_DEEPSEEK_THEME', payload: { theme } });",
    "chrome.runtime.sendMessage({ type: 'SET_CLIENT_THEME', payload: { theme } });",
  );
  out = out.replace(
    'export function startThemeSync(): void {',
    'export function startDoubaoThemeSync(): void {',
  );
  out = out.replace(
    'export function stopThemeSync(): void {',
    'export function stopDoubaoThemeSync(): void {',
  );
  // 注释里的 DeepSeek-specific -> Doubao-specific（不影响类型名 DeepSeekTheme）
  out = out.split('DeepSeek-specific').join('Doubao-specific');
  return out;
}

const jobs = [
  ['history-organizer.ts', transformHistoryOrganizer],
  ['project-sidebar-organizer.ts', transformProjectSidebar],
  ['theme-sync.ts', transformThemeSync],
];

mkdirSync(DST, { recursive: true });
for (const [file, fn] of jobs) {
  const input = join(SRC, file);
  const output = join(DST, file);
  const before = readFileSync(input, 'utf8');
  const after = fn(before);
  if (after === before) {
    console.warn(`[WARN] ${file}: 无任何替换发生，请检查源文件结构`);
  }
  writeFileSync(output, after, 'utf8');
  console.log(`[OK] ${input} -> ${output} (${after.length} bytes)`);
}
console.log('豆包 feature 文件生成完成。');
