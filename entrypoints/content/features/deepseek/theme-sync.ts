import { createThemeSync } from '../shared/theme-sync-core';

const themeSync = createThemeSync({
  messageType: 'SET_DEEPSEEK_THEME',
  hostLabel: 'DeepSeek',
});

export function startThemeSync(): void {
  themeSync.start();
}

export function stopThemeSync(): void {
  themeSync.stop();
}
