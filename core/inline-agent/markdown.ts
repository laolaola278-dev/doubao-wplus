const SAFE_LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

export function renderInlineMarkdown(text: string): string {
  try {
    const codeBlocks: string[] = [];
    let html = escapeHtml(text);

    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, _lang, code) => {
      const token = `@@DWPLUS_CODE_BLOCK_${codeBlocks.length}@@`;
      codeBlocks.push(`<pre><code>${code}</code></pre>`);
      return token;
    });
    html = renderMarkdownTables(html);
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label, href) => {
      const decodedHref = decodeBasicEntities(href.trim());
      if (!isSafeHref(decodedHref)) return `${label} (${href})`;
      return `<a href="${escapeAttribute(decodedHref)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    });
    html = html.replace(/^### (.+)$/gm, '<h4>$1</h4>');
    html = html.replace(/^## (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^# (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
    html = html.replace(/^\* (.+)$/gm, '<li>$1</li>');
    html = html.replace(/\n/g, '<br>');
    html = html.replace(/@@DWPLUS_CODE_BLOCK_(\d+)@@/g, (_match, index) => codeBlocks[Number(index)] ?? '');

    return html;
  } catch {
    return escapeHtml(text).replace(/\n/g, '<br>');
  }
}

function renderMarkdownTables(html: string): string {
  const lines = html.split('\n');
  const rendered: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const header = parseMarkdownTableRow(lines[i]);
    const separator = parseMarkdownTableRow(lines[i + 1] ?? '');
    if (!header || !separator || !separator.every(isMarkdownTableSeparatorCell)) {
      rendered.push(lines[i]);
      continue;
    }

    const rows: string[][] = [];
    i += 2;
    while (i < lines.length) {
      const row = parseMarkdownTableRow(lines[i]);
      if (!row) break;
      rows.push(normalizeTableRow(row, header.length));
      i++;
    }
    i--;

    const thead = `<thead><tr>${header.map((cell) => `<th>${cell}</th>`).join('')}</tr></thead>`;
    const tbody = rows.length > 0
      ? `<tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody>`
      : '';
    rendered.push(`<table>${thead}${tbody}</table>`);
  }

  return rendered.join('\n');
}

function parseMarkdownTableRow(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.includes('|')) return null;

  const normalized = trimmed
    .replace(/^\|/, '')
    .replace(/\|$/, '');
  const cells = normalized.split('|').map((cell) => cell.trim());
  return cells.length >= 2 && cells.some((cell) => cell.length > 0) ? cells : null;
}

function isMarkdownTableSeparatorCell(cell: string): boolean {
  return /^:?-{3,}:?$/.test(cell.trim());
}

function normalizeTableRow(row: string[], width: number): string[] {
  if (row.length === width) return row;
  if (row.length > width) return row.slice(0, width);
  return [...row, ...Array.from({ length: width - row.length }, () => '')];
}

function isSafeHref(value: string): boolean {
  try {
    const url = new URL(value);
    return SAFE_LINK_PROTOCOLS.has(url.protocol);
  } catch {
    return false;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/'/g, '&#39;');
}

function decodeBasicEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');
}
