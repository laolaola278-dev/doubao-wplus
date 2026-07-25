// entrypoints/sidepanel/studio/data-provider.tsx
// DWPlus Studio 统一状态管理 —— 只读数据缓存层。
//
// 设计约束（产品层整合，零业务逻辑改动）：
//   - 不新增任何统计/存储路径：全部走既有 background message。
//   - 不重复缓存：Provider 内单飞（in-flight 去重）+ 缓存；双入口
//     （Studio 内 / 资料→记忆）消费同一份缓存。
//   - 广播失效：STATE_UPDATED 携带 memories 时直接更新缓存（与
//     MemoryStudioPage 原有订阅语义一致），其余缓存按需失效。
//   - 向后兼容：组件不在 Provider 下时（既有测试直接 render 单页），
//     hook 退化为「无缓存直取」—— 行为与原页面自取数完全一致。

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Memory } from '../../../core/types';
import { createEmptyInsightsState, type InsightsState } from '../../../core/insights/types';

interface CacheSlot<T> {
  value: T | null;
  /** 单飞：并发请求合并到同一 Promise */
  inflight: Promise<T> | null;
}

interface StudioDataContextValue {
  getMemories(force?: boolean): Promise<Memory[]>;
  getInsightsState(force?: boolean): Promise<InsightsState>;
  /** 订阅 memories 缓存更新（STATE_UPDATED 广播推送） */
  subscribeMemories(listener: (memories: Memory[]) => void): () => void;
  /** 手动失效（如清空统计后） */
  invalidateInsights(): void;
}

const StudioDataContext = createContext<StudioDataContextValue | null>(null);

async function fetchMemories(): Promise<Memory[]> {
  const list: Memory[] | undefined = await chrome.runtime.sendMessage({ type: 'GET_MEMORIES' });
  return list ?? [];
}

async function fetchInsights(): Promise<InsightsState> {
  const state: InsightsState | undefined = await chrome.runtime.sendMessage({ type: 'GET_INSIGHTS_STATE' });
  return state ?? createEmptyInsightsState();
}

export function StudioDataProvider({ children }: { children: ReactNode }) {
  const memoriesRef = useRef<CacheSlot<Memory[]>>({ value: null, inflight: null });
  const insightsRef = useRef<CacheSlot<InsightsState>>({ value: null, inflight: null });
  const memoryListenersRef = useRef<Set<(memories: Memory[]) => void>>(new Set());

  // 单飞取数：缓存命中直接返回；in-flight 合并；否则发起并缓存
  const load = useCallback(<T,>(
    slot: { current: CacheSlot<T> },
    fetcher: () => Promise<T>,
    force: boolean,
  ): Promise<T> => {
    if (!force && slot.current.value !== null) return Promise.resolve(slot.current.value);
    if (slot.current.inflight) return slot.current.inflight;
    const promise = fetcher()
      .then((value) => {
        slot.current.value = value;
        return value;
      })
      .finally(() => {
        slot.current.inflight = null;
      });
    slot.current.inflight = promise;
    return promise;
  }, []);

  const getMemories = useCallback(
    (force = false) => load(memoriesRef, fetchMemories, force),
    [load],
  );
  const getInsightsState = useCallback(
    (force = false) => load(insightsRef, fetchInsights, force),
    [load],
  );

  const subscribeMemories = useCallback((listener: (memories: Memory[]) => void) => {
    memoryListenersRef.current.add(listener);
    return () => {
      memoryListenersRef.current.delete(listener);
    };
  }, []);

  const invalidateInsights = useCallback(() => {
    insightsRef.current.value = null;
  }, []);

  // STATE_UPDATED（background 既有广播）携带 memories：更新缓存并推送订阅者。
  // 与 MemoryStudioPage 原有 onMessage 订阅语义一致，只是收敛到一处。
  useEffect(() => {
    const handler = (message: { type?: string; memories?: Memory[] }) => {
      if (message.type === 'STATE_UPDATED' && Array.isArray(message.memories)) {
        memoriesRef.current.value = message.memories;
        for (const listener of memoryListenersRef.current) listener(message.memories);
      }
    };
    chrome.runtime.onMessage.addListener(handler);
    return () => chrome.runtime.onMessage.removeListener(handler);
  }, []);

  const value: StudioDataContextValue = {
    getMemories,
    getInsightsState,
    subscribeMemories,
    invalidateInsights,
  };

  return <StudioDataContext.Provider value={value}>{children}</StudioDataContext.Provider>;
}

// ============================================================
// 消费 hook（Provider 缺席时退化为直取 —— 既有单页测试零改动）
// ============================================================

/** memories 列表：缓存共享 + STATE_UPDATED 推送。返回 [list, reload] */
export function useStudioMemories(): [Memory[], () => Promise<void>] {
  const ctx = useContext(StudioDataContext);
  const [memories, setMemories] = useState<Memory[]>([]);

  const reload = useCallback(async () => {
    const list = ctx ? await ctx.getMemories(true) : await fetchMemories();
    setMemories(list);
  }, [ctx]);

  useEffect(() => {
    let cancelled = false;
    (ctx ? ctx.getMemories() : fetchMemories()).then((list) => {
      if (!cancelled) setMemories(list);
    });
    if (ctx) {
      const unsubscribe = ctx.subscribeMemories((next) => setMemories(next));
      return () => {
        cancelled = true;
        unsubscribe();
      };
    }
    // Provider 缺席：保持原页面行为，自行订阅 STATE_UPDATED
    const handler = (message: { type?: string; memories?: Memory[] }) => {
      if (message.type === 'STATE_UPDATED' && Array.isArray(message.memories)) {
        setMemories(message.memories);
      }
    };
    chrome.runtime.onMessage.addListener(handler);
    return () => {
      cancelled = true;
      chrome.runtime.onMessage.removeListener(handler);
    };
  }, [ctx]);

  return [memories, reload];
}

/** insights 日桶 state：缓存共享。返回 [state, reload] */
export function useStudioInsights(): [InsightsState, () => Promise<void>] {
  const ctx = useContext(StudioDataContext);
  const [state, setState] = useState<InsightsState>(createEmptyInsightsState());

  const reload = useCallback(async () => {
    if (ctx) ctx.invalidateInsights();
    const next = ctx ? await ctx.getInsightsState(true) : await fetchInsights();
    setState(next);
  }, [ctx]);

  useEffect(() => {
    let cancelled = false;
    (ctx ? ctx.getInsightsState() : fetchInsights()).then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, [ctx]);

  return [state, reload];
}
