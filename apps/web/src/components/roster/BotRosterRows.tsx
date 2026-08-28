import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import {
  memo,
  useMemo,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { useClientSettings } from "../../hooks/useSettings";
import { cn, isMacPlatform } from "../../lib/utils";
import { useThreadMessages, useThreadShells } from "../../state/entities";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { isContextMenuPointerDown } from "../Sidebar.logic";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { BotAvatarView } from "./BotAvatarView";
import { visibleBotChatMessages } from "./botConversationPresentation";
import { useBotPresence, useGroupPresence } from "./botPresence";
import { findLatestBotThreadTarget, findLatestGroupThreadTarget } from "./botThreadRuntime.logic";
import { isSilentGroupReply, stripGroupFanoutNote } from "./groupFanout";
import {
  formatRosterTimestamp,
  parseChatPath,
  resolveLatestRosterMessage,
  resolveRosterIndicator,
  type RosterLastMessage,
  type RosterPresence,
} from "./roster.logic";
import { useRosterStore } from "./rosterStore";
import type { Bot } from "./types";

function RosterAvatar({
  bot,
  presence,
  className,
  dotClassName,
}: {
  bot: Bot;
  presence: RosterPresence;
  className: string;
  dotClassName?: string;
}) {
  const indicator = resolveRosterIndicator(presence);
  return (
    <span className="relative shrink-0">
      <BotAvatarView avatar={bot.avatar} name={bot.name} state={presence} className={className} />
      {indicator !== null ? (
        <span
          data-testid="bot-presence-dot"
          data-status={indicator}
          className={cn(
            "absolute -bottom-px -right-px rounded-full ring-1 ring-sidebar",
            indicator === "working" ? "bg-success" : "bg-warning",
            dotClassName ?? "size-2",
          )}
        />
      ) : null}
    </span>
  );
}

function isContextMenuMouseEvent(event: ReactMouseEvent<HTMLElement>) {
  return isContextMenuPointerDown({
    button: event.button,
    ctrlKey: event.ctrlKey,
    isMac: isMacPlatform(navigator.platform),
  });
}

function openContextMenuFromKeyboard(event: ReactKeyboardEvent<HTMLElement>) {
  if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
  event.preventDefault();
  event.currentTarget.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
}

function stopContextMenuPointerDown(event: ReactPointerEvent<HTMLElement>) {
  if (
    isContextMenuPointerDown({
      button: event.button,
      ctrlKey: event.ctrlKey,
      isMac: isMacPlatform(navigator.platform),
    })
  ) {
    event.stopPropagation();
  }
}

export const BotStripTile = memo(function BotStripTile({
  bot,
  isActive,
  onSelect,
  onOpenMenu,
}: {
  bot: Bot;
  isActive: boolean;
  onSelect: (bot: Bot) => void;
  onOpenMenu: (event: ReactMouseEvent<HTMLElement>, bot: Bot) => void;
}) {
  const presence = useBotPresence(bot.id);
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: bot.id });
  return (
    <li
      ref={setNodeRef}
      data-roster-drop-id={bot.id}
      className={cn(
        "relative list-none touch-pan-y",
        isDragging && "pointer-events-none opacity-0",
      )}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...listeners}
    >
      <button
        type="button"
        data-testid="roster-strip-tile"
        data-bot-hover
        aria-current={isActive || undefined}
        aria-haspopup="menu"
        onClick={(event) => {
          if (!isContextMenuMouseEvent(event)) onSelect(bot);
        }}
        onKeyDown={openContextMenuFromKeyboard}
        onPointerDownCapture={stopContextMenuPointerDown}
        onDoubleClick={(event) => void onOpenMenu(event, bot)}
        onContextMenu={(event) => onOpenMenu(event, bot)}
        className={cn(
          "flex w-20 cursor-grab flex-col items-center gap-2 rounded-xl px-1 pb-2 pt-3 outline-none select-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing",
          isActive ? "bg-sidebar-row-active" : "bg-transparent hover:bg-sidebar-row-hover",
        )}
      >
        <RosterAvatar bot={bot} presence={presence} className="size-14" />
        <span className="w-full truncate text-center text-xs text-sidebar-foreground">
          {bot.name}
        </span>
      </button>
    </li>
  );
});

function useLatestBotMessage(
  botId: string,
  fallback: RosterLastMessage | null,
  working: boolean,
): RosterLastMessage | null {
  const rememberedPath = useRosterStore((state) => state.chatPathByBotId[botId]);
  const environmentId = usePrimaryEnvironmentId();
  const threadShells = useThreadShells();
  const threadRef = useMemo(() => {
    const durableTarget = environmentId
      ? findLatestBotThreadTarget(botId, environmentId, threadShells)
      : null;
    const target = durableTarget ?? (rememberedPath ? parseChatPath(rememberedPath) : null);
    return target
      ? scopeThreadRef(EnvironmentId.make(target.environmentId), ThreadId.make(target.threadId))
      : null;
  }, [botId, environmentId, rememberedPath, threadShells]);
  const messages = useThreadMessages(threadRef);
  const visibleMessages = useMemo(
    () => visibleBotChatMessages(messages, working),
    [messages, working],
  );
  return useMemo(
    () => resolveLatestRosterMessage(fallback, visibleMessages),
    [fallback, visibleMessages],
  );
}

function useLatestGroupMessage(groupId: string, working: boolean): RosterLastMessage | null {
  const environmentId = usePrimaryEnvironmentId();
  const threadShells = useThreadShells();
  const threadRef = useMemo(() => {
    const target = environmentId
      ? findLatestGroupThreadTarget(groupId, environmentId, threadShells)
      : null;
    return target
      ? scopeThreadRef(EnvironmentId.make(target.environmentId), ThreadId.make(target.threadId))
      : null;
  }, [environmentId, groupId, threadShells]);
  const messages = useThreadMessages(threadRef);
  return useMemo(() => {
    const last = visibleBotChatMessages(messages, working).findLast(
      (message) => message.role !== "assistant" || !isSilentGroupReply(message.text),
    );
    return last ? { text: stripGroupFanoutNote(last.text), at: last.createdAt } : null;
  }, [messages, working]);
}

export const GroupRosterRow = memo(function GroupRosterRow({
  id,
  name,
  members,
  isActive,
  onNavigate,
  onOpenMenu,
}: {
  id: string;
  name: string;
  members: ReadonlyArray<Bot>;
  isActive: boolean;
  onNavigate: (groupId: string) => void;
  onOpenMenu: (event: ReactMouseEvent<HTMLElement>, group: { id: string; name: string }) => void;
}) {
  const timestampFormat = useClientSettings((s) => s.timestampFormat);
  const presence = useGroupPresence(id);
  const latestMessage = useLatestGroupMessage(id, presence === "working");
  const indicator = resolveRosterIndicator(presence);
  return (
    <li className="list-none">
      <div
        data-testid="roster-group-row"
        className={cn(
          "flex w-full items-center rounded-lg outline-none select-none",
          isActive
            ? "bg-sidebar-row-active text-sidebar-foreground"
            : "bg-transparent text-sidebar-foreground hover:bg-sidebar-row-hover",
        )}
      >
        <button
          type="button"
          aria-current={isActive || undefined}
          aria-haspopup="menu"
          onClick={(event) => {
            if (!isContextMenuMouseEvent(event)) onNavigate(id);
          }}
          onKeyDown={openContextMenuFromKeyboard}
          onPointerDownCapture={stopContextMenuPointerDown}
          onContextMenu={(event) => onOpenMenu(event, { id, name })}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="relative flex size-10 shrink-0 items-center justify-center">
            <span className="flex -space-x-2.5">
              {members.slice(0, 2).map((bot) => (
                <BotAvatarView
                  key={bot.id}
                  avatar={bot.avatar}
                  name={bot.name}
                  className="size-7"
                />
              ))}
            </span>
            {indicator !== null ? (
              <span
                data-testid="group-presence-dot"
                data-status={indicator}
                className={cn(
                  "absolute -bottom-px -right-px size-2 rounded-full ring-1 ring-sidebar",
                  indicator === "working" ? "bg-success" : "bg-warning",
                )}
              />
            ) : null}
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="flex items-baseline gap-2">
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">{name}</span>
              {latestMessage ? (
                <span className="shrink-0 text-xs tabular-nums text-sidebar-muted-foreground">
                  {formatRosterTimestamp(latestMessage.at, timestampFormat)}
                </span>
              ) : null}
            </span>
            {latestMessage ? (
              <span className="truncate text-[13px] text-sidebar-muted-foreground">
                {latestMessage.text}
              </span>
            ) : (
              <span className="truncate text-[13px] text-sidebar-muted-foreground">
                {members.length} {members.length === 1 ? "member" : "members"}
              </span>
            )}
          </span>
        </button>
      </div>
    </li>
  );
});

export const BotRosterRow = memo(function BotRosterRow({
  bot,
  lastMessage,
  isActive,
  onSelect,
  onOpenMenu,
}: {
  bot: Bot;
  lastMessage: RosterLastMessage | null;
  isActive: boolean;
  onSelect: (bot: Bot) => void;
  onOpenMenu: (event: ReactMouseEvent<HTMLElement>, bot: Bot) => void;
}) {
  const timestampFormat = useClientSettings((s) => s.timestampFormat);
  const presence = useBotPresence(bot.id);
  const latestMessage = useLatestBotMessage(bot.id, lastMessage, presence === "working");
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: bot.id });
  return (
    <li
      ref={setNodeRef}
      data-roster-drop-id={bot.id}
      className={cn("list-none touch-pan-y", isDragging && "pointer-events-none opacity-0")}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...listeners}
    >
      <div
        data-testid="roster-bot-row"
        data-bot-hover
        className={cn(
          "flex w-full items-center rounded-lg outline-none select-none",
          isActive
            ? "bg-sidebar-row-active text-sidebar-foreground"
            : "bg-transparent text-sidebar-foreground hover:bg-sidebar-row-hover",
        )}
      >
        <button
          type="button"
          aria-current={isActive || undefined}
          aria-haspopup="menu"
          onClick={(event) => {
            if (!isContextMenuMouseEvent(event)) onSelect(bot);
          }}
          onKeyDown={openContextMenuFromKeyboard}
          onPointerDownCapture={stopContextMenuPointerDown}
          onDoubleClick={(event) => void onOpenMenu(event, bot)}
          onContextMenu={(event) => onOpenMenu(event, bot)}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <RosterAvatar bot={bot} presence={presence} className="size-10" />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="flex items-baseline gap-2">
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">{bot.name}</span>
              {latestMessage ? (
                <span className="shrink-0 text-xs tabular-nums text-sidebar-muted-foreground">
                  {formatRosterTimestamp(latestMessage.at, timestampFormat)}
                </span>
              ) : null}
            </span>
            {latestMessage ? (
              <span className="truncate text-[13px] text-sidebar-muted-foreground">
                {latestMessage.text}
              </span>
            ) : null}
          </span>
        </button>
      </div>
    </li>
  );
});

export function BotDragOverlay({ bot }: { readonly bot: Bot }) {
  const presence = useBotPresence(bot.id);
  return (
    <div className="flex w-20 cursor-grabbing flex-col items-center gap-2 rounded-xl bg-sidebar-row-hover px-1 pb-2 pt-3 text-sidebar-foreground shadow-xl select-none">
      <RosterAvatar bot={bot} presence={presence} className="size-14" />
      <span className="w-full truncate text-center text-xs">{bot.name}</span>
    </div>
  );
}

export function RailBotButton({
  bot,
  isActive,
  onSelect,
  onOpenMenu,
}: {
  bot: Bot;
  isActive: boolean;
  onSelect: (bot: Bot) => void;
  onOpenMenu: (event: ReactMouseEvent<HTMLElement>, bot: Bot) => void;
}) {
  const presence = useBotPresence(bot.id);
  return (
    <div className="relative">
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              data-bot-hover
              aria-label={bot.name}
              aria-current={isActive || undefined}
              aria-haspopup="menu"
              onClick={(event) => {
                if (!isContextMenuMouseEvent(event)) onSelect(bot);
              }}
              onKeyDown={openContextMenuFromKeyboard}
              onPointerDownCapture={stopContextMenuPointerDown}
              onDoubleClick={(event) => void onOpenMenu(event, bot)}
              onContextMenu={(event) => onOpenMenu(event, bot)}
              className={cn(
                "flex size-9 cursor-pointer items-center justify-center rounded-lg outline-none select-none focus-visible:ring-2 focus-visible:ring-ring",
                isActive ? "bg-sidebar-row-active" : "bg-transparent hover:bg-sidebar-row-hover",
              )}
            >
              <RosterAvatar
                bot={bot}
                presence={presence}
                className="size-7"
                dotClassName="size-1.5"
              />
            </button>
          }
        />
        <TooltipPopup side="right">{bot.name}</TooltipPopup>
      </Tooltip>
    </div>
  );
}
