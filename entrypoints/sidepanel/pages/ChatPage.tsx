import { useEffect, useRef, useState } from 'react';
import {
  DEFAULT_OFFICIAL_API_CHAT_CONFIG,
  normalizeOfficialApiChatConfig,
  type OfficialApiChatConfig,
  type OfficialDoubaoModel,
  type OfficialDoubaoReasoningEffort,
  type OfficialDoubaoThinkingMode,
} from '../../../core/chat/official-api-config';
import type { ChatMessage as ChatMessageType } from '../../../core/types';
import ChatMessage from '../components/ChatMessage';
import { consumePendingText, onPendingText } from '../pending-text';
import { useI18n } from '../i18n';

type ChatProvider = 'official-api' | 'doubao-web' | null;

interface ChatAuthStatus {
  available?: boolean;
  provider?: ChatProvider;
  hasApiKey?: boolean;
  hasToken?: boolean;
}

interface ChatStreamMessage extends ChatAuthStatus {
  type: string;
  text?: string;
  reasoningText?: string;
  phase?: 'reasoning' | 'answer';
  done?: boolean;
  error?: string;
  payload?: {
    active: boolean;
    estimatedTokens: number;
    tokensPerSecond: number;
    elapsedMs: number;
    textLength: number;
  };
}

const MODEL_OPTIONS: Array<{ value: OfficialDoubaoModel; labelKey: 'sidepanel.chatPage.modelFlash' | 'sidepanel.chatPage.modelPro' }> = [
  { value: 'doubao-lite-32k', labelKey: 'sidepanel.chatPage.modelFlash' },
  { value: 'doubao-pro-32k', labelKey: 'sidepanel.chatPage.modelPro' },
];

const EFFORT_OPTIONS: Array<{ value: OfficialDoubaoReasoningEffort; labelKey: 'sidepanel.chatPage.effortHigh' | 'sidepanel.chatPage.effortMax' }> = [
  { value: 'high', labelKey: 'sidepanel.chatPage.effortHigh' },
  { value: 'max', labelKey: 'sidepanel.chatPage.effortMax' },
];

export default function ChatPage() {
  const { t } = useI18n();
  const [messages, setMessages] = useState<ChatMessageType[]>([]);
  const [inputText, setInputText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [authStatus, setAuthStatus] = useState<ChatAuthStatus | null>(null);
  const [chatConfig, setChatConfig] = useState<OfficialApiChatConfig>(DEFAULT_OFFICIAL_API_CHAT_CONFIG);
  const [error, setError] = useState<string | null>(null);
  const [tokenSpeed, setTokenSpeed] = useState(0);
  const [tokenSpeedActive, setTokenSpeedActive] = useState(false);
  const [estimatedTokens, setEstimatedTokens] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesRef = useRef<ChatMessageType[]>([]);

  const apiControlsEnabled = authStatus?.provider === 'official-api';

  function updateLastAssistant(update: (message: ChatMessageType) => ChatMessageType) {
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last?.role === 'assistant') {
        const next = [...prev.slice(0, -1), update(last)];
        messagesRef.current = next;
        return next;
      }
      const next = [...prev, update({ role: 'assistant', text: '' })];
      messagesRef.current = next;
      return next;
    });
  }

  function appendAssistantText(text: string) {
    updateLastAssistant((message) => ({
      ...message,
      text: message.text + text,
    }));
  }

  function appendAssistantReasoning(reasoningText: string) {
    updateLastAssistant((message) => ({
      ...message,
      reasoningText: `${message.reasoningText ?? ''}${reasoningText}`,
    }));
  }

  useEffect(() => {
    const text = consumePendingText();
    if (text) {
      setInputText(text);
      inputRef.current?.focus();
    }
    return onPendingText((pendingText) => {
      setInputText(pendingText);
      inputRef.current?.focus();
    });
  }, []);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    chrome.runtime.sendMessage({ type: 'GET_AUTH_STATUS' })
      .then((resp: ChatAuthStatus | undefined) => {
        setAuthStatus(normalizeAuthStatus(resp));
      })
      .catch(() => setAuthStatus({ available: false, provider: null, hasApiKey: false, hasToken: false }));

    chrome.runtime.sendMessage({ type: 'GET_OFFICIAL_API_CHAT_CONFIG' })
      .then((result) => setChatConfig(normalizeOfficialApiChatConfig(result)))
      .catch(() => setChatConfig(DEFAULT_OFFICIAL_API_CHAT_CONFIG));
  }, []);

  useEffect(() => {
    const handler = (msg: ChatStreamMessage) => {
      if (msg.type === 'CHAT_SET_INPUT_TEXT' && typeof msg.text === 'string') {
        setInputText(msg.text);
        inputRef.current?.focus();
        return;
      }

      if (msg.type === 'AUTH_STATUS_CHANGED') {
        setAuthStatus(normalizeAuthStatus(msg));
        return;
      }

      if (msg.type === 'RESPONSE_TOKEN_SPEED' && msg.payload) {
        const p = msg.payload as { active: boolean; estimatedTokens: number; tokensPerSecond: number };
        setTokenSpeedActive(p.active);
        setTokenSpeed(p.tokensPerSecond);
        setEstimatedTokens(p.estimatedTokens);
        return;
      }

      if (msg.type !== 'CHAT_STREAM_CHUNK') return;

      if (msg.error) {
        setError(msg.error);
        setIsStreaming(false);
        return;
      }

      if (msg.done) {
        setIsStreaming(false);
        return;
      }

      if (msg.reasoningText) {
        appendAssistantReasoning(msg.reasoningText);
      }

      if (msg.text) {
        appendAssistantText(msg.text);
      }
    };

    chrome.runtime.onMessage.addListener(handler);
    return () => chrome.runtime.onMessage.removeListener(handler);
  }, []);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages]);

  const saveChatConfig = async (patch: Partial<OfficialApiChatConfig>) => {
    const next = normalizeOfficialApiChatConfig({ ...chatConfig, ...patch });
    setChatConfig(next);
    try {
      const saved = await chrome.runtime.sendMessage({ type: 'SAVE_OFFICIAL_API_CHAT_CONFIG', payload: next });
      setChatConfig(normalizeOfficialApiChatConfig(saved));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const sendMessage = () => {
    const text = inputText.trim();
    if (!text || isStreaming) return;

    setMessages((prev) => {
      const next = [...prev, { role: 'user' as const, text }];
      messagesRef.current = next;
      return next;
    });
    setInputText('');
    setIsStreaming(true);
    setError(null);

    chrome.runtime.sendMessage({
      type: 'CHAT_SUBMIT_PROMPT',
      payload: {
        text,
        ...(apiControlsEnabled ? { config: chatConfig } : {}),
      },
    }).catch((err: Error) => {
      setError(err.message);
      setIsStreaming(false);
    });
  };

  const newSession = () => {
    chrome.runtime.sendMessage({ type: 'CHAT_NEW_SESSION' }).catch(() => {});
    messagesRef.current = [];
    setMessages([]);
    setError(null);
    setIsStreaming(false);
    inputRef.current?.focus();
  };

  const handleModelChange = (model: OfficialDoubaoModel) => {
    if (!apiControlsEnabled || isStreaming) return;
    void saveChatConfig({ model });
  };

  const handleThinkingChange = (thinking: OfficialDoubaoThinkingMode) => {
    if (!apiControlsEnabled || isStreaming) return;
    void saveChatConfig({ thinking });
  };

  const handleEffortChange = (reasoningEffort: OfficialDoubaoReasoningEffort) => {
    if (!apiControlsEnabled || isStreaming || chatConfig.thinking !== 'enabled') return;
    void saveChatConfig({ reasoningEffort });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  if (authStatus?.available === false) {
    return (
      <div className="ds-chat-auth-empty">
        <p className="text-sm mb-3" style={{ color: 'var(--ds-text-secondary)' }}>
          {t('sidepanel.chatPage.authRequired')}
        </p>
        <p className="text-xs" style={{ color: 'var(--ds-text-tertiary)' }}>
          {t('sidepanel.chatPage.authHint')}
        </p>
      </div>
    );
  }

  return (
    <div className="ds-chat-page">
      <header className="ds-chat-header">
        <div className="ds-chat-header-top">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold" style={{ color: 'var(--ds-text)' }}>
                {t('sidepanel.chatPage.title')}
              </span>
              <ProviderBadge provider={authStatus?.provider ?? null} />
            </div>
            <p className="ds-chat-subtitle">
              {apiControlsEnabled
                ? t('sidepanel.chatPage.apiDescription')
                : t('sidepanel.chatPage.webDescription')}
            </p>
          </div>

          <div className="ds-chat-header-actions">
            <button
              type="button"
              onClick={newSession}
              className="ds-chat-icon-button"
              title={t('sidepanel.chatPage.newSessionTitle')}
              aria-label={t('sidepanel.chatPage.newSessionTitle')}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12h14" />
              </svg>
            </button>
          </div>
        </div>

        {apiControlsEnabled && (
          <div className="ds-chat-config-panel">
            <div className="ds-chat-control-group" aria-label={t('sidepanel.chatPage.modelLabel')}>
              {MODEL_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  disabled={isStreaming}
                  onClick={() => handleModelChange(option.value)}
                  className={`ds-chat-segment${chatConfig.model === option.value ? ' ds-chat-segment-active' : ''}`}
                >
                  {t(option.labelKey)}
                </button>
              ))}
            </div>

            <div className="ds-chat-control-row">
              <div className="ds-chat-control-group" aria-label={t('sidepanel.chatPage.thinkingLabel')}>
                <button
                  type="button"
                  disabled={isStreaming}
                  onClick={() => handleThinkingChange('disabled')}
                  className={`ds-chat-segment${chatConfig.thinking === 'disabled' ? ' ds-chat-segment-active' : ''}`}
                >
                  {t('sidepanel.chatPage.thinkingOff')}
                </button>
                <button
                  type="button"
                  disabled={isStreaming}
                  onClick={() => handleThinkingChange('enabled')}
                  className={`ds-chat-segment${chatConfig.thinking === 'enabled' ? ' ds-chat-segment-active' : ''}`}
                >
                  {t('sidepanel.chatPage.thinkingOn')}
                </button>
              </div>

              <select
                value={chatConfig.reasoningEffort}
                disabled={isStreaming || chatConfig.thinking !== 'enabled'}
                onChange={(e) => handleEffortChange(e.target.value as OfficialDoubaoReasoningEffort)}
                className="ds-chat-effort-select"
                title={t('sidepanel.chatPage.effortLabel')}
                aria-label={t('sidepanel.chatPage.effortLabel')}
              >
                {EFFORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {t(option.labelKey)}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
      </header>

      <div ref={listRef} className="ds-chat-messages">
        {messages.length === 0 && !isStreaming && (
          <div className="ds-chat-empty">
            <div className="ds-empty-state-icon">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <div className="ds-empty-state-title">{t('sidepanel.chatPage.empty')}</div>
            <div className="ds-empty-state-description">{t('sidepanel.chatPage.emptyHelp')}</div>
          </div>
        )}

        {messages.map((msg, index) => (
          <ChatMessage
            key={index}
            message={msg}
            isStreaming={isStreaming && index === messages.length - 1 && msg.role === 'assistant'}
          />
        ))}

        {error && (
          <div className="ds-chat-error">{error}</div>
        )}
      </div>

      <footer className="ds-chat-composer-wrap">
        <div className="ds-chat-composer">
          <textarea
            ref={inputRef}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('sidepanel.chatPage.inputPlaceholder')}
            rows={1}
            className="ds-chat-input"
          />
          <div className="ds-chat-composer-actions">
            <span className="ds-chat-current-config">
              {apiControlsEnabled
                ? getConfigLabel(chatConfig, t)
                : t('sidepanel.chatPage.webProvider')}
            </span>
            {apiControlsEnabled && (tokenSpeed > 0 || tokenSpeedActive) && (
              <span
                className={`ds-chat-token-speed${tokenSpeedActive ? '' : ' ds-chat-token-speed-idle'}`}
                title={t('sidepanel.chatPage.tokenSpeedTitle', {
                  speed: tokenSpeed >= 100 ? Math.round(tokenSpeed) : tokenSpeed.toFixed(1),
                  tokens: estimatedTokens,
                  idle: tokenSpeedActive ? '' : t('sidepanel.chatPage.tokenSpeedIdle'),
                })}
              >
                {tokenSpeed >= 100 ? `${Math.round(tokenSpeed)} tok/s` : `${tokenSpeed.toFixed(1)} tok/s`}
              </span>
            )}
            <div className="ds-chat-composer-buttons">
              <button
                type="button"
                onClick={sendMessage}
                disabled={isStreaming || !inputText.trim()}
                className="ds-chat-send-button"
                title={t('sidepanel.chatPage.send')}
                aria-label={t('sidepanel.chatPage.send')}
              >
                {isStreaming ? (
                  <span className="ds-chat-send-dots" aria-hidden="true">...</span>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 19V5m0 0-6 6m6-6 6 6" />
                  </svg>
                )}
              </button>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

function normalizeAuthStatus(resp: ChatAuthStatus | undefined): ChatAuthStatus {
  return {
    available: resp?.available ?? resp?.hasToken ?? false,
    provider: resp?.provider ?? (resp?.hasToken ? 'doubao-web' : null),
    hasApiKey: resp?.hasApiKey ?? false,
    hasToken: resp?.hasToken ?? false,
  };
}

function ProviderBadge({ provider }: { provider: ChatProvider }) {
  const { t } = useI18n();
  if (!provider) return null;
  const label = provider === 'official-api'
    ? t('sidepanel.chatPage.apiProvider')
    : t('sidepanel.chatPage.webProvider');
  return <span className="ds-chat-provider-badge">{label}</span>;
}

function getConfigLabel(
  config: OfficialApiChatConfig,
  t: ReturnType<typeof useI18n>['t'],
): string {
  const model = config.model === 'doubao-pro-32k'
    ? t('sidepanel.chatPage.modelPro')
    : t('sidepanel.chatPage.modelFlash');
  if (config.thinking !== 'enabled') {
    return `${model} · ${t('sidepanel.chatPage.thinkingOff')}`;
  }
  const effort = config.reasoningEffort === 'max'
    ? t('sidepanel.chatPage.effortMax')
    : t('sidepanel.chatPage.effortHigh');
  return `${model} · ${t('sidepanel.chatPage.thinkingOn')} · ${effort}`;
}
