export const VISIBLE_USER_PROMPT_START = '<!-- doubao-wplus-visible-user-prompt:start -->';
export const VISIBLE_USER_PROMPT_END = '<!-- doubao-wplus-visible-user-prompt:end -->';
// backward compat: old brand — accepted only when reading prompts produced by older builds.
export const DEPRECATED_VISIBLE_USER_PROMPT_START = '<!-- deepseek-pp-visible-user-prompt:start -->';
export const DEPRECATED_VISIBLE_USER_PROMPT_END = '<!-- deepseek-pp-visible-user-prompt:end -->';

const TOOL_REMINDER_HEADING = 'Tool call format reminder:';
const TOOL_REMINDER_REQUIRED_LINE = 'Available tool tag names:';
const TOOL_REMINDER_FRAGMENT_PREFIXES = [
  TOOL_REMINDER_HEADING,
  TOOL_REMINDER_REQUIRED_LINE,
  'These listed tools are executable by the extension.',
  'To call a tool, use ONLY the direct XML tag',
  'For MCP tools, prefer the short tag name',
  'For local file paths, use forward slashes',
  'Do not use <invoke name="...">',
  'Do not put executable tool XML',
];

const VISIBLE_USER_PROMPT_MARKERS = [
  { start: VISIBLE_USER_PROMPT_START, end: VISIBLE_USER_PROMPT_END },
  { start: DEPRECATED_VISIBLE_USER_PROMPT_START, end: DEPRECATED_VISIBLE_USER_PROMPT_END },
] as const;

export function markVisibleUserPrompt(prompt: string): string {
  return `${VISIBLE_USER_PROMPT_START}\n${prompt}\n${VISIBLE_USER_PROMPT_END}`;
}

export function extractVisibleUserPrompt(text: string): string | null {
  for (const marker of VISIBLE_USER_PROMPT_MARKERS) {
    const start = text.indexOf(marker.start);
    if (start === -1) continue;

    const contentStart = start + marker.start.length;
    const end = text.indexOf(marker.end, contentStart);
    if (end === -1) continue;

    return trimSingleBoundaryNewline(text.slice(contentStart, end));
  }
  return null;
}

export function sanitizeInternalPromptText(
  text: string,
  fallbackVisiblePrompt?: string,
): string {
  const visiblePrompt = extractVisibleUserPrompt(text);
  if (visiblePrompt !== null) return visiblePrompt;

  if (isToolReminderOnly(text)) return '';

  if (containsToolFormatReminder(text)) {
    return fallbackVisiblePrompt ?? stripToolFormatReminder(text);
  }

  return text;
}

export function containsInternalPromptMarker(text: string): boolean {
  return VISIBLE_USER_PROMPT_MARKERS.some((marker) => text.includes(marker.start)) ||
    containsToolFormatReminder(text) ||
    isToolReminderOnly(text);
}

function trimSingleBoundaryNewline(text: string): string {
  let next = text;
  if (next.startsWith('\r\n')) next = next.slice(2);
  else if (next.startsWith('\n')) next = next.slice(1);

  if (next.endsWith('\r\n')) next = next.slice(0, -2);
  else if (next.endsWith('\n')) next = next.slice(0, -1);

  return next;
}

function containsToolFormatReminder(text: string): boolean {
  return text.includes(TOOL_REMINDER_HEADING) && text.includes(TOOL_REMINDER_REQUIRED_LINE);
}

function stripToolFormatReminder(text: string): string {
  const headingIndex = text.indexOf(TOOL_REMINDER_HEADING);
  if (headingIndex === -1) return text;

  const delimiterIndex = text.lastIndexOf('\n---', headingIndex);
  const cutIndex = delimiterIndex === -1 ? headingIndex : delimiterIndex;
  return text.slice(0, cutIndex).trim();
}

function isToolReminderOnly(text: string): boolean {
  const normalized = text.trimStart();
  if (!normalized) return false;

  return TOOL_REMINDER_FRAGMENT_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}
