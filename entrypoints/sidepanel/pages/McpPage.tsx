import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  DEPRECATED_SHELL_MCP_NATIVE_HOST,
  SHELL_MCP_NATIVE_HOST,
  SHELL_MCP_SERVER_NAME,
  createShellMcpPresetInput,
  getShellNativeHostName,
} from '../../../core/shell';
import {
  getSupportedMcpTransportKinds,
  isShellNativeHostSupported,
} from '../../../core/platform';
import type { LocaleMessageKey, MessageParams, SupportedLocale } from '../../../core/i18n';
import type {
  McpHeaderValue,
  McpSecretValue,
  McpServerConfig,
  McpServerCreateInput,
  McpServerStatus,
  McpServerTransportConfig,
  McpToolAllowlist,
  McpToolCacheEntry,
  ToolCallHistoryRecord,
  ToolDescriptor,
  ToolExecutionMode,
  PlatformEnvironment,
} from '../../../core/types';
import PageIntro from '../components/PageIntro';
import { useI18n } from '../i18n';

type McpTransportKind = McpServerTransportConfig['kind'];
type CacheByServer = Record<string, McpToolCacheEntry | null>;
type BusyAction = 'refresh' | 'test' | 'permission';
type Translator = (key: LocaleMessageKey, params?: MessageParams) => string;

type FormState = {
  displayName: string;
  enabled: boolean;
  transportKind: McpTransportKind;
  url: string;
  nativeHost: string;
  command: string;
  args: string;
  cwd: string;
  env: string;
  headers: McpHeaderValue[];
  secrets: McpSecretValue[];
  connectMs: string;
  requestMs: string;
  discoveryMs: string;
  maxResultBytes: string;
  maxToolCount: string;
  executionEnabled: boolean;
  executionMode: ToolExecutionMode;
};

const TRANSPORT_OPTIONS: { kind: McpTransportKind; label: string; hintKey: LocaleMessageKey }[] = [
  { kind: 'streamable_http', label: 'Streamable HTTP', hintKey: 'sidepanel.mcpPage.transportHints.streamableHttp' },
  { kind: 'http', label: 'HTTP', hintKey: 'sidepanel.mcpPage.transportHints.http' },
  { kind: 'sse', label: 'SSE', hintKey: 'sidepanel.mcpPage.transportHints.sse' },
  { kind: 'stdio_bridge', label: 'Stdio Bridge', hintKey: 'sidepanel.mcpPage.transportHints.stdioBridge' },
  { kind: 'native_messaging', label: 'Native', hintKey: 'sidepanel.mcpPage.transportHints.nativeMessaging' },
];

const DEFAULT_FORM: FormState = {
  displayName: '',
  enabled: true,
  transportKind: 'streamable_http',
  url: '',
  nativeHost: '',
  command: '',
  args: '',
  cwd: '',
  env: '',
  headers: [],
  secrets: [],
  connectMs: '10000',
  requestMs: '60000',
  discoveryMs: '20000',
  maxResultBytes: '64000',
  maxToolCount: '128',
  executionEnabled: true,
  executionMode: 'auto',
};

export default function McpPage() {
  const { t, locale } = useI18n();
  const [servers, setServers] = useState<McpServerConfig[]>([]);
  const [caches, setCaches] = useState<CacheByServer>({});
  const [history, setHistory] = useState<ToolCallHistoryRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<McpServerConfig | null>(null);
  const [busy, setBusy] = useState<Record<string, BusyAction | null>>({});
  const [message, setMessage] = useState('');
  const [platform, setPlatform] = useState<PlatformEnvironment | null>(null);

  const selected = servers.find((server) => server.id === selectedId) ?? servers[0] ?? null;
  const selectedCache = selected ? caches[selected.id] ?? null : null;
  const enabledCount = servers.filter((server) => server.enabled).length;
  const toolCount = useMemo(
    () => servers.reduce((sum, server) => sum + enabledToolCount(server, caches[server.id]?.descriptors ?? []), 0),
    [servers, caches],
  );
  const mcpHistory = history.filter((record) => record.call.provider?.kind === 'mcp');
  const nativeMessagingSupported = isShellNativeHostSupported(platform);

  const load = async () => {
    setLoading(true);
    try {
      const [list, environment]: [McpServerConfig[], PlatformEnvironment | null] = await Promise.all([
        chrome.runtime.sendMessage({ type: 'GET_MCP_SERVERS' }),
        chrome.runtime.sendMessage({ type: 'GET_PLATFORM_CAPABILITIES' }),
      ]);
      const nextServers = list ?? [];
      setPlatform(environment ?? null);
      setServers(nextServers);
      setSelectedId((current) => {
        if (current && nextServers.some((server) => server.id === current)) return current;
        return nextServers[0]?.id ?? null;
      });

      const cacheEntries = await Promise.all(
        nextServers.map(async (server) => {
          const cache: McpToolCacheEntry | null = await chrome.runtime.sendMessage({
            type: 'GET_MCP_TOOL_CACHE',
            payload: { serverId: server.id },
          });
          return [server.id, cache] as const;
        }),
      );
      setCaches(Object.fromEntries(cacheEntries));

      const recent: ToolCallHistoryRecord[] = await chrome.runtime.sendMessage({
        type: 'GET_TOOL_CALL_HISTORY',
        payload: { limit: 12 },
      });
      setHistory(recent ?? []);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : t('sidepanel.mcpPage.messages.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();

    const handleUpdate = (msg: { type?: string; servers?: McpServerConfig[] }) => {
      if (msg.type === 'MCP_SERVERS_UPDATED' && Array.isArray(msg.servers)) {
        setServers(msg.servers);
      }
      if (
        msg.type === 'MCP_SERVERS_UPDATED' ||
        msg.type === 'TOOL_DESCRIPTORS_UPDATED' ||
        msg.type === 'TOOL_CALL_HISTORY_UPDATED'
      ) {
        void load();
      }
    };
    const refreshWhenVisible = () => {
      if (!document.hidden) void load();
    };

    chrome.runtime.onMessage.addListener(handleUpdate);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    window.addEventListener('focus', refreshWhenVisible);

    return () => {
      chrome.runtime.onMessage.removeListener(handleUpdate);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
      window.removeEventListener('focus', refreshWhenVisible);
    };
  }, []);

  const startCreate = () => {
    setEditing(null);
    setMessage('');
    setShowForm((prev) => !prev);
  };

  const createShellPreset = async () => {
    setMessage('');
    if (!nativeMessagingSupported) {
      setMessage(t('sidepanel.mcpPage.messages.nativeMessagingUnsupported'));
      return;
    }
    const existing = servers.find((server) =>
      server.displayName === SHELL_MCP_SERVER_NAME ||
      server.transport.nativeHost === SHELL_MCP_NATIVE_HOST ||
      server.transport.nativeHost === DEPRECATED_SHELL_MCP_NATIVE_HOST
    );
    if (existing) {
      setSelectedId(existing.id);
      setMessage(t('sidepanel.mcpPage.messages.shellExistsSelected'));
      return;
    }

    const server: McpServerConfig | null = await chrome.runtime.sendMessage({
      type: 'CREATE_MCP_SERVER',
      // B-13 fix: see ToolsPage.tsx.
      payload: createShellMcpPresetInput({ nativeHost: await getShellNativeHostName() }),
    });
    if (!server) {
      setMessage(t('sidepanel.mcpPage.messages.shellCreateFailed'));
      return;
    }
    setSelectedId(server.id);
    setMessage(t('sidepanel.mcpPage.messages.shellCreated'));
    await load();
  };

  const startEdit = (server: McpServerConfig) => {
    setEditing(server);
    setMessage('');
    setShowForm(true);
  };

  const saveServer = async (payload: McpServerCreateInput) => {
    const editingServer = editing ? servers.find((server) => server.id === editing.id) ?? editing : null;
    const requestPayload = editingServer
      ? { ...payload, allowlist: editingServer.allowlist }
      : payload;
    const response = editing
      ? await chrome.runtime.sendMessage({
        type: 'UPDATE_MCP_SERVER',
        payload: { id: editing.id, patch: requestPayload },
      })
      : await chrome.runtime.sendMessage({ type: 'CREATE_MCP_SERVER', payload: requestPayload });

    if (!response) {
      setMessage(t('sidepanel.mcpPage.messages.saveFailed'));
      return;
    }

    setShowForm(false);
    setEditing(null);
    setMessage('');
    await load();
  };

  const removeServer = async (server: McpServerConfig) => {
    if (!confirm(t('sidepanel.mcpPage.messages.deleteConfirm', { name: server.displayName }))) return;
    await chrome.runtime.sendMessage({ type: 'DELETE_MCP_SERVER', payload: { id: server.id } });
    if (selectedId === server.id) setSelectedId(null);
    await load();
  };

  const patchServer = async (server: McpServerConfig, patch: Partial<McpServerConfig>) => {
    await chrome.runtime.sendMessage({
      type: 'UPDATE_MCP_SERVER',
      payload: { id: server.id, patch },
    });
    await load();
  };

  const requestPermission = async (server: McpServerConfig) => {
    setBusyState(server.id, 'permission');
    setMessage('');
    try {
      const result = await requestMcpOriginPermission(server);
      setMessage(result?.ok
        ? t('sidepanel.mcpPage.messages.permissionGranted', { origin: result.origin ?? t('sidepanel.mcpPage.localHost') })
        : (result?.error ?? t('sidepanel.mcpPage.messages.permissionDenied')));
    } finally {
      setBusyState(server.id, null);
    }
  };

  const refreshServer = async (server: McpServerConfig, action: 'refresh' | 'test') => {
    setBusyState(server.id, action);
    setMessage('');
    try {
      if (requiresOriginPermission(server)) {
        const permission = await requestMcpOriginPermission(server);
        if (!permission?.ok) {
          setMessage(permission?.error ?? t('sidepanel.mcpPage.messages.permissionRequired', {
            origin: permission?.origin ?? 'MCP Host',
          }));
          return;
        }
      }
      const result = await chrome.runtime.sendMessage({
        type: action === 'test' ? 'TEST_MCP_SERVER_CONNECTION' : 'REFRESH_MCP_SERVER_TOOLS',
        payload: { serverId: server.id },
      });
      const cache: McpToolCacheEntry | null = result?.cache ?? result ?? null;
      if (cache) {
        setCaches((prev) => ({ ...prev, [server.id]: cache }));
        setMessage(cache.health.status === 'ready'
          ? t('sidepanel.mcpPage.messages.connectionSuccess', {
            tools: cache.health.toolCount,
            latency: formatMs(cache.health.latencyMs),
          })
          : cache.health.error ?? t('sidepanel.mcpPage.messages.connectionFailed'));
      }
      await load();
    } finally {
      setBusyState(server.id, null);
    }
  };

  const toggleTool = async (server: McpServerConfig, tool: ToolDescriptor) => {
    const enabled = isToolEnabled(server, tool);
    const allowlist = nextAllowlistForTool(server.allowlist, tool, !enabled);
    await patchServer(server, { allowlist });
  };

  const setBusyState = (serverId: string, action: BusyAction | null) => {
    setBusy((prev) => ({ ...prev, [serverId]: action }));
  };

  return (
    <div className="p-4 space-y-3">
      <PageIntro
        title={t('sidepanel.mcpPage.title')}
        description={t('sidepanel.mcpPage.description')}
        meta={t('sidepanel.mcpPage.summary', {
          servers: servers.length,
          enabled: enabledCount,
          tools: toolCount,
        })}
        actions={(
          <>
            <button
              onClick={createShellPreset}
              disabled={!nativeMessagingSupported}
              title={!nativeMessagingSupported ? t('sidepanel.mcpPage.messages.nativeMessagingUnsupported') : undefined}
              className="ds-btn-secondary px-3 py-1.5 text-xs rounded-lg transition-all duration-150 disabled:opacity-50"
            >
              {t('sidepanel.mcpPage.shell')}
            </button>
            <button
              onClick={startCreate}
              className="ds-btn-primary px-3 py-1.5 text-xs font-medium text-white rounded-lg transition-all duration-150 flex items-center gap-1"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              {t('sidepanel.mcpPage.addServer')}
            </button>
          </>
        )}
      />

      {message && (
        <div className="rounded-lg px-3 py-2 text-xs" style={{ color: 'var(--ds-text-secondary)', background: 'var(--ds-surface)', border: '1px solid var(--ds-border)' }}>
          {message}
        </div>
      )}

      {showForm && (
        <div className="animate-slide-down">
          <McpServerForm
            key={editing?.id ?? 'create'}
            initial={editing}
            platform={platform}
            onSave={saveServer}
            onCancel={() => { setShowForm(false); setEditing(null); setMessage(''); }}
          />
        </div>
      )}

      {loading && servers.length === 0 ? (
        <EmptyState label={t('sidepanel.mcpPage.loading')} />
      ) : servers.length === 0 && !showForm ? (
        <EmptyState label={t('sidepanel.mcpPage.empty')} />
      ) : (
        <div className="space-y-3">
          <div className="space-y-2">
            {servers.map((server) => (
              <ServerRow
                key={server.id}
                server={server}
                cache={caches[server.id] ?? null}
                selected={selected?.id === server.id}
                busy={busy[server.id] ?? null}
                onSelect={() => setSelectedId(server.id)}
                onToggle={() => patchServer(server, { enabled: !server.enabled })}
                onEdit={() => startEdit(server)}
                onDelete={() => removeServer(server)}
                onRefresh={() => refreshServer(server, 'refresh')}
                onTest={() => refreshServer(server, 'test')}
                t={t}
              />
            ))}
          </div>

          {selected && (
            <ServerDetail
              server={selected}
              cache={selectedCache}
              history={mcpHistory}
              busy={busy[selected.id] ?? null}
              onPatch={(patch) => patchServer(selected, patch)}
              onRequestPermission={() => requestPermission(selected)}
              onRefresh={() => refreshServer(selected, 'refresh')}
              onTest={() => refreshServer(selected, 'test')}
              onToggleTool={(tool) => toggleTool(selected, tool)}
              t={t}
              locale={locale}
            />
          )}
        </div>
      )}
    </div>
  );
}

function McpServerForm({
  initial,
  platform,
  onSave,
  onCancel,
}: {
  initial: McpServerConfig | null;
  platform: PlatformEnvironment | null;
  onSave: (payload: McpServerCreateInput) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [form, setForm] = useState<FormState>(() => initial ? formFromServer(initial) : DEFAULT_FORM);
  const [error, setError] = useState('');
  const supportedTransportKinds = getSupportedMcpTransportKinds(
    TRANSPORT_OPTIONS.map((item) => item.kind),
    platform,
  );
  const transportOptions = TRANSPORT_OPTIONS.filter((item) => supportedTransportKinds.includes(item.kind));
  const selectedTransport = transportOptions.find((item) => item.kind === form.transportKind) ?? transportOptions[0] ?? TRANSPORT_OPTIONS[0];

  useEffect(() => {
    if (supportedTransportKinds.includes(form.transportKind)) return;
    setForm((prev) => ({
      ...prev,
      transportKind: 'streamable_http',
      nativeHost: '',
    }));
  }, [form.transportKind, supportedTransportKinds.join('|')]);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const setTransportKind = (kind: McpTransportKind) => {
    setForm((prev) => ({ ...prev, transportKind: kind }));
  };

  const save = async () => {
    const result = payloadFromForm(form, t, platform);
    if ('error' in result) {
      setError(result.error);
      return;
    }
    setError('');
    await onSave(result.payload);
  };

  return (
    <div className="ds-form rounded-lg p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[13px] font-medium" style={{ color: 'var(--ds-text)' }}>
          {initial ? t('sidepanel.mcpPage.form.editTitle') : t('sidepanel.mcpPage.form.createTitle')}
        </div>
        <label className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--ds-text-secondary)' }}>
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={(event) => update('enabled', event.target.checked)}
          />
          {t('sidepanel.mcpPage.enabled')}
        </label>
      </div>

      {error && (
        <div className="rounded-lg px-3 py-2 text-xs" style={{ color: 'var(--ds-danger)', background: 'var(--ds-danger-bg)', border: '1px solid var(--ds-danger-border)' }}>
          {error}
        </div>
      )}

      <Field label={t('sidepanel.mcpPage.form.name')}>
        <input
          value={form.displayName}
          onChange={(event) => update('displayName', event.target.value)}
          className="ds-input w-full rounded-lg px-3 py-2 text-sm"
          placeholder="Filesystem MCP"
        />
      </Field>

      <Field label={t('sidepanel.mcpPage.form.transport')}>
        <select
          value={form.transportKind}
          onChange={(event) => setTransportKind(event.target.value as McpTransportKind)}
          className="ds-input w-full rounded-lg px-3 py-2 text-sm"
        >
          {transportOptions.map((item) => (
            <option key={item.kind} value={item.kind}>{item.label}</option>
          ))}
        </select>
        <div className="text-[11px] mt-1" style={{ color: 'var(--ds-text-tertiary)' }}>{t(selectedTransport.hintKey)}</div>
      </Field>

      {form.transportKind !== 'native_messaging' && (
        <Field label={form.transportKind === 'stdio_bridge' ? 'Bridge URL' : t('sidepanel.mcpPage.form.serviceUrl')}>
          <input
            value={form.url}
            onChange={(event) => update('url', event.target.value)}
            className="ds-input w-full rounded-lg px-3 py-2 text-sm"
            placeholder={form.transportKind === 'stdio_bridge' ? 'http://127.0.0.1:8765/mcp' : 'https://example.com/mcp'}
          />
        </Field>
      )}

      {form.transportKind === 'native_messaging' && (
        <Field label="Native Host">
          <input
            value={form.nativeHost}
            onChange={(event) => update('nativeHost', event.target.value)}
            className="ds-input w-full rounded-lg px-3 py-2 text-sm"
            placeholder="com.example.mcp_host"
          />
        </Field>
      )}

      {form.transportKind === 'stdio_bridge' && (
        <div className="space-y-2">
          <Field label={t('sidepanel.mcpPage.form.command')}>
            <input
              value={form.command}
              onChange={(event) => update('command', event.target.value)}
              className="ds-input w-full rounded-lg px-3 py-2 text-sm"
              placeholder="npx"
            />
          </Field>
          <Field label={t('sidepanel.mcpPage.form.args')}>
            <input
              value={form.args}
              onChange={(event) => update('args', event.target.value)}
              className="ds-input w-full rounded-lg px-3 py-2 text-sm"
              placeholder="-y @modelcontextprotocol/server-filesystem /tmp"
            />
          </Field>
          <Field label={t('sidepanel.mcpPage.form.cwd')}>
            <input
              value={form.cwd}
              onChange={(event) => update('cwd', event.target.value)}
              className="ds-input w-full rounded-lg px-3 py-2 text-sm"
              placeholder="/Users/me/project"
            />
          </Field>
          <Field label={t('sidepanel.mcpPage.form.env')}>
            <textarea
              value={form.env}
              onChange={(event) => update('env', event.target.value)}
              className="ds-input w-full rounded-lg px-3 py-2 text-sm min-h-18 resize-y"
              placeholder={'KEY=value\nTOKEN=...'}
            />
          </Field>
        </div>
      )}

      {form.transportKind !== 'native_messaging' && (
        <HeaderEditor
          headers={form.headers}
          secrets={form.secrets}
          onHeadersChange={(headers) => update('headers', headers)}
          onSecretsChange={(secrets) => update('secrets', secrets)}
        />
      )}

      <div className="grid grid-cols-3 gap-2">
        <NumberField label={t('sidepanel.mcpPage.form.connectMs')} value={form.connectMs} onChange={(value) => update('connectMs', value)} />
        <NumberField label={t('sidepanel.mcpPage.form.requestMs')} value={form.requestMs} onChange={(value) => update('requestMs', value)} />
        <NumberField label={t('sidepanel.mcpPage.form.discoveryMs')} value={form.discoveryMs} onChange={(value) => update('discoveryMs', value)} />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <NumberField label={t('sidepanel.mcpPage.form.resultBytes')} value={form.maxResultBytes} onChange={(value) => update('maxResultBytes', value)} />
        <NumberField label={t('sidepanel.mcpPage.form.toolLimit')} value={form.maxToolCount} onChange={(value) => update('maxToolCount', value)} />
      </div>

      <div className="ds-surface-panel rounded-lg p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium" style={{ color: 'var(--ds-text)' }}>{t('sidepanel.mcpPage.form.defaultExecution')}</span>
          <label className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--ds-text-secondary)' }}>
            <input
              type="checkbox"
              checked={form.executionEnabled}
              onChange={(event) => update('executionEnabled', event.target.checked)}
            />
            {t('sidepanel.mcpPage.form.allowInject')}
          </label>
        </div>
        <select
          value={form.executionMode}
          onChange={(event) => update('executionMode', event.target.value as ToolExecutionMode)}
          className="ds-input w-full rounded-lg px-3 py-2 text-sm"
        >
          <option value="auto">{t('sidepanel.mcpPage.form.modeAuto')}</option>
          <option value="manual">{t('sidepanel.mcpPage.form.modeManual')}</option>
          <option value="disabled">{t('sidepanel.mcpPage.form.modeDisabled')}</option>
        </select>
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onCancel} className="ds-btn-cancel px-3 py-1.5 text-xs rounded-lg transition-colors">
          {t('common.cancel')}
        </button>
        <button onClick={save} className="ds-btn-primary px-3 py-1.5 text-xs font-medium text-white rounded-lg transition-colors">
          {t('sidepanel.mcpPage.form.save')}
        </button>
      </div>
    </div>
  );
}

function HeaderEditor({
  headers,
  secrets,
  onHeadersChange,
  onSecretsChange,
}: {
  headers: McpHeaderValue[];
  secrets: McpSecretValue[];
  onHeadersChange: (headers: McpHeaderValue[]) => void;
  onSecretsChange: (secrets: McpSecretValue[]) => void;
}) {
  const { t } = useI18n();
  const updateHeader = (index: number, patch: Partial<McpHeaderValue>) => {
    onHeadersChange(headers.map((header, itemIndex) => itemIndex === index ? { ...header, ...patch } : header));
  };
  const updateSecret = (index: number, patch: Partial<McpSecretValue>) => {
    onSecretsChange(secrets.map((secret, itemIndex) => itemIndex === index ? { ...secret, ...patch } : secret));
  };

  return (
    <div className="ds-surface-panel rounded-lg p-3 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium" style={{ color: 'var(--ds-text)' }}>Headers</span>
        <button
          onClick={() => onHeadersChange([...headers, { name: '', value: '' }])}
          className="ds-btn-secondary px-2 py-1 text-[11px] rounded-md"
        >
          {t('common.add')}
        </button>
      </div>
      {headers.map((header, index) => (
        <div key={index} className="grid grid-cols-[1fr_1fr_auto] gap-1.5">
          <input
            value={header.name}
            onChange={(event) => updateHeader(index, { name: event.target.value })}
            className="ds-input min-w-0 rounded-lg px-2 py-1.5 text-xs"
            placeholder={t('sidepanel.mcpPage.headers.headerName')}
          />
          <input
            value={header.value}
            onChange={(event) => updateHeader(index, { value: event.target.value })}
            className="ds-input min-w-0 rounded-lg px-2 py-1.5 text-xs"
            placeholder={t('sidepanel.mcpPage.headers.headerValue')}
          />
          <button
            onClick={() => onHeadersChange(headers.filter((_, itemIndex) => itemIndex !== index))}
            className="ds-action-btn ds-action-btn-delete w-8 rounded-lg text-xs"
          >
            ×
          </button>
        </div>
      ))}

      <div className="flex items-center justify-between pt-1">
        <span className="text-xs font-medium" style={{ color: 'var(--ds-text)' }}>Secrets</span>
        <button
          onClick={() => onSecretsChange([...secrets, { id: crypto.randomUUID(), kind: 'bearer', value: '' }])}
          className="ds-btn-secondary px-2 py-1 text-[11px] rounded-md"
        >
          {t('common.add')}
        </button>
      </div>
      {secrets.map((secret, index) => (
        <div key={index} className="space-y-1.5">
          <div className="grid grid-cols-[90px_1fr_auto] gap-1.5">
            <select
              value={secret.kind}
              onChange={(event) => updateSecret(index, { kind: event.target.value as McpSecretValue['kind'] })}
              className="ds-input min-w-0 rounded-lg px-2 py-1.5 text-xs"
            >
              <option value="bearer">Bearer</option>
              <option value="basic">Basic</option>
              <option value="header">Header</option>
            </select>
            <input
              value={secret.value}
              onChange={(event) => updateSecret(index, { value: event.target.value })}
              className="ds-input min-w-0 rounded-lg px-2 py-1.5 text-xs"
              placeholder={t('sidepanel.mcpPage.headers.secretValue')}
              type="password"
            />
            <button
              onClick={() => onSecretsChange(secrets.filter((_, itemIndex) => itemIndex !== index))}
              className="ds-action-btn ds-action-btn-delete w-8 rounded-lg text-xs"
            >
              ×
            </button>
          </div>
          {secret.kind === 'header' && (
            <input
              value={secret.headerName ?? ''}
              onChange={(event) => updateSecret(index, { headerName: event.target.value })}
              className="ds-input w-full rounded-lg px-2 py-1.5 text-xs"
              placeholder={t('sidepanel.mcpPage.headers.secretHeaderName')}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function ServerRow({
  server,
  cache,
  selected,
  busy,
  onSelect,
  onToggle,
  onEdit,
  onDelete,
  onRefresh,
  onTest,
  t,
}: {
  server: McpServerConfig;
  cache: McpToolCacheEntry | null;
  selected: boolean;
  busy: BusyAction | null;
  onSelect: () => void;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onRefresh: () => void;
  onTest: () => void;
  t: Translator;
}) {
  const status = statusMeta(cache?.health.status ?? server.status, t);
  const activeTools = enabledToolCount(server, cache?.descriptors ?? []);

  return (
    <div
      className="ds-card rounded-lg p-3 cursor-pointer"
      style={{ borderColor: selected ? 'var(--ds-selected-border)' : undefined }}
      onClick={onSelect}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate" style={{ color: 'var(--ds-text)' }}>{server.displayName}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ color: status.color, background: status.bg }}>
              {status.label}
            </span>
          </div>
          <div className="text-[11px] mt-1 truncate" style={{ color: 'var(--ds-text-tertiary)' }}>
            {transportLabel(server.transport.kind)} · {t('sidepanel.mcpPage.row.autoTools', {
              active: activeTools,
              total: cache?.descriptors.length ?? 0,
            })}
          </div>
        </div>
        <label className="flex items-center gap-1 text-[11px]" style={{ color: 'var(--ds-text-secondary)' }} onClick={(event) => event.stopPropagation()}>
          <input type="checkbox" checked={server.enabled} onChange={onToggle} />
          {t('sidepanel.mcpPage.enabled')}
        </label>
      </div>
      <div className="flex items-center gap-1.5 mt-2" onClick={(event) => event.stopPropagation()}>
        <button onClick={onTest} className="ds-btn-secondary px-2 py-1 text-[11px] rounded-md" disabled={busy !== null}>
          {busy === 'test' ? t('sidepanel.mcpPage.row.testing') : t('common.test')}
        </button>
        <button onClick={onRefresh} className="ds-btn-secondary px-2 py-1 text-[11px] rounded-md" disabled={busy !== null}>
          {busy === 'refresh' ? t('sidepanel.toolsPage.pythonRefreshing') : t('sidepanel.mcpPage.row.refreshTools')}
        </button>
        <button onClick={onEdit} className="ds-action-btn ds-action-btn-edit px-2 py-1 text-[11px] rounded-md">
          {t('common.edit')}
        </button>
        <button onClick={onDelete} className="ds-action-btn ds-action-btn-delete px-2 py-1 text-[11px] rounded-md ml-auto">
          {t('common.delete')}
        </button>
      </div>
    </div>
  );
}

function ServerDetail({
  server,
  cache,
  history,
  busy,
  onPatch,
  onRequestPermission,
  onRefresh,
  onTest,
  onToggleTool,
  t,
  locale,
}: {
  server: McpServerConfig;
  cache: McpToolCacheEntry | null;
  history: ToolCallHistoryRecord[];
  busy: BusyAction | null;
  onPatch: (patch: Partial<McpServerConfig>) => Promise<void>;
  onRequestPermission: () => void;
  onRefresh: () => void;
  onTest: () => void;
  onToggleTool: (tool: ToolDescriptor) => void;
  t: Translator;
  locale: SupportedLocale;
}) {
  const tools = cache?.descriptors ?? [];
  const serverHistory = history.filter((record) => record.call.provider?.id === server.id).slice(0, 5);

  return (
    <div className="ds-surface-panel rounded-lg p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-medium truncate" style={{ color: 'var(--ds-text)' }}>{server.displayName}</div>
          <div className="text-[11px] mt-0.5 truncate" style={{ color: 'var(--ds-text-tertiary)' }}>{endpointLabel(server)}</div>
        </div>
        <div className="flex gap-1.5">
          {requiresOriginPermission(server) && (
            <button onClick={onRequestPermission} className="ds-btn-secondary px-2 py-1 text-[11px] rounded-md" disabled={busy !== null}>
              {t('sidepanel.mcpPage.detail.grant')}
            </button>
          )}
          <button onClick={onTest} className="ds-btn-secondary px-2 py-1 text-[11px] rounded-md" disabled={busy !== null}>
            {t('common.test')}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <Metric label={t('sidepanel.mcpPage.detail.status')} value={statusMeta(cache?.health.status ?? server.status, t).label} />
        <Metric label={t('sidepanel.mcpPage.detail.latency')} value={formatMs(cache?.health.latencyMs ?? null)} />
        <Metric label={t('sidepanel.mcpPage.detail.lastConnected')} value={formatTime(server.lastConnectedAt ?? cache?.health.checkedAt ?? null, locale)} />
        <Metric label={t('sidepanel.mcpPage.detail.transport')} value={transportLabel(server.transport.kind)} />
      </div>

      {(cache?.health.error || server.lastError) && (
        <div className="rounded-lg px-3 py-2 text-xs" style={{ color: 'var(--ds-danger)', background: 'var(--ds-danger-bg)', border: '1px solid var(--ds-danger-border)' }}>
          {cache?.health.error ?? server.lastError}
        </div>
      )}

      {isShellServer(server) && (
        <ShellSetupHint server={server} cache={cache} t={t} />
      )}

      <div className="ds-card rounded-lg p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium" style={{ color: 'var(--ds-text)' }}>{t('sidepanel.mcpPage.detail.executionPolicy')}</span>
          <label className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--ds-text-secondary)' }}>
            <input
              type="checkbox"
              checked={server.execution.enabled}
              onChange={(event) => onPatch({ execution: { ...server.execution, enabled: event.target.checked } })}
            />
            {t('sidepanel.mcpPage.form.allowInject')}
          </label>
        </div>
        <select
          value={server.execution.mode}
          onChange={(event) => onPatch({ execution: { ...server.execution, mode: event.target.value as ToolExecutionMode } })}
          className="ds-input w-full rounded-lg px-3 py-2 text-sm"
        >
          <option value="auto">{t('sidepanel.mcpPage.form.modeAuto')}</option>
          <option value="manual">{t('sidepanel.mcpPage.form.modeManual')}</option>
          <option value="disabled">{t('sidepanel.mcpPage.form.modeDisabled')}</option>
        </select>
        <div className="text-[11px]" style={{ color: 'var(--ds-text-tertiary)' }}>
          {t('sidepanel.mcpPage.detail.injectionSummary', { count: enabledToolCount(server, tools) })}
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium" style={{ color: 'var(--ds-text)' }}>{t('sidepanel.mcpPage.detail.discoveredTools')}</span>
          <button onClick={onRefresh} className="ds-btn-secondary px-2 py-1 text-[11px] rounded-md" disabled={busy !== null}>
            {busy === 'refresh' ? t('sidepanel.toolsPage.pythonRefreshing') : t('common.refresh')}
          </button>
        </div>
        {tools.length === 0 ? (
          <div className="text-xs py-6 text-center" style={{ color: 'var(--ds-text-tertiary)' }}>
            {t('sidepanel.mcpPage.detail.noTools')}
          </div>
        ) : (
          <div className="space-y-2">
            {tools.map((tool) => (
              <ToolRow key={tool.id} server={server} tool={tool} onToggle={() => onToggleTool(tool)} t={t} />
            ))}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <div className="text-xs font-medium" style={{ color: 'var(--ds-text)' }}>{t('sidepanel.mcpPage.detail.recentCalls')}</div>
        {serverHistory.length === 0 ? (
          <div className="text-xs py-3 text-center" style={{ color: 'var(--ds-text-tertiary)' }}>
            {t('sidepanel.mcpPage.detail.noHistory')}
          </div>
        ) : (
          <div className="space-y-1.5">
            {serverHistory.map((record) => (
              <div key={record.id} className="ds-card rounded-lg px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium truncate" style={{ color: 'var(--ds-text)' }}>
                    {record.call.name}
                  </span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ color: record.result.ok ? 'var(--ds-success)' : 'var(--ds-danger)', background: record.result.ok ? 'var(--ds-success-bg)' : 'var(--ds-danger-bg)' }}>
                    {record.result.ok ? t('sidepanel.mcpPage.success') : t('sidepanel.mcpPage.failure')}
                  </span>
                </div>
                <div className="text-[11px] mt-1 truncate" style={{ color: 'var(--ds-text-tertiary)' }}>
                  {formatTime(record.createdAt, locale)} · {record.result.summary}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ToolRow({
  server,
  tool,
  onToggle,
  t,
}: {
  server: McpServerConfig;
  tool: ToolDescriptor;
  onToggle: () => void;
  t: Translator;
}) {
  const enabled = isToolEnabled(server, tool);
  return (
    <div className="ds-card rounded-lg px-3 py-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs font-medium truncate" style={{ color: 'var(--ds-text)' }}>{tool.title || tool.name}</div>
          <div className="text-[11px] mt-0.5 truncate" style={{ color: 'var(--ds-blue)' }}>{tool.invocationName}</div>
        </div>
        <label className="flex items-center gap-1 text-[11px]" style={{ color: enabled ? 'var(--ds-success)' : 'var(--ds-text-tertiary)' }}>
          <input type="checkbox" checked={enabled} onChange={onToggle} />
          {enabled ? t('sidepanel.mcpPage.auto') : t('sidepanel.mcpPage.disabled')}
        </label>
      </div>
      <div className="text-[11px] mt-1 leading-4" style={{ color: 'var(--ds-text-secondary)' }}>
        {tool.description}
      </div>
      <div className="text-[10px] mt-2 truncate" style={{ color: 'var(--ds-text-tertiary)' }}>
        {schemaSummary(tool, t)}
      </div>
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-3">
      <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background: 'var(--ds-surface)' }}>
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} style={{ color: 'var(--ds-text-tertiary)' }}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 10.5h3a3 3 0 110 6h-3m-3-6h-3a3 3 0 100 6h3m-1.5-3h6" />
        </svg>
      </div>
      <p className="text-sm" style={{ color: 'var(--ds-text-tertiary)' }}>{label}</p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs mb-1" style={{ color: 'var(--ds-text-secondary)' }}>{label}</span>
      {children}
    </label>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <Field label={label}>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="ds-input w-full rounded-lg px-2 py-1.5 text-xs"
        inputMode="numeric"
      />
    </Field>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg px-3 py-2" style={{ background: 'var(--ds-bg)', border: '1px solid var(--ds-border)' }}>
      <div style={{ color: 'var(--ds-text-tertiary)' }}>{label}</div>
      <div className="mt-0.5 truncate" style={{ color: 'var(--ds-text)' }}>{value}</div>
    </div>
  );
}

function formFromServer(server: McpServerConfig): FormState {
  return {
    displayName: server.displayName,
    enabled: server.enabled,
    transportKind: server.transport.kind,
    url: server.transport.url ?? '',
    nativeHost: server.transport.nativeHost ?? '',
    command: server.transport.command ?? '',
    args: server.transport.args?.join(' ') ?? '',
    cwd: server.transport.cwd ?? '',
    env: Object.entries(server.transport.env ?? {}).map(([key, value]) => `${key}=${value}`).join('\n'),
    headers: server.headers.length > 0 ? server.headers : [],
    secrets: server.secrets.length > 0 ? server.secrets : [],
    connectMs: String(server.timeouts.connectMs),
    requestMs: String(server.timeouts.requestMs),
    discoveryMs: String(server.timeouts.discoveryMs),
    maxResultBytes: String(server.limits.maxResultBytes),
    maxToolCount: String(server.limits.maxToolCount),
    executionEnabled: server.execution.enabled,
    executionMode: server.execution.mode,
  };
}

function payloadFromForm(
  form: FormState,
  t: Translator,
  platform: PlatformEnvironment | null,
): { payload: McpServerCreateInput } | { error: string } {
  const displayName = form.displayName.trim();
  if (!displayName) return { error: t('sidepanel.mcpPage.validation.nameRequired') };

  const timeouts = {
    connectMs: positiveInt(form.connectMs, t('sidepanel.mcpPage.form.connectMs'), t),
    requestMs: positiveInt(form.requestMs, t('sidepanel.mcpPage.form.requestMs'), t),
    discoveryMs: positiveInt(form.discoveryMs, t('sidepanel.mcpPage.form.discoveryMs'), t),
  };
  const limits = {
    maxResultBytes: positiveInt(form.maxResultBytes, t('sidepanel.mcpPage.form.resultBytes'), t),
    maxToolCount: positiveInt(form.maxToolCount, t('sidepanel.mcpPage.form.toolLimit'), t),
  };
  const invalidNumber = Object.values(timeouts).find((value) => typeof value === 'string') ||
    Object.values(limits).find((value) => typeof value === 'string');
  if (typeof invalidNumber === 'string') return { error: invalidNumber };

  const transportResult = transportFromForm(form, t, platform);
  if ('error' in transportResult) return transportResult;

  const headersResult = normalizeHeaders(form.headers, t);
  if ('error' in headersResult) return headersResult;

  const secretsResult = normalizeSecrets(form.secrets, t);
  if ('error' in secretsResult) return secretsResult;

  return {
    payload: {
      displayName,
      enabled: form.enabled,
      transport: transportResult.transport,
      headers: headersResult.headers,
      secrets: secretsResult.secrets,
      timeouts: timeouts as { connectMs: number; requestMs: number; discoveryMs: number },
      limits: limits as { maxResultBytes: number; maxToolCount: number },
      allowlist: {
        mode: 'all',
        toolNames: [],
      },
      execution: {
        enabled: form.executionEnabled,
        mode: form.executionMode,
      },
    },
  };
}

function transportFromForm(
  form: FormState,
  t: Translator,
  platform: PlatformEnvironment | null,
): { transport: McpServerTransportConfig } | { error: string } {
  if (form.transportKind === 'native_messaging') {
    if (!isShellNativeHostSupported(platform)) {
      return { error: t('sidepanel.mcpPage.messages.nativeMessagingUnsupported') };
    }
    const nativeHost = form.nativeHost.trim();
    if (!nativeHost) return { error: t('sidepanel.mcpPage.validation.nativeHostRequired') };
    if (!/^[A-Za-z0-9_.-]+$/.test(nativeHost)) return { error: t('sidepanel.mcpPage.validation.nativeHostInvalid') };
    return { transport: { kind: 'native_messaging', nativeHost } };
  }

  const url = form.url.trim();
  if (!url) return { error: t('sidepanel.mcpPage.validation.serviceUrlRequired') };
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { error: t('sidepanel.mcpPage.validation.serviceUrlUnsupported') };
  } catch {
    return { error: t('sidepanel.mcpPage.validation.serviceUrlInvalid') };
  }

  if (form.transportKind !== 'stdio_bridge') {
    return { transport: { kind: form.transportKind, url } };
  }

  const env = parseEnv(form.env, t);
  if ('error' in env) return env;
  const command = form.command.trim();
  if (!command) return { error: t('sidepanel.mcpPage.validation.stdioCommandRequired') };
  return {
    transport: {
      kind: 'stdio_bridge',
      url,
      command,
      args: form.args.split(/\s+/).map((item) => item.trim()).filter(Boolean),
      cwd: form.cwd.trim(),
      env: env.env,
    },
  };
}

function normalizeHeaders(headers: McpHeaderValue[], t: Translator): { headers: McpHeaderValue[] } | { error: string } {
  const normalized: McpHeaderValue[] = [];
  for (const header of headers) {
    const name = header.name.trim();
    const value = header.value;
    if (!name && !value) continue;
    if (!isHeaderName(name)) {
      return {
        error: t('sidepanel.mcpPage.validation.headerInvalidName', {
          name: name || t('sidepanel.mcpPage.validation.emptyValue'),
        }),
      };
    }
    if (value.includes('\n') || value.includes('\r')) {
      return { error: t('sidepanel.mcpPage.validation.headerInvalidValue', { name }) };
    }
    normalized.push({ name, value });
  }
  return { headers: normalized };
}

function normalizeSecrets(secrets: McpSecretValue[], t: Translator): { secrets: McpSecretValue[] } | { error: string } {
  const normalized: McpSecretValue[] = [];
  for (const secret of secrets) {
    const value = secret.value.trim();
    const headerName = secret.headerName?.trim();
    if (!value && !headerName && !secret.username) continue;
    if (secret.kind === 'header' && !isHeaderName(headerName ?? '')) {
      return { error: t('sidepanel.mcpPage.validation.headerSecretRequired') };
    }
    normalized.push({
      id: secret.id || crypto.randomUUID(),
      kind: secret.kind,
      value,
      headerName,
      username: secret.username?.trim(),
    });
  }
  return { secrets: normalized };
}

function parseEnv(value: string, t: Translator): { env: Record<string, string> } | { error: string } {
  const env: Record<string, string> = {};
  for (const rawLine of value.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const index = line.indexOf('=');
    if (index <= 0) return { error: t('sidepanel.mcpPage.validation.envInvalid', { line }) };
    env[line.slice(0, index)] = line.slice(index + 1);
  }
  return { env };
}

function positiveInt(value: string, label: string, t: Translator): number | string {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return t('sidepanel.mcpPage.validation.positiveInteger', { label });
  }
  return parsed;
}

function isHeaderName(value: string): boolean {
  return /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(value);
}

function requiresOriginPermission(server: McpServerConfig): boolean {
  return server.transport.kind !== 'native_messaging' && Boolean(server.transport.url);
}

async function requestMcpOriginPermission(server: McpServerConfig): Promise<{
  ok: boolean;
  origin: string | null;
  error?: string;
}> {
  if (!requiresOriginPermission(server)) return { ok: true, origin: null };
  try {
    const origin = getOriginPattern(server.transport.url ?? '');
    if (!chrome.permissions?.contains || !chrome.permissions?.request) return { ok: true, origin };
    const granted = await chrome.permissions.contains({ origins: [origin] }).catch(() => false);
    if (granted) return { ok: true, origin };
    const ok = await chrome.permissions.request({ origins: [origin] }).catch(() => false);
    return { ok, origin };
  } catch (err) {
    return { ok: false, origin: null, error: err instanceof Error ? err.message : String(err) };
  }
}

function getOriginPattern(url: string): string {
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Service URL only supports http/https');
  }
  return `${parsed.protocol}//${parsed.host}/*`;
}

function enabledToolCount(server: McpServerConfig, tools: ToolDescriptor[]): number {
  return tools.filter((tool) => isToolEnabled(server, tool)).length;
}

function isToolEnabled(server: McpServerConfig, tool: ToolDescriptor): boolean {
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
  const preferredName = tool.name;
  const removeTool = () => {
    names.delete(tool.name);
    names.delete(tool.invocationName);
  };

  if (allowlist.mode === 'allow') {
    if (shouldEnable) names.add(preferredName);
    else removeTool();
    return { mode: 'allow', toolNames: [...names] };
  }

  if (allowlist.mode === 'deny') {
    if (shouldEnable) removeTool();
    else names.add(preferredName);
    return { mode: names.size === 0 ? 'all' : 'deny', toolNames: [...names] };
  }

  if (!shouldEnable) {
    return { mode: 'deny', toolNames: [preferredName] };
  }
  return allowlist;
}

function schemaSummary(tool: ToolDescriptor, t: Translator): string {
  const props = Object.keys(tool.inputSchema.properties ?? {});
  const required = tool.inputSchema.required ?? [];
  if (props.length === 0) return t('sidepanel.mcpPage.detail.schemaNone');
  return t('sidepanel.mcpPage.detail.schemaSummary', {
    props: `${props.slice(0, 6).join(', ')}${props.length > 6 ? '...' : ''}`,
    required: required.length
      ? t('sidepanel.mcpPage.detail.schemaRequired', { required: required.join(', ') })
      : '',
  });
}

function statusMeta(status: McpServerStatus, t: Translator) {
  if (status === 'ready') return { label: t('sidepanel.mcpPage.status.ready'), color: 'var(--ds-success)', bg: 'var(--ds-success-bg)' };
  if (status === 'error') return { label: t('sidepanel.mcpPage.status.error'), color: 'var(--ds-danger)', bg: 'var(--ds-danger-bg)' };
  if (status === 'disabled') return { label: t('sidepanel.mcpPage.status.disabled'), color: 'var(--ds-text-tertiary)', bg: 'var(--ds-surface)' };
  return { label: t('sidepanel.mcpPage.status.unknown'), color: 'var(--ds-text-secondary)', bg: 'var(--ds-surface)' };
}

function isShellServer(server: McpServerConfig): boolean {
  return server.displayName === SHELL_MCP_SERVER_NAME ||
    server.transport.nativeHost === SHELL_MCP_NATIVE_HOST ||
    server.transport.nativeHost === DEPRECATED_SHELL_MCP_NATIVE_HOST;
}

function ShellSetupHint({
  server,
  cache,
  t,
}: {
  server: McpServerConfig;
  cache: McpToolCacheEntry | null;
  t: Translator;
}) {
  const { message, isError } = shellSetupMessage(server, cache, t);
  const setup = shellInstallCommand();
  return (
    <div className="ds-card rounded-lg px-3 py-2 text-[11px] leading-4" style={{ color: 'var(--ds-text-secondary)' }}>
      <div className="font-medium mb-1" style={{ color: 'var(--ds-text)' }}>Shell Native Host</div>
      {isError ? (
        <div className="rounded px-2 py-1 mb-1.5" style={{ color: 'var(--ds-danger)', background: 'var(--ds-danger-bg)', border: '1px solid var(--ds-danger)' }}>
          {message}
        </div>
      ) : (
        <div>{message}</div>
      )}
      <div className="mt-1" style={{ color: 'var(--ds-text-tertiary)' }}>
        {setup.mode === 'local'
          ? t('sidepanel.mcpPage.shellSetup.localIntro')
          : t('sidepanel.mcpPage.shellSetup.publishedIntro')}
      </div>
      <div className="mt-1 font-mono break-all select-all rounded px-2 py-1" style={{ color: 'var(--ds-text)', background: 'var(--ds-surface)' }}>
        {setup.command}
      </div>
      {setup.fallbackCommand && (
        <>
          <div className="mt-1" style={{ color: 'var(--ds-text-tertiary)' }}>
            {t('sidepanel.mcpPage.shellSetup.fallbackIntro')}
          </div>
          <div className="mt-1 font-mono break-all select-all rounded px-2 py-1" style={{ color: 'var(--ds-text)', background: 'var(--ds-surface)' }}>
            {setup.fallbackCommand}
          </div>
        </>
      )}
      <div className="mt-1" style={{ color: 'var(--ds-text-tertiary)' }}>
        {setup.usesExtensionId
          ? t('sidepanel.mcpPage.shellSetup.detectedExtensionId', { browser: browserLabel(setup.browser) })
          : t('sidepanel.mcpPage.shellSetup.firefoxFixedId')}
      </div>
      <div className="mt-1" style={{ color: 'var(--ds-text-tertiary)' }}>
        {t('sidepanel.mcpPage.shellSetup.installNote')}
      </div>
      <div className="mt-1" style={{ color: 'var(--ds-text-tertiary)' }}>
        {!server.enabled
          ? t('sidepanel.mcpPage.shellSetup.enableAndTest')
          : t('sidepanel.mcpPage.shellSetup.restartAndTest')}
      </div>
    </div>
  );
}

type NativeHostBrowser = 'chrome' | 'chromium' | 'edge' | 'firefox';

function shellInstallCommand(): {
  browser: NativeHostBrowser;
  command: string;
  fallbackCommand?: string;
  usesExtensionId: boolean;
  mode: 'local' | 'published';
} {
  const browser = currentNativeHostBrowser();
  const usesExtensionId = browser !== 'firefox';
  const extensionArg = usesExtensionId ? ` --extension-id ${chrome.runtime.id || '<extension-id>'}` : '';
  const installArgs = `install --browser ${browser}${extensionArg} --skip-officecli`;
  const localCommand = `npm run shell:install -- ${installArgs}`;
  const publishedCommand = `npx doubao-wplus-shell-host ${installArgs}`;

  if (isUnpackedExtension()) {
    return { browser, command: localCommand, fallbackCommand: publishedCommand, usesExtensionId, mode: 'local' };
  }

  return { browser, command: publishedCommand, usesExtensionId, mode: 'published' };
}

function isUnpackedExtension(): boolean {
  return !chrome.runtime.getManifest().update_url;
}

function currentNativeHostBrowser(): NativeHostBrowser {
  const ua = navigator.userAgent;
  if (/\bFirefox\//.test(ua)) return 'firefox';
  if (/\bEdg\//.test(ua)) return 'edge';
  if (/\bChromium\//.test(ua) && !/\bChrome\//.test(ua)) return 'chromium';
  return 'chrome';
}

function browserLabel(browser: NativeHostBrowser): string {
  if (browser === 'edge') return 'Edge';
  if (browser === 'firefox') return 'Firefox';
  if (browser === 'chromium') return 'Chromium';
  return 'Chrome';
}

function shellSetupMessage(
  server: McpServerConfig,
  cache: McpToolCacheEntry | null,
  t: Translator,
): { message: string; isError: boolean } {
  const error = `${cache?.health.error ?? ''} ${server.lastError ?? ''}`.toLowerCase();
  if (error.includes('forbidden')) {
    return { message: t('sidepanel.mcpPage.shellSetup.forbidden'), isError: true };
  }
  if (error.includes('native_host_unavailable') || error.includes('native messaging host not found') || error.includes('not found') || error.includes('specified native messaging host')) {
    return { message: t('sidepanel.mcpPage.shellSetup.notFound'), isError: true };
  }
  if (error.includes('native_messaging_unavailable')) {
    return { message: t('sidepanel.mcpPage.shellSetup.unavailable'), isError: true };
  }
  if (
    error.includes('failed to fetch') ||
    error.includes('mcp_network_error') ||
    error.includes('cannot reach') ||
    error.includes('connection refused')
  ) {
    return { message: t('sidepanel.mcpPage.shellSetup.cannotConnect'), isError: true };
  }
  if (cache?.health.status === 'ready') {
    return { message: t('sidepanel.mcpPage.shellSetup.ready', { count: cache.health.toolCount }), isError: false };
  }
  if (!server.enabled) {
    return { message: t('sidepanel.mcpPage.shellSetup.disabled'), isError: false };
  }
  return { message: t('sidepanel.mcpPage.shellSetup.installFirst'), isError: false };
}

function transportLabel(kind: McpTransportKind): string {
  return TRANSPORT_OPTIONS.find((item) => item.kind === kind)?.label ?? kind;
}

function endpointLabel(server: McpServerConfig): string {
  if (server.transport.kind === 'native_messaging') return server.transport.nativeHost || 'Native Messaging';
  if (server.transport.kind === 'stdio_bridge') return `${server.transport.url || 'Bridge URL'} · ${server.transport.command || 'command'}`;
  return server.transport.url || transportLabel(server.transport.kind);
}

function formatMs(value: number | null | undefined): string {
  return typeof value === 'number' ? `${value} ms` : '-';
}

function formatTime(value: number | null | undefined, locale?: SupportedLocale): string {
  if (!value) return '-';
  return new Date(value).toLocaleString(locale);
}
