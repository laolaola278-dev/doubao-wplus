// entrypoints/content/features/shared/bridge.ts
// Main-world <-> Isolated-world bridge (MessageChannel)

import { validateBridgeMessage } from '../../../../core/messaging/schema';

// ---- Protocol constants ----

export const MAIN_WORLD_SOURCE = 'dwplus-main';
export const CONTENT_SOURCE = 'dwplus-content';
export const BRIDGE_REQUEST_TYPE = 'DWPLUS_BRIDGE_REQUEST';
export const BRIDGE_INIT_TYPE = 'DWPLUS_BRIDGE_INIT';
export const BRIDGE_READY_TYPE = 'DWPLUS_BRIDGE_READY';

// backward compat: old brand — receive-only bridge aliases for installed older builds.
export const DEPRECATED_MAIN_WORLD_SOURCE = 'deepseek-pp-main';
export const DEPRECATED_CONTENT_SOURCE = 'deepseek-pp-content';
export const DEPRECATED_BRIDGE_REQUEST_TYPE = 'DPP_BRIDGE_REQUEST';
export const DEPRECATED_BRIDGE_INIT_TYPE = 'DPP_BRIDGE_INIT';
export const DEPRECATED_BRIDGE_READY_TYPE = 'DPP_BRIDGE_READY';

// ---- State ----

let mainWorldPort: MessagePort | null = null;
let mainWorldBridgeReady = false;
const pendingBridgeMessages: Record<string, unknown>[] = [];
let bridgeMessageHandler: ((data: any) => void | Promise<void>) | null = null;

// ---- Public API ----

export function setBridgeMessageHandler(handler: (data: any) => void | Promise<void>): void {
  bridgeMessageHandler = handler;
}

export function installBridge(): void {
  if (typeof console !== 'undefined' && console.info) {
    console.info('[DWPLUS-BRIDGE] installBridge() called, listening for main-world BRIDGE_REQUEST');
  }
  window.addEventListener('message', (event) => {
    if (event.origin !== window.location.origin) return;
    if (
      (event.data?.source !== MAIN_WORLD_SOURCE && event.data?.source !== DEPRECATED_MAIN_WORLD_SOURCE) ||
      (event.data.type !== BRIDGE_REQUEST_TYPE && event.data.type !== DEPRECATED_BRIDGE_REQUEST_TYPE)
    ) return;
    if (typeof console !== 'undefined' && console.info) {
      console.info('[DWPLUS-BRIDGE] Received BRIDGE_REQUEST from main world, connecting port...');
    }
    connectMainWorldPort();
  });
}

export function postToBridge(message: Record<string, unknown>): void {
  if (!mainWorldPort || !mainWorldBridgeReady) {
    if (typeof console !== 'undefined' && console.debug) {
      console.debug(`[DWPLUS-BRIDGE] Queuing message (port=${!!mainWorldPort}, ready=${mainWorldBridgeReady}): ${String(message.type)}`);
    }
    pendingBridgeMessages.push(message);
    return;
  }
  mainWorldPort.postMessage({ source: CONTENT_SOURCE, ...message });
}

export function getBridgeReady(): boolean {
  return mainWorldBridgeReady;
}

// ---- Internal ----

function connectMainWorldPort(): void {
  if (mainWorldPort) return;

  const channel = new MessageChannel();
  mainWorldPort = channel.port1;
  mainWorldPort.onmessage = (event) => {
    void handleBridgePortMessage(event.data);
  };
  mainWorldPort.start();

  if (typeof console !== 'undefined' && console.info) {
    console.info('[DWPLUS-BRIDGE] Sending BRIDGE_INIT to main world with MessageChannel port');
  }
  window.postMessage(
    { source: CONTENT_SOURCE, type: BRIDGE_INIT_TYPE },
    window.location.origin,
    [channel.port2],
  );
}

async function handleBridgePortMessage(data: any): Promise<void> {
  const message = validateBridgeMessage(data);
  if (!message) {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[DWPLUS-BRIDGE] Received invalid bridge message on port, dropping');
    }
    return;
  }
  if (message.source !== MAIN_WORLD_SOURCE && message.source !== DEPRECATED_MAIN_WORLD_SOURCE) return;

  if (message.type === BRIDGE_READY_TYPE) {
    mainWorldBridgeReady = true;
    if (typeof console !== 'undefined' && console.info) {
      console.info(`[DWPLUS-BRIDGE] Bridge READY! Flushing ${pendingBridgeMessages.length} pending messages`);
    }
    flushBridgeMessages();
    return;
  }

  await bridgeMessageHandler?.(message);
}

function flushBridgeMessages(): void {
  if (!mainWorldPort || !mainWorldBridgeReady) return;
  while (pendingBridgeMessages.length > 0) {
    const message = pendingBridgeMessages.shift()!;
    if (typeof console !== 'undefined' && console.info) {
      console.info(`[DWPLUS-BRIDGE] Flushing queued message: ${String(message.type)}`);
    }
    mainWorldPort.postMessage({ source: CONTENT_SOURCE, ...message });
  }
}
