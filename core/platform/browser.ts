import {
  getCurrentBrowserExtensionEnvironment,
  type PlatformServices,
} from './capabilities';

export function createBrowserExtensionPlatformServices(): PlatformServices {
  return {
    environment: getCurrentBrowserExtensionEnvironment(),
    storage: {
      async get<T = unknown>(key: string): Promise<T | null> {
        const data = await chrome.storage.local.get(key) as Record<string, T | undefined>;
        return data[key] ?? null;
      },
      async set<T = unknown>(key: string, value: T): Promise<void> {
        await chrome.storage.local.set({ [key]: value });
      },
      async remove(key: string): Promise<void> {
        await chrome.storage.local.remove(key);
      },
    },
    runtime: {
      async sendMessage<T = unknown>(message: unknown): Promise<T> {
        return chrome.runtime.sendMessage(message) as Promise<T>;
      },
    },
    download: {
      async download(input): Promise<void> {
        const blob = new Blob([input.content], { type: input.mimeType });
        const url = URL.createObjectURL(blob);
        try {
          await chrome.downloads.download({
            url,
            filename: input.filename,
            saveAs: true,
          });
        } finally {
          setTimeout(() => URL.revokeObjectURL(url), 30_000);
        }
      },
      // B-08: 让用户在系统文件管理器里定位刚刚下下来的 ref_file 附件。
      // chrome.downloads.show 仅 Windows / macOS 可用，Linux 上不抛错而是返回 false，
      // UI 看到 false 就退化成"复制路径"按钮。
      async show(downloadId: number): Promise<boolean> {
        if (typeof downloadId !== 'number' || downloadId < 0) return false;
        if (typeof chrome.downloads?.show !== 'function') return false;
        try {
          await new Promise<void>((resolve, reject) => {
            (chrome.downloads.show as (id: number) => void)(downloadId);
            // chrome.downloads.show 的回调在不同 Chrome 版本里签名不一样；
            // 这里不传 callback 而是 polling runtime.lastError。
            queueMicrotask(() => {
              const last = chrome.runtime.lastError;
              if (last) {
                reject(new Error(last.message ?? 'chrome.downloads.show failed'));
                return;
              }
              resolve();
            });
          });
          return true;
        } catch {
          return false;
        }
      },
    },
    getAssetUrl(path: string): string {
      return chrome.runtime.getURL(path.replace(/^\/+/, ''));
    },
  };
}
