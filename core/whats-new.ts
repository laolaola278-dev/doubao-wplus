import { getExtensionVersion } from './version';
import type { LocaleMessageKey } from './i18n';
import { readStorageValueWithMigration } from './platform/storage-migration';

export interface WhatsNewItem {
  id: string;
  titleKey: LocaleMessageKey;
}

export interface WhatsNewState {
  version: string;
  visible: boolean;
  pendingUpdate: boolean;
}

export const WHATS_NEW_ITEMS: WhatsNewItem[] = [
  { id: 'browser-control', titleKey: 'sidepanel.whatsNew.items.browserControl' },
  { id: 'browser-control-boundary', titleKey: 'sidepanel.whatsNew.items.browserControlBoundary' },
  { id: 'sidepanel-feedback', titleKey: 'sidepanel.whatsNew.items.sidepanelFeedback' },
  { id: 'third-party-skills', titleKey: 'sidepanel.whatsNew.items.thirdPartySkills' },
];

const LAST_SEEN_VERSION_KEY = 'doubao_wplus_whats_new_dismissed_version';
const PENDING_UPDATE_VERSION_KEY = 'doubao_wplus_whats_new_pending_version';
// backward compat: old brand
const DEPRECATED_LAST_SEEN_VERSION_KEY = 'deepseek_pp_whats_new_dismissed_version';
// backward compat: old brand
const DEPRECATED_PENDING_UPDATE_VERSION_KEY = 'deepseek_pp_whats_new_pending_version';

export async function shouldShowWhatsNew(): Promise<boolean> {
  return (await getWhatsNewState()).visible;
}

export async function getWhatsNewState(): Promise<WhatsNewState> {
  const version = getExtensionVersion();
  const [lastSeenVersion, pendingVersion] = await Promise.all([
    readStorageValueWithMigration(
      chrome.storage.local,
      LAST_SEEN_VERSION_KEY,
      DEPRECATED_LAST_SEEN_VERSION_KEY,
    ),
    readStorageValueWithMigration(
      chrome.storage.local,
      PENDING_UPDATE_VERSION_KEY,
      DEPRECATED_PENDING_UPDATE_VERSION_KEY,
    ),
  ]);
  const pendingUpdate = pendingVersion === version;

  return {
    version,
    pendingUpdate,
    visible: pendingUpdate || lastSeenVersion !== version,
  };
}

export async function markWhatsNewPending(previousVersion?: string | null): Promise<void> {
  const version = getExtensionVersion();
  if (previousVersion === version) return;
  await chrome.storage.local.set({ [PENDING_UPDATE_VERSION_KEY]: version });
}

export async function hasPendingWhatsNew(): Promise<boolean> {
  return (await getWhatsNewState()).pendingUpdate;
}

export async function dismissWhatsNew(): Promise<void> {
  await chrome.storage.local.set({ [LAST_SEEN_VERSION_KEY]: getExtensionVersion() });
  await chrome.storage.local.remove([
    PENDING_UPDATE_VERSION_KEY,
    DEPRECATED_PENDING_UPDATE_VERSION_KEY,
  ]);
}
