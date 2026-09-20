// core/chat/doubao-web-relay.ts
// sidepanel 对话页 doubao-web 模式的后台侧转发：探测豆包宿主页可用性并转发网页补全请求。
// 依赖宿主页 content script → MAIN 世界桥（见 entrypoints/main-world.content.ts）。
// 签名策略见 core/chat/doubao-web.ts：复用页面真实补全请求的 URL，不逆向签名算法。

export const DOUBAO_WEB_CHAT_READY_MESSAGE = { type: 'DOUBAO_WEB_CHAT_READY' } as const;

export interface DoubaoWebChatSubmitPayload {
  prompt: string;
  conversationId: string | null;
  lastMessageIndex: number | null;
}

function sortByActiveFirst(tabs: chrome.tabs.Tab[]): chrome.tabs.Tab[] {
  return [...tabs].sort((a, b) => Number(b.active) - Number(a.active));
}

function withPreferredFirst(
  ordered: chrome.tabs.Tab[],
  preferredTabId?: number,
): chrome.tabs.Tab[] {
  if (preferredTabId == null) return ordered;
  const preferred = ordered.find((tab) => tab.id === preferredTabId);
  if (!preferred) return ordered;
  return [preferred, ...ordered.filter((tab) => tab.id !== preferredTabId)];
}

/**
 * 探测豆包宿主页是否具备网页会话直连条件。
 * readyRequestFactory 允许测试注入；生产环境为固定消息常量。
 */
export async function refreshDoubaoWebChatReady(deps: {
  queryTabs: (query: chrome.tabs.QueryInfo) => Promise<chrome.tabs.Tab[]>;
  sendTabMessage: (tabId: number, message: unknown) => Promise<unknown>;
  preferredTabId?: number;
}): Promise<boolean> {
  let doubaoTabs: chrome.tabs.Tab[] = [];
  try {
    doubaoTabs = await deps.queryTabs({ url: '*://*.doubao.com/*' });
  } catch {
    return false;
  }
  const ordered = withPreferredFirst(sortByActiveFirst(doubaoTabs), deps.preferredTabId);
  for (const tab of ordered) {
    if (!tab.id) continue;
    try {
      const response = await deps.sendTabMessage(tab.id, DOUBAO_WEB_CHAT_READY_MESSAGE);
      if ((response as { ready?: boolean } | undefined)?.ready === true) return true;
    } catch {
      // content script 未注入或桥未就绪 —— 试下一个 tab
    }
  }
  return false;
}

/** 向活跃豆包 tab 转发网页补全请求（流式结果由 content 直接广播，不经此函数） */
export async function submitDoubaoWebChat(deps: {
  queryTabs: (query: chrome.tabs.QueryInfo) => Promise<chrome.tabs.Tab[]>;
  sendTabMessage: (tabId: number, message: unknown) => Promise<unknown>;
  excludeTabId?: number;
}, payload: DoubaoWebChatSubmitPayload): Promise<boolean> {
  let doubaoTabs: chrome.tabs.Tab[] = [];
  try {
    doubaoTabs = await deps.queryTabs({ url: '*://*.doubao.com/*' });
  } catch {
    return false;
  }
  const ordered = sortByActiveFirst(doubaoTabs)
    .filter((tab) => tab.id != null && tab.id !== deps.excludeTabId);
  for (const tab of ordered) {
    if (!tab.id) continue;
    try {
      const response = await deps.sendTabMessage(tab.id, {
        type: 'DOUBAO_WEB_CHAT_SUBMIT',
        payload,
      });
      return (response as { ok?: boolean } | undefined)?.ok === true;
    } catch {
      // content script 未注入或桥未就绪 —— 试下一个 tab
    }
  }
  return false;
}
