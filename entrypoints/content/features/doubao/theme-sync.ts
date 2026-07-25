import { createThemeSync } from '../shared/theme-sync-core';

const themeSync = createThemeSync({
  messageType: 'SET_CLIENT_THEME',
  hostLabel: 'Doubao',
});

export function startDoubaoThemeSync(): void {
  themeSync.start();
}

export function stopDoubaoThemeSync(): void {
  themeSync.stop();
}
