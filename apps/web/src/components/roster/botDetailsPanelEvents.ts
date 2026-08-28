let pendingBotId: string | null = null;
const listenersByBotId = new Map<string, Set<() => void>>();

export function requestBotDetailsPanelOpen(botId: string): void {
  const listeners = listenersByBotId.get(botId);
  if (!listeners || listeners.size === 0) {
    pendingBotId = botId;
    return;
  }
  pendingBotId = null;
  for (const listener of listeners) listener();
}

export function subscribeToBotDetailsPanelOpen(botId: string, listener: () => void): () => void {
  const listeners = listenersByBotId.get(botId) ?? new Set<() => void>();
  listeners.add(listener);
  listenersByBotId.set(botId, listeners);

  if (pendingBotId === botId) {
    pendingBotId = null;
    listener();
  }

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) listenersByBotId.delete(botId);
  };
}
