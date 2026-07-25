import type { DeepSeekTheme } from '../../../../core/types';

export interface ThemeSyncConfig {
  messageType: string;
  hostLabel: string;
  detectExtraTheme?: () => DeepSeekTheme | null;
}

export function createThemeSync(config: ThemeSyncConfig) {
  let themeObserver: MutationObserver | null = null;
  let themeTreeObserver: MutationObserver | null = null;
  let themeMediaQuery: MediaQueryList | null = null;
  let themeMediaListener: ((event: MediaQueryListEvent) => void) | null = null;
  let themeSyncTimer: ReturnType<typeof setTimeout> | null = null;
  let themeBootstrapTimer: ReturnType<typeof setTimeout> | null = null;
  let themeBootstrapAttempts = 0;
  let currentTheme: DeepSeekTheme | null = null;

  const THEME_BOOTSTRAP_RETRY_MS = 250;
  const THEME_BOOTSTRAP_RETRY_LIMIT = 20;

  function sendThemeMessage(theme: DeepSeekTheme): void {
    try {
      void chrome.runtime.sendMessage({ type: config.messageType, payload: { theme } });
    } catch {
      // extension context may be invalidated - safe to ignore
    }
  }

  function observeThemeHost(element: Element | null) {
    if (!element || !themeObserver) return;
    themeObserver.observe(element, {
      attributes: true,
      attributeFilter: ['class', 'style', 'data-theme', 'data-color-mode', 'data-mode', 'color-scheme'],
    });
  }

  function observeThemeTree(element: Element | null) {
    if (!element || !themeTreeObserver) return;
    themeTreeObserver.observe(element, { childList: true, subtree: true });
  }

  function scheduleThemeBootstrapRetry() {
    if (themeBootstrapTimer) return;
    themeBootstrapTimer = setTimeout(() => {
      themeBootstrapTimer = null;
      themeBootstrapAttempts += 1;
      syncTheme();
      if (themeBootstrapAttempts >= THEME_BOOTSTRAP_RETRY_LIMIT) {
        stopThemeBootstrapSync();
        return;
      }
      scheduleThemeBootstrapRetry();
    }, THEME_BOOTSTRAP_RETRY_MS);
  }

  function scheduleThemeSync() {
    if (themeSyncTimer) clearTimeout(themeSyncTimer);
    themeSyncTimer = setTimeout(() => {
      themeSyncTimer = null;
      syncTheme();
    }, 50);
  }

  function startThemeBootstrapSync() {
    stopThemeBootstrapSync();
    themeBootstrapAttempts = 0;
    themeTreeObserver = new MutationObserver(() => {
      observeThemeTree(document.getElementById('root'));
      scheduleThemeSync();
    });
    observeThemeTree(document.body);
    observeThemeTree(document.getElementById('root'));
    scheduleThemeBootstrapRetry();
  }

  function stopThemeBootstrapSync() {
    themeTreeObserver?.disconnect();
    themeTreeObserver = null;
    if (themeBootstrapTimer) {
      clearTimeout(themeBootstrapTimer);
      themeBootstrapTimer = null;
    }
  }

  function parseThemeText(value: string | null): DeepSeekTheme | null {
    if (!value) return null;
    const normalized = value.toLowerCase();
    if (/(^|[\s_-])(dark|black|night)([\s_-]|$)/.test(normalized)) return 'dark';
    if (/(^|[\s_-])(light|white|day)([\s_-]|$)/.test(normalized)) return 'light';
    return null;
  }

  function relativeLuminance(red: number, green: number, blue: number): number {
    const [r, g, b] = [red, green, blue].map((channel) => {
      const value = channel / 255;
      return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function parseRgbColor(color: string): { red: number; green: number; blue: number; alpha: number } | null {
    const match = color.match(/^rgba?\((.+)\)$/);
    if (!match) return null;
    const parts = match[1]
      .replace(/\//g, ' ')
      .split(/[\s,]+/)
      .map((part) => part.trim())
      .filter(Boolean);
    const [red, green, blue] = parts.slice(0, 3).map(Number);
    const alpha = parts[3] === undefined ? 1 : Number(parts[3]);
    if ([red, green, blue, alpha].some((part) => Number.isNaN(part))) return null;
    return { red, green, blue, alpha };
  }

  function themeFromBackgroundColor(color: string): DeepSeekTheme | null {
    const rgb = parseRgbColor(color);
    if (!rgb || rgb.alpha < 0.2) return null;
    return relativeLuminance(rgb.red, rgb.green, rgb.blue) < 0.45 ? 'dark' : 'light';
  }

  function detectBackgroundTheme(): DeepSeekTheme | null {
    const sampled = document.elementFromPoint(
      Math.max(0, Math.floor(window.innerWidth / 2)),
      Math.max(0, Math.min(Math.floor(window.innerHeight / 2), 240)),
    );
    const candidates = [
      sampled,
      document.querySelector('main'),
      document.getElementById('root'),
      document.body,
      document.documentElement,
    ].filter((element): element is Element => Boolean(element));

    for (const candidate of candidates) {
      let element: Element | null = candidate;
      while (element && element !== document.documentElement.parentElement) {
        const theme = themeFromBackgroundColor(getComputedStyle(element).backgroundColor);
        if (theme) return theme;
        element = element.parentElement;
      }
    }
    return null;
  }

  function detectExplicitTheme(): DeepSeekTheme | null {
    const hosts = [document.documentElement, document.body, document.getElementById('root')]
      .filter((element): element is HTMLElement => Boolean(element));
    const attributeNames = ['data-theme', 'data-color-mode', 'data-mode', 'color-scheme'];

    for (const host of hosts) {
      for (const name of attributeNames) {
        const theme = parseThemeText(host.getAttribute(name));
        if (theme) return theme;
      }
      const themeFromClass = parseThemeText(typeof host.className === 'string' ? host.className : '');
      if (themeFromClass) return themeFromClass;
      const scheme = getComputedStyle(host).colorScheme.toLowerCase().trim();
      if (scheme === 'dark' || scheme === 'light') return scheme;
    }
    return null;
  }

  function detectHostTheme(): DeepSeekTheme {
    return (
      config.detectExtraTheme?.() ??
      detectExplicitTheme() ??
      detectBackgroundTheme() ??
      (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    );
  }

  function applyThemeClass(theme: DeepSeekTheme) {
    document.body.classList.toggle('dwplus-theme-dark', theme === 'dark');
    document.body.classList.toggle('dwplus-theme-light', theme === 'light');
  }

  function syncTheme() {
    const theme = detectHostTheme();
    applyThemeClass(theme);
    if (theme === currentTheme) return;
    currentTheme = theme;
    sendThemeMessage(theme);
  }

  function start(): void {
    syncTheme();
    themeObserver?.disconnect();
    themeObserver = new MutationObserver(scheduleThemeSync);
    observeThemeHost(document.documentElement);
    observeThemeHost(document.body);
    observeThemeHost(document.getElementById('root'));
    themeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    themeMediaListener = () => scheduleThemeSync();
    themeMediaQuery.addEventListener('change', themeMediaListener);
    startThemeBootstrapSync();
  }

  function stop(): void {
    themeObserver?.disconnect();
    themeObserver = null;
    stopThemeBootstrapSync();
    if (themeSyncTimer) {
      clearTimeout(themeSyncTimer);
      themeSyncTimer = null;
    }
    if (themeMediaQuery && themeMediaListener) {
      themeMediaQuery.removeEventListener('change', themeMediaListener);
    }
    themeMediaQuery = null;
    themeMediaListener = null;
  }

  return { start, stop };
}
