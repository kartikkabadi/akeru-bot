import { create } from "zustand";

import type { RosterLastMessage } from "./roster.logic";
import type { Bot, BotAvatar, Group } from "./types";

const PERSISTED_ROSTER_KEY = "akeru:roster:v1";

interface PersistedRoster {
  selectedBotId?: string;
  chatPathByBotId?: Record<string, string>;
  botLayout?: Array<{ id: string; pinned: boolean }>;
  groupOrder?: string[];
}

function readPersistedRoster(): PersistedRoster | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PERSISTED_ROSTER_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { selectedBotId, chatPathByBotId, botLayout, groupOrder } = parsed as {
      selectedBotId?: unknown;
      chatPathByBotId?: unknown;
      botLayout?: unknown;
      groupOrder?: unknown;
    };
    return {
      ...(typeof selectedBotId === "string" ? { selectedBotId } : {}),
      ...(typeof chatPathByBotId === "object" && chatPathByBotId !== null
        ? { chatPathByBotId: chatPathByBotId as Record<string, string> }
        : {}),
      ...(Array.isArray(botLayout) &&
      botLayout.every(
        (entry) =>
          typeof entry === "object" &&
          entry !== null &&
          typeof (entry as { id?: unknown }).id === "string" &&
          typeof (entry as { pinned?: unknown }).pinned === "boolean",
      )
        ? { botLayout: botLayout as Array<{ id: string; pinned: boolean }> }
        : {}),
      ...(Array.isArray(groupOrder) && groupOrder.every((id) => typeof id === "string")
        ? { groupOrder }
        : {}),
    };
  } catch {
    return null;
  }
}

function persistRoster(roster: PersistedRoster): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PERSISTED_ROSTER_KEY, JSON.stringify(roster));
  } catch (error) {
    console.error("Could not persist bot roster.", error);
  }
}

interface RosterStore {
  bots: Bot[];
  groups: Group[];
  lastMessageByBotId: Record<string, RosterLastMessage>;
  selectedBotId: string | null;
  chatPathByBotId: Record<string, string>;
  selectBot: (botId: string) => void;
  moveGroup: (groupId: string, direction: "up" | "down") => void;
  setBotAvatar: (botId: string, avatar: BotAvatar) => boolean;
  moveBot: (activeBotId: string, overBotId: string | null, pinned: boolean) => void;
  commitBotLayout: (bots: Bot[]) => void;
  recordLastMessage: (botId: string, message: RosterLastMessage) => void;
  recordChatPath: (botId: string, path: string) => void;
  forgetChatPath: (botId: string) => void;
  replaceRoster: (input: {
    bots: Bot[];
    groups: Group[];
    lastMessageByBotId?: Record<string, RosterLastMessage>;
  }) => void;
}

function moveWithinPartition(bots: readonly Bot[], fromIndex: number, toIndex: number): Bot[] {
  const next = [...bots];
  const [moved] = next.splice(fromIndex, 1);
  if (!moved) return next;
  next.splice(toIndex, 0, moved);
  return next;
}

export function moveRosterBot(
  bots: readonly Bot[],
  activeBotId: string,
  overBotId: string | null,
  pinned: boolean,
): Bot[] | null {
  const active = bots.find((bot) => bot.id === activeBotId);
  const over = overBotId ? bots.find((bot) => bot.id === overBotId) : null;
  if (!active || active.archivedAt !== null) return null;
  if (over && (over.archivedAt !== null || over.pinned !== pinned)) return null;
  if (active.id === over?.id && active.pinned === pinned) return null;

  const pinnedBots = bots.filter((bot) => bot.pinned);
  const unpinnedBots = bots.filter((bot) => !bot.pinned);
  const source = active.pinned ? pinnedBots : unpinnedBots;
  const target = pinned ? pinnedBots : unpinnedBots;

  if (active.pinned === pinned) {
    const activeIndex = source.findIndex((bot) => bot.id === active.id);
    const overIndex = over ? source.findIndex((bot) => bot.id === over.id) : source.length - 1;
    if (activeIndex === overIndex || activeIndex < 0 || overIndex < 0) return null;
    const movedPartition = moveWithinPartition(source, activeIndex, overIndex);
    return pinned ? [...movedPartition, ...unpinnedBots] : [...pinnedBots, ...movedPartition];
  }

  const sourceWithoutActive = source.filter((bot) => bot.id !== active.id);
  const targetWithActive = [...target];
  const targetIndex = over
    ? targetWithActive.findIndex((bot) => bot.id === over.id)
    : target.length;
  if (targetIndex < 0) return null;
  targetWithActive.splice(targetIndex, 0, { ...active, pinned });
  return pinned
    ? [...targetWithActive, ...sourceWithoutActive]
    : [...sourceWithoutActive, ...targetWithActive];
}

function alignVisibleBotOrder(layout: readonly Bot[], orderedBotIds: readonly string[]): Bot[] {
  const botsById = new Map(layout.map((bot) => [bot.id, bot] as const));
  const orderedBots = orderedBotIds.flatMap((id) => {
    const bot = botsById.get(id);
    return bot ? [bot] : [];
  });
  const orderedIdSet = new Set(orderedBots.map((bot) => bot.id));
  let nextIndex = 0;
  return layout.map((bot) => (orderedIdSet.has(bot.id) ? (orderedBots[nextIndex++] ?? bot) : bot));
}

export function previewRosterDrag(
  layout: readonly Bot[],
  activeBotId: string,
  overId: string,
  orderedUnpinnedBotIds: readonly string[] = [],
): Bot[] | null {
  const orderedLayout =
    orderedUnpinnedBotIds.length > 0
      ? alignVisibleBotOrder(layout, orderedUnpinnedBotIds)
      : [...layout];
  if (overId === "pinned-zone") return moveRosterBot(orderedLayout, activeBotId, null, true);
  if (overId === "unpinned-zone") return moveRosterBot(orderedLayout, activeBotId, null, false);
  const activeBot = orderedLayout.find((bot) => bot.id === activeBotId);
  const overBot = orderedLayout.find((bot) => bot.id === overId);
  if (!activeBot || !overBot) return null;
  if (!overBot.pinned && activeBot.groupId !== overBot.groupId) return null;
  return moveRosterBot(orderedLayout, activeBotId, overBot.id, overBot.pinned);
}

export function resolveRosterDropTarget(
  activeBotId: string,
  hitTargetIds: readonly string[],
  fallbackTargetId: string | null,
): string | null {
  if (hitTargetIds[0] === activeBotId) return null;
  return hitTargetIds[0] ?? (fallbackTargetId === activeBotId ? null : fallbackTargetId);
}

export function advanceRosterDragTarget(
  lastOverId: string | null,
  activeBotId: string,
  overId: string | null,
): { lastOverId: string | null; previewTargetId: string | null } {
  if (!overId || overId === activeBotId) return { lastOverId: null, previewTargetId: null };
  if (overId === lastOverId) return { lastOverId, previewTargetId: null };
  return { lastOverId: overId, previewTargetId: overId };
}

function saveState(
  state: Pick<RosterStore, "bots" | "groups" | "selectedBotId" | "chatPathByBotId">,
) {
  persistRoster({
    ...(state.selectedBotId === null ? {} : { selectedBotId: state.selectedBotId }),
    chatPathByBotId: state.chatPathByBotId,
    botLayout: state.bots.map((bot) => ({ id: bot.id, pinned: bot.pinned })),
    groupOrder: state.groups.map((group) => group.id),
  });
}

const persisted = readPersistedRoster();

export const useRosterStore = create<RosterStore>((set, get) => ({
  bots: [],
  groups: [],
  lastMessageByBotId: {},
  selectedBotId: persisted?.selectedBotId ?? null,
  chatPathByBotId: persisted?.chatPathByBotId ?? {},

  selectBot: (botId) => {
    if (!get().bots.some((bot) => bot.id === botId && bot.archivedAt === null)) return;
    if (get().selectedBotId === botId) return;
    set({ selectedBotId: botId });
    saveState(get());
  },

  moveGroup: (groupId, direction) => {
    const groups = [...get().groups];
    const index = groups.findIndex((group) => group.id === groupId);
    const target = direction === "up" ? index - 1 : index + 1;
    if (index < 0 || target < 0 || target >= groups.length) return;
    const [group] = groups.splice(index, 1);
    if (!group) return;
    groups.splice(target, 0, group);
    set({ groups });
    saveState(get());
  },

  setBotAvatar: (botId, avatar) => {
    set((state) => ({
      bots: state.bots.map((bot) =>
        bot.id === botId ? { ...bot, avatar, updatedAt: new Date().toISOString() } : bot,
      ),
    }));
    saveState(get());
    return true;
  },

  moveBot: (activeBotId, overBotId, pinned) => {
    const current = get().bots;
    const bots = moveRosterBot(current, activeBotId, overBotId, pinned);
    if (!bots) return;
    const active = current.find((bot) => bot.id === activeBotId);
    const nextBots = bots.map((bot) =>
      bot.id === activeBotId && active?.pinned !== pinned
        ? { ...bot, updatedAt: new Date().toISOString() }
        : bot,
    );
    set({ bots: nextBots });
    saveState(get());
  },

  commitBotLayout: (bots) => {
    const current = get().bots;
    if (
      bots.length !== current.length ||
      new Set(bots.map((bot) => bot.id)).size !== bots.length ||
      bots.some((bot) => !current.some((candidate) => candidate.id === bot.id))
    ) {
      return;
    }
    const currentById = new Map(current.map((bot) => [bot.id, bot]));
    const committed = bots.map((bot) => {
      const previous = currentById.get(bot.id)!;
      return previous.pinned === bot.pinned
        ? previous
        : { ...previous, pinned: bot.pinned, updatedAt: new Date().toISOString() };
    });
    set({ bots: committed });
    saveState(get());
  },

  recordLastMessage: (botId, message) => {
    set((state) => ({ lastMessageByBotId: { ...state.lastMessageByBotId, [botId]: message } }));
  },

  recordChatPath: (botId, path) => {
    if (get().chatPathByBotId[botId] === path) return;
    set((state) => ({ chatPathByBotId: { ...state.chatPathByBotId, [botId]: path } }));
    saveState(get());
  },

  forgetChatPath: (botId) => {
    if (get().chatPathByBotId[botId] === undefined) return;
    const chatPathByBotId = { ...get().chatPathByBotId };
    delete chatPathByBotId[botId];
    set({ chatPathByBotId });
    saveState(get());
  },

  replaceRoster: (input) => {
    const currentLayout =
      get().bots.length > 0
        ? get().bots.map((bot) => ({ id: bot.id, pinned: bot.pinned }))
        : (persisted?.botLayout ?? []);
    const orderById = new Map(currentLayout.map((entry, index) => [entry.id, index] as const));
    const pinnedById = new Map(currentLayout.map((entry) => [entry.id, entry.pinned] as const));
    const bots = input.bots
      .map((bot) => ({ ...bot, pinned: pinnedById.get(bot.id) ?? false }))
      .sort(
        (left, right) =>
          (orderById.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
          (orderById.get(right.id) ?? Number.MAX_SAFE_INTEGER),
      );
    const currentGroupOrder =
      get().groups.length > 0
        ? get().groups.map((group) => group.id)
        : (persisted?.groupOrder ?? []);
    const groupOrderById = new Map(currentGroupOrder.map((id, index) => [id, index] as const));
    const groups = [...input.groups].sort(
      (left, right) =>
        (groupOrderById.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
        (groupOrderById.get(right.id) ?? Number.MAX_SAFE_INTEGER),
    );
    const botIds = new Set(bots.map((bot) => bot.id));
    const selectedBotId = bots.some(
      (bot) => bot.id === get().selectedBotId && bot.archivedAt === null,
    )
      ? get().selectedBotId
      : (bots.find((bot) => bot.archivedAt === null)?.id ?? null);
    const chatPathByBotId = Object.fromEntries(
      Object.entries(get().chatPathByBotId).filter(([botId]) => botIds.has(botId)),
    );
    const lastMessageByBotId = Object.fromEntries(
      Object.entries(input.lastMessageByBotId ?? get().lastMessageByBotId).filter(([botId]) =>
        botIds.has(botId),
      ),
    );
    set({
      bots,
      groups,
      selectedBotId,
      chatPathByBotId,
      lastMessageByBotId,
    });
    saveState(get());
  },
}));

export function useSelectedBot(): Bot | null {
  return useRosterStore((state) =>
    state.selectedBotId === null
      ? null
      : (state.bots.find((bot) => bot.id === state.selectedBotId) ?? null),
  );
}
