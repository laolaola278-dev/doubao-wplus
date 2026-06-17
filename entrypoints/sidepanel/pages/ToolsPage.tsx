import { useEffect, useState } from 'react';
import {
  SHELL_MCP_NATIVE_HOST,
  SHELL_MCP_SERVER_NAME,
  createShellMcpPresetInput,
  getShellNativeHostName,
} from '../../../core/shell';
import { isShellNativeHostSupported } from '../../../core/platform';
import type { LocaleMessageKey } from '../../../core/i18n';
import type { McpServerConfig, McpToolAllowlist, McpToolCacheEntry, PlatformEnvironment, ToolDescriptor } from '../../../core/types';
import PageIntro from '../components/PageIntro';
import { useI18n } from '../i18n';

type PermissionState = 'idle' | 'granting' | 'granted' | 'denied' | 'error';
type DiagState = 'idle' | 'running' | 'done' | 'err';
type DiagResult = Record<string, { status: number; length: number; error?: string; preview?: string }>;
type PythonBusyState = 'idle' | 'creating' | 'refreshing' | 'toggling';

function DiagSearch() {
  const { t } = useI18n();
  const [query, setQuery] = useState(t('sidepanel.toolsPage.diagnosticsDefaultQuery'));
  const [state, setState] = useState<DiagState>('idle');
  const [result, setResult] = useState<DiagResult | null>(null);

  const run = async () => {
    setState('running');
    setResult(null);
    try {
      const res = await chrome.runtime.sendMessage({ type: 'DIAGNOSE_WEB_SEARCH', payload: { query } });
      setResult(res as DiagResult);
      setState('done');
    } catch {
      setState('err');
    }
  };

  const inputStyle = {
    background: 'var(--ds-bg)',
    borderColor: 'var(--ds-border)',
    color: 'var(--ds-text)',
  };

  return (
    <div className="ds-surface-panel rounded-xl p-4 space-y-3">
      <div className="flex gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && run()}
          className="flex-1 px-3 py-2 text-xs rounded-lg border outline-none"
          style={inputStyle}
        />
        <button
          onClick={run}
          disabled={state === 'running' || !query.trim()}
          className="ds-btn-secondary shrink-0 px-3 py-2 text-[11px] font-medium rounded-lg disabled:opacity-40"
        >
          {state === 'running' ? t('sidepanel.toolsPage.diagnosticsRunning') : t('sidepanel.toolsPage.diagnosticsRun')}
        </button>
      </div>
      {result && (
        <div className="text-[11px] space-y-2">
          {Object.entries(result).map(([domain, info]) => (
            <div key={domain} className="rounded-lg px-3 py-2" style={{
              background: info.status >= 200 && info.status < 400 ? 'var(--ds-success-bg)' : 'var(--ds-danger-bg)',
            }}>
              <div style={{ fontWeight: 600, color: 'var(--ds-text)' }}>{domain}</div>
              <div style={{ color: 'var(--ds-text-secondary)' }}>
                HTTP {info.status} · {t('sidepanel.toolsPage.bytes', { count: info.length })}
                {info.error && <span style={{ color: 'var(--ds-danger)' }}> · {t('sidepanel.toolsPage.errorPrefix', { error: info.error })}</span>}
              </div>
              {info.preview && (
                <div className="mt-1 p-2 rounded text-[10px] leading-relaxed" style={{
                  background: 'var(--ds-bg)', color: 'var(--ds-text-secondary)', maxHeight: 80, overflow: 'hidden',
                }}>
                  {info.preview.slice(0, 300)}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const TOOLS = [
  {
    key: 'web_search',
    nameKey: 'sidepanel.toolsPage.webSearchName',
    descriptionKey: 'sidepanel.toolsPage.webSearchDescription',
    icon: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z',
  },
  {
    key: 'web_fetch',
    nameKey: 'sidepanel.toolsPage.webFetchName',
    descriptionKey: 'sidepanel.toolsPage.webFetchDescription',
    icon: 'M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
  },
] as const satisfies readonly {
  key: string;
  nameKey: LocaleMessageKey;
  descriptionKey: LocaleMessageKey;
  icon: string;
}[];

type ToolKey = typeof TOOLS[number]['key'];

function PythonToolCard({
  server,
  cache,
  busy,
  message,
  nativeMessagingSupported,
  onCreate,
  onRefresh,
  onToggle,
}: {
  server: McpServerConfig | null;
  cache: McpToolCacheEntry | null;
  busy: PythonBusyState;
  message: string;
  nativeMessagingSupported: boolean;
  onCreate: () => void;
  onRefresh: () => void;
  onToggle: () => void;
}) {
  const { t } = useI18n();
  const pythonStatus = cache?.descriptors.find((tool) => tool.name === 'python_status') ?? null;
  const pythonExec = cache?.descriptors.find((tool) => tool.name === 'python_exec') ?? null;
  const enabled = Boolean(server && pythonExec && isMcpToolEnabled(server, pythonExec));
  const hasShell = Boolean(server);
  const canToggle = Boolean(server && pythonExec && busy === 'idle');
  const statusText = !server
    ? nativeMessagingSupported
      ? t('sidepanel.toolsPage.pythonStatusNoShell')
      : t('sidepanel.toolsPage.pythonStatusUnsupported')
    : !cache
      ? t('sidepanel.toolsPage.pythonStatusNoCache')
      : pythonExec
        ? enabled ? t('sidepanel.toolsPage.pythonStatusEnabled') : t('sidepanel.toolsPage.pythonStatusDiscovered')
        : t('sidepanel.toolsPage.pythonStatusMissing');

  return (
    <div className="ds-surface-panel rounded-xl p-4 flex items-start gap-3">
      <svg
        className="w-5 h-5 shrink-0 mt-0.5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.5}
        style={{ color: enabled ? 'var(--ds-blue)' : 'var(--ds-text-tertiary)' }}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l3 3-3 3m5 0h3M5 5h14a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2z" />
      </svg>

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-xs font-medium truncate" style={{ color: 'var(--ds-text)' }}>
              {t('sidepanel.toolsPage.pythonTitle')}
            </div>
            <div className="text-[10px] mt-0.5 truncate" style={{ color: 'var(--ds-text-tertiary)' }}>
              {statusText}
            </div>
          </div>
          <button
            onClick={onToggle}
            disabled={!canToggle}
            className="relative shrink-0 w-10 h-[22px] rounded-full transition-colors duration-200 disabled:opacity-50"
            style={{
              background: enabled ? 'var(--ds-blue)' : 'var(--ds-border)',
            }}
          >
            <span
              className="ds-switch-thumb absolute top-[3px] left-[3px] w-4 h-4 rounded-full transition-transform duration-200"
              style={{
                transform: enabled ? 'translateX(18px)' : 'translateX(0)',
              }}
            />
          </button>
        </div>

        <div className="text-[11px] mt-1 leading-relaxed" style={{ color: 'var(--ds-text-secondary)' }}>
          {t('sidepanel.toolsPage.pythonDescription')}
        </div>

        <div className="flex flex-wrap gap-1.5 mt-2">
          {!hasShell && (
            <button
              onClick={onCreate}
              disabled={busy !== 'idle' || !nativeMessagingSupported}
              className="ds-btn-secondary px-2 py-1 text-[11px] rounded-md disabled:opacity-50"
            >
              {busy === 'creating' ? t('sidepanel.toolsPage.pythonCreating') : t('sidepanel.toolsPage.pythonCreate')}
            </button>
          )}
          {hasShell && (
            <button
              onClick={onRefresh}
              disabled={busy !== 'idle'}
              className="ds-btn-secondary px-2 py-1 text-[11px] rounded-md disabled:opacity-50"
            >
              {busy === 'refreshing' ? t('sidepanel.toolsPage.pythonRefreshing') : t('sidepanel.toolsPage.pythonRefresh')}
            </button>
          )}
          {pythonStatus && (
            <span className="px-2 py-1 text-[10px] rounded-md" style={{ color: 'var(--ds-success)', background: 'var(--ds-success-bg)' }}>
              {t('sidepanel.toolsPage.pythonStatusAvailable')}
            </span>
          )}
        </div>

        {message && (
          <div className="text-[11px] mt-2 px-2 py-1.5 rounded-lg" style={{ color: 'var(--ds-text-secondary)', background: 'var(--ds-surface)' }}>
            {message}
          </div>
        )}
        {server && cache && !pythonExec && (
          <div className="text-[11px] mt-2 px-2 py-1.5 rounded-lg" style={{ color: 'var(--ds-danger)', background: 'var(--ds-danger-bg)' }}>
            {t('sidepanel.toolsPage.pythonMissingDetail')}
          </div>
        )}
      </div>
    </div>
  );
}

export default function ToolsPage() {
  const { t } = useI18n();
  const [settings, setSettings] = useState<Record<ToolKey, boolean>>({
    web_search: true,
    web_fetch: true,
  });
  const [permState, setPermState] = useState<PermissionState>('idle');
  const [permUrl, setPermUrl] = useState('');
  const [allSitesState, setAllSitesState] = useState<PermissionState>('idle');
  const [pythonServer, setPythonServer] = useState<McpServerConfig | null>(null);
  const [pythonCache, setPythonCache] = useState<McpToolCacheEntry | null>(null);
  const [pythonBusy, setPythonBusy] = useState<PythonBusyState>('idle');
  const [pythonMessage, setPythonMessage] = useState('');
  const [platform, setPlatform] = useState<PlatformEnvironment | null>(null);

  useEffect(() => {
    chrome.runtime.sendMessage({ type: 'GET_WEB_TOOL_SETTINGS' }).then((result: Record<string, boolean>) => {
      if (result) {
        setSettings((prev) => ({ ...prev, ...result }));
      }
    });
  }, []);

  useEffect(() => {
    void loadPythonTool();

    const handler = (msg: { type?: string }) => {
      if (msg.type === 'MCP_SERVERS_UPDATED' || msg.type === 'TOOL_DESCRIPTORS_UPDATED') {
        void loadPythonTool();
      }
    };
    chrome.runtime.onMessage.addListener(handler);
    return () => chrome.runtime.onMessage.removeListener(handler);
  }, []);

  const loadPythonTool = async () => {
    const [servers, environment]: [McpServerConfig[], PlatformEnvironment | null] = await Promise.all([
      chrome.runtime.sendMessage({ type: 'GET_MCP_SERVERS' }),
      chrome.runtime.sendMessage({ type: 'GET_PLATFORM_CAPABILITIES' }),
    ]);
    setPlatform(environment ?? null);
    const shell = (servers ?? []).find(isShellServer) ?? null;
    setPythonServer(shell);

    if (!shell) {
      setPythonCache(null);
      return;
    }

    const cache: McpToolCacheEntry | null = await chrome.runtime.sendMessage({
      type: 'GET_MCP_TOOL_CACHE',
      payload: { serverId: shell.id },
    });
    setPythonCache(cache ?? null);
  };

  const handleCreatePythonShell = async () => {
    setPythonBusy('creating');
    setPythonMessage('');
    try {
      if (!isShellNativeHostSupported(platform)) {
        setPythonMessage(t('sidepanel.toolsPage.pythonStatusUnsupported'));
        return;
      }
      const existing = pythonServer;
      if (existing) {
        setPythonMessage(t('sidepanel.toolsPage.shellExists'));
        return;
      }
      await chrome.runtime.sendMessage({
        type: 'CREATE_MCP_SERVER',
        // B-13 fix: respect the user-configured native host name (so
        // unpacked builds can use a different host name from the Web
        // Store build's `com.deepseek_pp.shell`).
        payload: createShellMcpPresetInput({ nativeHost: await getShellNativeHostName() }),
      });
      setPythonMessage(t('sidepanel.toolsPage.shellCreated'));
      await loadPythonTool();
    } finally {
      setPythonBusy('idle');
    }
  };

  const handleRefreshPythonTools = async () => {
    if (!pythonServer) return;
    setPythonBusy('refreshing');
    setPythonMessage('');
    try {
      const result = await chrome.runtime.sendMessage({
        type: 'REFRESH_MCP_SERVER_TOOLS',
        payload: { serverId: pythonServer.id },
      });
      const cache: McpToolCacheEntry | null = result?.cache ?? result ?? null;
      setPythonCache(cache);
      if (cache?.descriptors.some((tool) => tool.name === 'python_exec')) {
        setPythonMessage(t('sidepanel.toolsPage.pythonFound'));
      } else {
        setPythonMessage(t('sidepanel.toolsPage.pythonMissingAfterRefresh'));
      }
      await loadPythonTool();
    } finally {
      setPythonBusy('idle');
    }
  };

  const handleTogglePython = async () => {
    if (!pythonServer) return;
    const pythonExec = pythonCache?.descriptors.find((tool) => tool.name === 'python_exec');
    if (!pythonExec) {
      setPythonMessage(t('sidepanel.toolsPage.pythonMissingBeforeToggle'));
      return;
    }

    setPythonBusy('toggling');
    setPythonMessage('');
    try {
      const shouldEnable = !isMcpToolEnabled(pythonServer, pythonExec);
      await chrome.runtime.sendMessage({
        type: 'UPDATE_MCP_SERVER',
        payload: {
          id: pythonServer.id,
          patch: {
            enabled: shouldEnable ? true : pythonServer.enabled,
            execution: {
              ...pythonServer.execution,
              enabled: shouldEnable ? true : pythonServer.execution.enabled,
              mode: shouldEnable ? 'auto' : pythonServer.execution.mode,
            },
            allowlist: nextAllowlistForTool(pythonServer.allowlist, pythonExec, shouldEnable),
          },
        },
      });
      setPythonMessage(shouldEnable ? t('sidepanel.toolsPage.pythonEnabled') : t('sidepanel.toolsPage.pythonDisabled'));
      await loadPythonTool();
    } finally {
      setPythonBusy('idle');
    }
  };

  const handleToggle = async (key: ToolKey, enabled: boolean) => {
    setSettings((prev) => ({ ...prev, [key]: enabled }));
    await chrome.runtime.sendMessage({
      type: 'SET_WEB_TOOL_SETTING',
      payload: { name: key, enabled },
    });
  };

  const handleGrantPermission = async () => {
    const trimmed = permUrl.trim();
    if (!trimmed) return;
    let origin: string;
    try {
      origin = new URL(trimmed).origin + '/*';
    } catch {
      setPermState('error');
      return;
    }
    setPermState('granting');
    const result = await chrome.runtime.sendMessage({
      type: 'REQUEST_HOST_PERMISSION',
      payload: { origins: [origin] },
    });
    if (result?.ok) {
      setPermState('granted');
    } else {
      setPermState('denied');
    }
  };

  const handleGrantAllSites = async () => {
    setAllSitesState('granting');
    const result = await chrome.runtime.sendMessage({
      type: 'REQUEST_HOST_PERMISSION',
      payload: { origins: ['http://*/*', 'https://*/*'] },
    });
    setAllSitesState(result?.ok ? 'granted' : 'denied');
  };

  return (
    <div className="p-4 space-y-4">
      <PageIntro
        title={t('sidepanel.toolsPage.toolTitle')}
        description={t('sidepanel.toolsPage.toolDescription')}
      />

      <div className="space-y-2">
        {TOOLS.map((tool) => (
          <div
            key={tool.key}
            className="ds-surface-panel rounded-xl p-4 flex items-start gap-3"
          >
            <svg
              className="w-5 h-5 shrink-0 mt-0.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
              style={{ color: settings[tool.key] ? 'var(--ds-blue)' : 'var(--ds-text-tertiary)' }}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d={tool.icon} />
            </svg>

            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <div
                  className="text-xs font-medium truncate"
                  style={{ color: 'var(--ds-text)' }}
                >
                  {t(tool.nameKey)}
                </div>
                <button
                  onClick={() => handleToggle(tool.key, !settings[tool.key])}
                  className="relative shrink-0 w-10 h-[22px] rounded-full transition-colors duration-200"
                  style={{
                    background: settings[tool.key] ? 'var(--ds-blue)' : 'var(--ds-border)',
                  }}
                >
                  <span
                    className="ds-switch-thumb absolute top-[3px] left-[3px] w-4 h-4 rounded-full transition-transform duration-200"
                    style={{
                      transform: settings[tool.key] ? 'translateX(18px)' : 'translateX(0)',
                    }}
                  />
                </button>
              </div>
              <div
                className="text-[11px] mt-1 leading-relaxed"
                style={{ color: 'var(--ds-text-secondary)' }}
              >
                {t(tool.descriptionKey)}
              </div>
            </div>
          </div>
        ))}
        <PythonToolCard
          server={pythonServer}
          cache={pythonCache}
          busy={pythonBusy}
          message={pythonMessage}
          nativeMessagingSupported={isShellNativeHostSupported(platform)}
          onCreate={handleCreatePythonShell}
          onRefresh={handleRefreshPythonTools}
          onToggle={handleTogglePython}
        />
      </div>

      <div
        className="text-[11px] px-3 py-2 rounded-lg"
        style={{
          color: 'var(--ds-text-tertiary)',
          background: 'var(--ds-surface)',
        }}
      >
        {t('sidepanel.toolsPage.disabledNotice')}
      </div>

      <section className="space-y-2">
        <h2 className="text-[13px] font-medium" style={{ color: 'var(--ds-text)' }}>
          {t('sidepanel.toolsPage.diagnosticTitle')}
        </h2>
        <p className="text-[11px]" style={{ color: 'var(--ds-text-tertiary)' }}>
          {t('sidepanel.toolsPage.diagnosticDescription')}
        </p>
        <DiagSearch />
      </section>

      <section className="space-y-2">
        <h2 className="text-[13px] font-medium" style={{ color: 'var(--ds-text)' }}>
          {t('sidepanel.toolsPage.permissionTitle')}
        </h2>
        <p className="text-[11px]" style={{ color: 'var(--ds-text-tertiary)' }}>
          {t('sidepanel.toolsPage.permissionDescription')}
        </p>
        <div className="flex gap-2">
          <input
            type="url"
            placeholder="https://example.com"
            value={permUrl}
            onChange={(e) => { setPermUrl(e.target.value); setPermState('idle'); }}
            onKeyDown={(e) => e.key === 'Enter' && handleGrantPermission()}
            className="flex-1 px-3 py-2 text-xs rounded-lg border outline-none transition-colors focus:border-[var(--ds-blue)]"
            style={{
              background: 'var(--ds-bg)',
              borderColor: 'var(--ds-border)',
              color: 'var(--ds-text)',
            }}
          />
          <button
            onClick={handleGrantPermission}
            disabled={!permUrl.trim() || permState === 'granting'}
            className="ds-btn-secondary shrink-0 px-3 py-2 text-[11px] font-medium rounded-lg transition-all duration-150 disabled:opacity-40 flex items-center gap-1.5"
          >
            {permState === 'granting' ? (
              <span className="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
            ) : null}
            {t('sidepanel.toolsPage.grantPermission')}
          </button>
        </div>
        {permState === 'granted' && (
          <div
            className="text-[11px] px-3 py-2 rounded-lg"
            style={{ color: 'var(--ds-success)', background: 'var(--ds-success-bg)' }}
          >
            {t('sidepanel.toolsPage.permissionGranted')}
          </div>
        )}
        {permState === 'denied' && (
          <div
            className="text-[11px] px-3 py-2 rounded-lg"
            style={{ color: 'var(--ds-danger)', background: 'var(--ds-danger-bg)' }}
          >
            {t('sidepanel.toolsPage.permissionDenied')}
          </div>
        )}
        {permState === 'error' && (
          <div
            className="text-[11px] px-3 py-2 rounded-lg"
            style={{ color: 'var(--ds-danger)', background: 'var(--ds-danger-bg)' }}
          >
            {t('sidepanel.toolsPage.permissionInvalidUrl')}
          </div>
        )}

        <div className="pt-1">
          <button
            onClick={handleGrantAllSites}
            disabled={allSitesState === 'granting' || allSitesState === 'granted'}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-[12px] font-medium rounded-xl transition-all duration-150 disabled:opacity-50"
            style={{
              background: allSitesState === 'granted' ? 'var(--ds-success-bg)' : 'var(--ds-surface)',
              color: allSitesState === 'granted' ? 'var(--ds-success)' : 'var(--ds-blue)',
              border: `1px solid ${allSitesState === 'granted' ? 'var(--ds-success-border)' : 'var(--ds-blue)'}`,
            }}
          >
            {allSitesState === 'granting' ? (
              <span className="inline-block w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
            ) : allSitesState === 'granted' ? (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            )}
            {allSitesState === 'granting'
              ? t('sidepanel.toolsPage.allSitesRequesting')
              : allSitesState === 'granted'
                ? t('sidepanel.toolsPage.allSitesGranted')
                : t('sidepanel.toolsPage.allSitesGrant')}
          </button>
          <p className="text-[10px] mt-1.5 text-center" style={{ color: 'var(--ds-text-tertiary)' }}>
            {t('sidepanel.toolsPage.allSitesHelp')}
          </p>
        </div>
      </section>
    </div>
  );
}

function isShellServer(server: McpServerConfig): boolean {
  return server.displayName === SHELL_MCP_SERVER_NAME || server.transport.nativeHost === SHELL_MCP_NATIVE_HOST;
}

function isMcpToolEnabled(server: McpServerConfig, tool: ToolDescriptor): boolean {
  if (!server.enabled || !server.execution.enabled || server.execution.mode !== 'auto') return false;
  const selected = server.allowlist.toolNames.includes(tool.name) || server.allowlist.toolNames.includes(tool.invocationName);
  if (server.allowlist.mode === 'allow') return selected;
  if (server.allowlist.mode === 'deny') return !selected;
  return true;
}

function nextAllowlistForTool(
  allowlist: McpToolAllowlist,
  tool: ToolDescriptor,
  shouldEnable: boolean,
): McpToolAllowlist {
  const names = new Set(allowlist.toolNames);
  const removeTool = () => {
    names.delete(tool.name);
    names.delete(tool.invocationName);
  };

  if (allowlist.mode === 'allow') {
    if (shouldEnable) names.add(tool.name);
    else removeTool();
    return { mode: 'allow', toolNames: [...names] };
  }

  if (allowlist.mode === 'deny') {
    if (shouldEnable) removeTool();
    else names.add(tool.name);
    return { mode: names.size === 0 ? 'all' : 'deny', toolNames: [...names] };
  }

  if (!shouldEnable) {
    return { mode: 'deny', toolNames: [tool.name] };
  }
  return allowlist;
}
