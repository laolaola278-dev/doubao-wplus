(function () {
  const bridge = window.AndroidBridge;
  if (!bridge) return;

  function parseJson(raw, fallback) {
    if (raw === undefined || raw === null || raw === "") return fallback;
    try {
      return JSON.parse(String(raw));
    } catch (_error) {
      return fallback;
    }
  }

  const runtimeListeners = new Set();

  const runtime = {
    id: "doubao-wplus-android",
    getURL(path) {
      return bridge.getAssetUrl(String(path || "").replace(/^\/+/, ""));
    },
    async sendMessage(message) {
      const raw = bridge.postMessage(JSON.stringify(message || {}));
      return parseJson(raw, undefined);
    },
    onMessage: {
      addListener(listener) {
        runtimeListeners.add(listener);
      },
      removeListener(listener) {
        runtimeListeners.delete(listener);
      },
    },
  };

  const storage = {
    local: {
      async get(key) {
        if (typeof key === "string") {
          return { [key]: parseJson(bridge.getStorage(key), undefined) };
        }
        if (Array.isArray(key)) {
          return Object.fromEntries(key.map((item) => [item, parseJson(bridge.getStorage(item), undefined)]));
        }
        return {};
      },
      async set(values) {
        Object.entries(values || {}).forEach(([key, value]) => {
          bridge.setStorage(key, JSON.stringify(value));
        });
      },
      async remove(key) {
        bridge.removeStorage(String(key || ""));
      },
    },
    onChanged: {
      addListener() {},
      removeListener() {},
    },
  };

  window.chrome = window.chrome || {};
  window.chrome.runtime = window.chrome.runtime || runtime;
  window.chrome.storage = window.chrome.storage || storage;
  window.chrome.downloads = window.chrome.downloads || {
    async download(input) {
      return bridge.downloadBlob("", "application/octet-stream", input && input.filename);
    },
  };
})();
