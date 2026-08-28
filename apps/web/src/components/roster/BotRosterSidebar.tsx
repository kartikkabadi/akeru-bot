import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { restrictToFirstScrollableAncestor, snapCenterToCursor } from "@dnd-kit/modifiers";
import {
  SortableContext,
  rectSortingStrategy,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { BotId, EnvironmentId, GroupId, ThreadId } from "@t3tools/contracts";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { PlusIcon, SearchIcon } from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { useShallow } from "zustand/react/shallow";

import { isElectron } from "../../env";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { readLocalApi } from "../../localApi";
import { cn, randomUUID } from "../../lib/utils";
import { botEnvironment } from "../../state/bots";
import { readThreadShell, useThreadShells } from "../../state/entities";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { useAtomCommand } from "../../state/use-atom-command";
import { useUiStateStore } from "../../uiStateStore";
import { SidebarChromeFooter } from "../sidebar/SidebarChrome";
import { Button } from "../ui/button";
import { SidebarContent, SidebarGroup, SidebarHeader, SidebarTrigger } from "../ui/sidebar";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { requestBotDetailsPanelOpen } from "./botDetailsPanelEvents";
import { findLatestBotThreadTarget } from "./botThreadRuntime.logic";
import { NewBotDialog } from "./NewBotDialog";
import { NewGroupDialog } from "./NewGroupDialog";
import {
  buildBotRosterMenuItems,
  buildGroupedRosterSections,
  buildGroupRosterMenuItems,
  buildRosterStrip,
  filterRosterBots,
  isRecordableChatPath,
  parseChatPath,
  type BotRosterMenuAction,
  type GroupRosterMenuAction,
} from "./roster.logic";
import {
  BotDragOverlay,
  BotRosterRow,
  BotStripTile,
  GroupRosterRow,
  RailBotButton,
} from "./BotRosterRows";
import {
  advanceRosterDragTarget,
  previewRosterDrag,
  resolveRosterDropTarget,
  useRosterStore,
} from "./rosterStore";
import type { Bot, BotAvatar } from "./types";
import { useServerRosterSync } from "./useServerRoster";

type RosterAddMenuAction = "new-bot" | "new-group" | "restore" | `restore:${string}`;

function menuPosition(event: ReactMouseEvent<HTMLElement>) {
  if (event.type === "contextmenu" && (event.clientX !== 0 || event.clientY !== 0)) {
    return { x: event.clientX, y: event.clientY };
  }
  const rect = event.currentTarget.getBoundingClientRect();
  return { x: rect.right, y: rect.bottom };
}

/**
 * Minimal roster chrome: traffic-light drag space, an optional environment
 * pill, and the new-bot button. No brand row and no stage artwork. The
 * fixed SidebarControl trigger overlays the left edge on desktop, so content
 * starts at the titlebar inset. Icon-collapsed mode empties the row and the
 * rail supplies its own new-bot button.
 */
const RosterSidebarHeader = memo(function RosterSidebarHeader({
  onAdd,
}: {
  onAdd: (event: ReactMouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <SidebarHeader
      className={cn(
        "h-[var(--workspace-topbar-height)] shrink-0 flex-row items-center gap-1 px-3 py-0 md:px-2",
        isElectron && "drag-region",
      )}
    >
      <div className="grid min-w-0 flex-1 grid-cols-[1fr_auto_1fr] items-center group-data-[collapsible=icon]:hidden">
        <div className="flex items-center justify-start">
          <SidebarTrigger className="md:hidden" />
        </div>
        <Link
          to="/"
          className="flex items-center justify-center rounded-md text-sidebar-foreground outline-none ring-ring focus-visible:ring-2 [-webkit-app-region:no-drag]"
        >
          <span className="truncate text-xl leading-none tracking-tight [font-family:var(--font-brand-serif)]">
            akeru
          </span>
        </Link>
        <div className="flex items-center justify-end">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  aria-label="Add bot or group"
                  aria-haspopup="menu"
                  data-testid="roster-add"
                  className="size-[var(--workspace-titlebar-control-size)]! [-webkit-app-region:no-drag]"
                  onClick={onAdd}
                  size="icon"
                  variant="ghost"
                >
                  <PlusIcon />
                </Button>
              }
            />
            <TooltipPopup side="bottom">Add</TooltipPopup>
          </Tooltip>
        </div>
      </div>
    </SidebarHeader>
  );
});

function RosterDropZone({
  id,
  className,
  children,
}: {
  id: "pinned-zone" | "unpinned-zone";
  className?: string;
  children: ReactNode;
}) {
  const { isOver, setNodeRef } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      data-drop-zone={id}
      data-drag-over={isOver || undefined}
      className={className}
    >
      {children}
    </div>
  );
}

const rosterCollisionDetection: CollisionDetection = (args) => {
  const pointerHits = pointerWithin(args);
  if (pointerHits.length > 0) {
    const botHit = pointerHits.find(({ id }) => id !== "pinned-zone" && id !== "unpinned-zone");
    return botHit ? [botHit] : pointerHits.slice(0, 1);
  }
  return closestCenter(args);
};

function resolveFinalDropId(event: DragEndEvent): string | null {
  const activeId = String(event.active.id);
  const activator = event.activatorEvent;
  const start =
    "clientX" in activator &&
    typeof activator.clientX === "number" &&
    "clientY" in activator &&
    typeof activator.clientY === "number"
      ? { x: activator.clientX, y: activator.clientY }
      : null;
  if (!start) {
    return resolveRosterDropTarget(activeId, [], event.over ? String(event.over.id) : null);
  }

  const point = { x: start.x + event.delta.x, y: start.y + event.delta.y };
  const hitTargetIds = document.elementsFromPoint(point.x, point.y).flatMap((element) => {
    const target = element.closest<HTMLElement>("[data-roster-drop-id],[data-drop-zone]");
    const targetId = target?.dataset.rosterDropId ?? target?.dataset.dropZone;
    return targetId ? [targetId] : [];
  });
  return resolveRosterDropTarget(activeId, hitTargetIds, event.over ? String(event.over.id) : null);
}

const ROSTER_LOADING_ROWS = ["first", "second", "third"] as const;

function BotRosterLoadingState() {
  return (
    <div
      aria-label="Loading bots"
      className="flex flex-col gap-1 px-4 py-2 group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:px-0"
      role="status"
    >
      {ROSTER_LOADING_ROWS.map((row, index) => (
        <div
          className="flex h-12 items-center gap-3 rounded-lg px-2 group-data-[collapsible=icon]:size-10 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0"
          key={row}
        >
          <div className="size-8 shrink-0 rounded-full bg-sidebar-row-hover" />
          <div className="min-w-0 flex-1 space-y-2 group-data-[collapsible=icon]:hidden">
            <div
              className={cn("h-3 rounded-full bg-sidebar-row-hover", index === 1 ? "w-20" : "w-24")}
            />
            <div className="h-2.5 w-32 rounded-full bg-sidebar-row-hover/70" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function BotRosterSidebar() {
  const rosterLoading = useServerRosterSync();
  const navigate = useNavigate();
  const environmentId = usePrimaryEnvironmentId();
  const createBotCommand = useAtomCommand(botEnvironment.create, {
    reportFailure: false,
  });
  const updateBotCommand = useAtomCommand(botEnvironment.update, {
    reportFailure: false,
  });
  const archiveBotCommand = useAtomCommand(botEnvironment.archive, {
    reportFailure: false,
  });
  const restoreBotCommand = useAtomCommand(botEnvironment.restore, {
    reportFailure: false,
  });
  const deleteBotCommand = useAtomCommand(botEnvironment.delete, {
    reportFailure: false,
  });
  const createGroupCommand = useAtomCommand(botEnvironment.groups.create, {
    reportFailure: false,
  });
  const renameGroupCommand = useAtomCommand(botEnvironment.groups.rename, {
    reportFailure: false,
  });
  const deleteGroupCommand = useAtomCommand(botEnvironment.groups.delete, {
    reportFailure: false,
  });
  const pathname = useLocation({ select: (location) => location.pathname });
  const threadShells = useThreadShells();
  const markThreadUnread = useUiStateStore((state) => state.markThreadUnread);
  const { bots, groups, lastMessageByBotId, selectedBotId } = useRosterStore(
    useShallow((state) => ({
      bots: state.bots,
      groups: state.groups,
      lastMessageByBotId: state.lastMessageByBotId,
      selectedBotId: state.selectedBotId,
    })),
  );
  const [query, setQuery] = useState("");
  const [renamingGroupId, setRenamingGroupId] = useState<string | null>(null);
  const [renamingGroupName, setRenamingGroupName] = useState("");
  const [dragLayout, setDragLayout] = useState<Bot[] | null>(null);
  const dragLayoutRef = useRef<Bot[] | null>(null);
  const lastOverIdRef = useRef<string | null>(null);
  const [activeBotId, setActiveBotId] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const { copyToClipboard: copyBotId } = useCopyToClipboard<{ botId: string }>({
    target: "bot ID",
    onCopy: ({ botId }) =>
      toastManager.add({
        type: "success",
        title: "Bot ID copied",
        description: botId,
      }),
    onError: () => toastManager.add({ type: "error", title: "Could not copy bot ID" }),
  });
  const { copyToClipboard: copyConversationId } = useCopyToClipboard<{
    conversationId: string;
  }>({
    target: "conversation ID",
    onCopy: ({ conversationId }) =>
      toastManager.add({
        type: "success",
        title: "Conversation ID copied",
        description: conversationId,
      }),
    onError: () => toastManager.add({ type: "error", title: "Could not copy conversation ID" }),
  });

  const strip = useMemo(
    () => buildRosterStrip(bots, lastMessageByBotId),
    [bots, lastMessageByBotId],
  );
  const visibleBots = useMemo(
    () => filterRosterBots(dragLayout ?? bots, query).filter((bot) => bot.archivedAt === null),
    [bots, dragLayout, query],
  );
  const pinnedBots = visibleBots.filter((bot) => bot.pinned);
  const unpinnedBots = visibleBots.filter((bot) => !bot.pinned);
  const groupSections = useMemo(
    () => buildGroupedRosterSections(visibleBots, groups),
    [groups, visibleBots],
  );
  const orderedUnpinnedBotIds = useMemo(() => unpinnedBots.map((bot) => bot.id), [unpinnedBots]);
  const activeBot =
    activeBotId === null
      ? null
      : ((dragLayout ?? bots).find((bot) => bot.id === activeBotId) ?? null);

  const handleDragStart = ({ active }: DragStartEvent) => {
    dragLayoutRef.current = bots;
    lastOverIdRef.current = null;
    setActiveBotId(String(active.id));
    setDragLayout(bots);
  };
  const handleDragOver = ({ active, over }: DragOverEvent) => {
    const activeId = String(active.id);
    const target = advanceRosterDragTarget(
      lastOverIdRef.current,
      activeId,
      over ? String(over.id) : null,
    );
    lastOverIdRef.current = target.lastOverId;
    if (!target.previewTargetId) return;
    const layout = dragLayoutRef.current ?? bots;
    const next = previewRosterDrag(layout, activeId, target.previewTargetId, orderedUnpinnedBotIds);
    if (!next) {
      lastOverIdRef.current = null;
      return;
    }
    dragLayoutRef.current = next;
    setDragLayout(next);
  };
  const finishDrag = () => {
    dragLayoutRef.current = null;
    lastOverIdRef.current = null;
    setActiveBotId(null);
    setDragLayout(null);
  };
  const handleDragEnd = (event: DragEndEvent) => {
    const overId = resolveFinalDropId(event);
    if (overId) {
      const layout = dragLayoutRef.current ?? bots;
      const finalLayout =
        lastOverIdRef.current === overId
          ? layout
          : previewRosterDrag(layout, String(event.active.id), overId, orderedUnpinnedBotIds);
      if (finalLayout) useRosterStore.getState().commitBotLayout(finalLayout);
    }
    finishDrag();
  };

  // Remember the chat route the selected bot lands on, so re-selecting the
  // bot returns to its conversation. The first run after a selection change
  // is skipped: the route still belongs to the previously selected bot.
  const lastSelectedBotIdRef = useRef<string | null>(selectedBotId);
  const pendingClickedBotIdRef = useRef<string | null>(null);
  useEffect(() => {
    const selectionChanged = lastSelectedBotIdRef.current !== selectedBotId;
    const selectionCameFromClick = pendingClickedBotIdRef.current === selectedBotId;
    lastSelectedBotIdRef.current = selectedBotId;
    if (selectionCameFromClick) pendingClickedBotIdRef.current = null;
    if ((selectionChanged && selectionCameFromClick) || selectedBotId === null) return;
    if (!isRecordableChatPath(pathname)) return;
    useRosterStore.getState().recordChatPath(selectedBotId, pathname);
  }, [pathname, selectedBotId]);

  const handleSelect = useCallback(
    (bot: Bot) => {
      pendingClickedBotIdRef.current = bot.id;
      useRosterStore.getState().selectBot(bot.id);
      void navigate({ to: "/bots/$botId", params: { botId: bot.id } });
    },
    [navigate],
  );

  const conversationRefForBot = useCallback(
    (botId: string) => {
      const rememberedPath = useRosterStore.getState().chatPathByBotId[botId];
      const target =
        (environmentId ? findLatestBotThreadTarget(botId, environmentId, threadShells) : null) ??
        (rememberedPath ? parseChatPath(rememberedPath) : null);
      return target
        ? scopeThreadRef(EnvironmentId.make(target.environmentId), ThreadId.make(target.threadId))
        : null;
    },
    [environmentId, threadShells],
  );

  const openBotProfile = useCallback(
    async (bot: Bot) => {
      pendingClickedBotIdRef.current = bot.id;
      useRosterStore.getState().selectBot(bot.id);
      await navigate({ to: "/bots/$botId", params: { botId: bot.id } });
      requestBotDetailsPanelOpen(bot.id);
    },
    [navigate],
  );

  const [newBotOpen, setNewBotOpen] = useState(false);
  const [newGroupOpen, setNewGroupOpen] = useState(false);
  const [pendingCreatedBotId, setPendingCreatedBotId] = useState<string | null>(null);
  const [pendingCreatedGroupId, setPendingCreatedGroupId] = useState<string | null>(null);
  const handleNewBot = useCallback(() => {
    setNewBotOpen(true);
  }, []);
  const handleCreateBot = async ({ name, avatar }: { name: string; avatar: BotAvatar }) => {
    if (environmentId === null) {
      toastManager.add({
        type: "error",
        title: "Connect an environment first",
      });
      return;
    }
    const botId = BotId.make(`bot-${randomUUID()}`);
    const result = await createBotCommand({
      environmentId,
      input: {
        botId,
        name: name.trim(),
        title: "Assistant",
        label: null,
        description: null,
        avatar,
        engine: null,
        sandbox: null,
        runtimeMode: "full-access",
        usageCap: null,
        groupId: null,
      },
    });
    if (result._tag === "Failure") {
      toastManager.add({ type: "error", title: "Could not create bot" });
      return;
    }
    setNewBotOpen(false);
    setPendingCreatedBotId(botId);
  };

  const handleCreateGroup = async ({
    name,
    botIds,
  }: {
    name: string;
    botIds: readonly string[];
  }) => {
    if (environmentId === null) {
      toastManager.add({ type: "error", title: "Connect an environment first" });
      return;
    }
    const [firstBotId, ...remainingBotIds] = botIds;
    if (firstBotId === undefined) return;
    const groupId = GroupId.make(`group-${randomUUID()}`);
    const result = await createGroupCommand({
      environmentId,
      input: {
        groupId,
        name: name.trim(),
        bossBotId: BotId.make(firstBotId),
        ...(remainingBotIds.length > 0
          ? { specialistBotIds: remainingBotIds.map((botId) => BotId.make(botId)) }
          : {}),
      },
    });
    if (result._tag === "Failure") {
      toastManager.add({ type: "error", title: "Could not create group" });
      return;
    }
    setNewGroupOpen(false);
    setPendingCreatedGroupId(groupId);
  };

  const handleAddMenu = useCallback(
    async (event: ReactMouseEvent<HTMLButtonElement>) => {
      const api = readLocalApi();
      if (!api) return;
      const archivedBots = bots.filter((bot) => bot.archivedAt !== null);
      const action = await api.contextMenu.show<RosterAddMenuAction>(
        [
          { id: "new-bot", label: "New bot", icon: "plus" },
          { id: "new-group", label: "New group", icon: "folder" },
          {
            id: "restore",
            label: "Restore bot",
            icon: "archive-restore",
            disabled: archivedBots.length === 0,
            separatorBefore: true,
            children: archivedBots.map((bot) => ({
              id: `restore:${bot.id}` as const,
              label: bot.name,
            })),
          },
        ],
        menuPosition(event),
      );
      if (action === "new-bot") {
        handleNewBot();
        return;
      }
      if (action === "new-group") {
        setNewGroupOpen(true);
        return;
      }
      if (!action?.startsWith("restore:")) return;
      if (environmentId === null) {
        toastManager.add({ type: "error", title: "Connect an environment first" });
        return;
      }
      const result = await restoreBotCommand({
        environmentId,
        input: { botId: BotId.make(action.slice(8)) },
      });
      if (result._tag === "Failure") {
        toastManager.add({ type: "error", title: "Could not restore bot" });
      }
    },
    [bots, environmentId, handleNewBot, restoreBotCommand],
  );

  useEffect(() => {
    if (pendingCreatedGroupId === null) return;
    if (!groups.some((group) => group.id === pendingCreatedGroupId)) return;
    setPendingCreatedGroupId(null);
    void navigate({
      to: "/groups/$groupId",
      params: { groupId: pendingCreatedGroupId },
    });
  }, [groups, navigate, pendingCreatedGroupId]);

  useEffect(() => {
    if (pendingCreatedBotId === null) return;
    const bot = bots.find((candidate) => candidate.id === pendingCreatedBotId);
    if (!bot) return;
    const store = useRosterStore.getState();
    store.selectBot(bot.id);
    setPendingCreatedBotId(null);
    void navigate({ to: "/", replace: true });
  }, [bots, navigate, pendingCreatedBotId]);

  const handleBotContextMenu = useCallback(
    async (event: ReactMouseEvent<HTMLElement>, bot: Bot) => {
      event.preventDefault();
      event.stopPropagation();
      const api = readLocalApi();
      if (!api || environmentId === null) return;
      const conversationRef = conversationRefForBot(bot.id);
      const action = await api.contextMenu.show<BotRosterMenuAction>(
        buildBotRosterMenuItems(bot, groups, conversationRef !== null),
        menuPosition(event),
      );
      if (action === null) return;

      if (action === "pin" || action === "unpin") {
        useRosterStore.getState().moveBot(bot.id, null, action === "pin");
        return;
      }
      if (action.startsWith("move:")) {
        const groupId = action === "move:unassigned" ? null : GroupId.make(action.slice(5));
        const result = await updateBotCommand({
          environmentId,
          input: { botId: BotId.make(bot.id), groupId },
        });
        if (result._tag === "Failure") {
          toastManager.add({ type: "error", title: "Could not move bot" });
        }
        return;
      }
      if (action === "mark-unread" && conversationRef !== null) {
        const thread = readThreadShell(conversationRef);
        markThreadUnread(scopedThreadKey(conversationRef), thread?.latestTurn?.completedAt);
        return;
      }
      if (action === "edit-profile") {
        await openBotProfile(bot);
        return;
      }
      if (action === "duplicate") {
        const botId = BotId.make(`bot-${randomUUID()}`);
        const result = await createBotCommand({
          environmentId,
          input: {
            botId,
            name: `${bot.name} copy`,
            title: bot.title,
            label: bot.label,
            description: bot.description,
            disabledMcpServerIds: [...bot.disabledMcpServerIds],
            avatar: { ...bot.avatar },
            engine: bot.engine ? { ...bot.engine } : null,
            sandbox: bot.sandbox,
            runtimeMode: bot.runtimeMode,
            usageCap: bot.usageCap ? { ...bot.usageCap } : null,
            groupId: bot.groupId === null ? null : GroupId.make(bot.groupId),
          },
        });
        if (result._tag === "Failure") {
          toastManager.add({ type: "error", title: "Could not duplicate bot" });
          return;
        }
        setPendingCreatedBotId(botId);
        return;
      }
      if (action === "copy-conversation-id" && conversationRef !== null) {
        copyConversationId(conversationRef.threadId, {
          conversationId: conversationRef.threadId,
        });
        return;
      }
      if (action === "copy-bot-id") {
        copyBotId(bot.id, { botId: bot.id });
        return;
      }
      if (action === "archive") {
        const result = await archiveBotCommand({
          environmentId,
          input: { botId: BotId.make(bot.id) },
        });
        if (result._tag === "Failure") {
          toastManager.add({ type: "error", title: "Could not archive bot" });
        }
        return;
      }
      if (action !== "delete") return;
      const confirmed = await api.dialogs.confirm(
        [`Delete ${bot.name}?`, "The bot profile will be permanently deleted."].join("\n"),
        { variant: "destructive" },
      );
      if (!confirmed) return;
      const result = await deleteBotCommand({
        environmentId,
        input: { botId: BotId.make(bot.id) },
      });
      if (result._tag === "Failure") {
        toastManager.add({ type: "error", title: "Could not delete bot" });
      }
    },
    [
      archiveBotCommand,
      conversationRefForBot,
      copyBotId,
      copyConversationId,
      createBotCommand,
      deleteBotCommand,
      environmentId,
      groups,
      markThreadUnread,
      openBotProfile,
      updateBotCommand,
    ],
  );

  const startGroupRename = useCallback((groupId: string, name: string) => {
    setRenamingGroupId(groupId);
    setRenamingGroupName(name);
  }, []);

  const navigateToGroup = useCallback(
    (groupId: string) => {
      void navigate({ to: "/groups/$groupId", params: { groupId } });
    },
    [navigate],
  );

  const commitGroupRename = async (groupId: string, originalName: string) => {
    const name = renamingGroupName.trim();
    setRenamingGroupId(null);
    if (!name || name === originalName || environmentId === null) return;
    const result = await renameGroupCommand({
      environmentId,
      input: { groupId: GroupId.make(groupId), name },
    });
    if (result._tag === "Failure") {
      toastManager.add({ type: "error", title: "Could not rename group" });
    }
  };

  const handleGroupContextMenu = useCallback(
    async (event: ReactMouseEvent<HTMLElement>, group: { id: string; name: string }) => {
      event.preventDefault();
      event.stopPropagation();
      const api = readLocalApi();
      if (!api || environmentId === null) return;
      const groupIndex = groups.findIndex((candidate) => candidate.id === group.id);
      const action = await api.contextMenu.show<GroupRosterMenuAction>(
        buildGroupRosterMenuItems(groupIndex, groups.length),
        menuPosition(event),
      );
      if (action === "rename") {
        startGroupRename(group.id, group.name);
        return;
      }
      if (action === "move-up" || action === "move-down") {
        useRosterStore.getState().moveGroup(group.id, action === "move-up" ? "up" : "down");
        return;
      }
      if (action !== "delete") return;
      const confirmed = await api.dialogs.confirm(
        `Delete ${group.name}? Bots in this group will move to Unassigned.`,
        { variant: "destructive" },
      );
      if (!confirmed) return;
      const result = await deleteGroupCommand({
        environmentId,
        input: { groupId: GroupId.make(group.id) },
      });
      if (result._tag === "Failure") {
        toastManager.add({ type: "error", title: "Could not delete group" });
      }
    },
    [deleteGroupCommand, environmentId, groups, startGroupRename],
  );

  return (
    <>
      <RosterSidebarHeader onAdd={handleAddMenu} />
      <SidebarContent
        aria-busy={rosterLoading}
        className="gap-0"
        fixedHeader={
          <SidebarGroup className="px-[var(--sidebar-content-inset)] pb-1 pt-1 group-data-[collapsible=icon]:hidden">
            <label className="flex h-9 items-center gap-2 rounded-lg bg-sidebar-row-hover px-2.5 ring-ring focus-within:ring-2">
              <SearchIcon className="size-4 shrink-0 text-sidebar-muted-foreground" />
              <input
                type="text"
                data-testid="roster-search-input"
                placeholder="Search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape" && query.length > 0) {
                    event.stopPropagation();
                    setQuery("");
                  }
                }}
                className="min-w-0 flex-1 bg-transparent text-sm text-sidebar-foreground outline-none placeholder:text-sidebar-muted-foreground"
              />
            </label>
          </SidebarGroup>
        }
      >
        {rosterLoading ? (
          <BotRosterLoadingState />
        ) : groups.length === 0 && bots.every((bot) => bot.archivedAt !== null) ? (
          <div className="px-2 py-6 text-center text-sm text-sidebar-muted-foreground">
            No bots yet
          </div>
        ) : (
          <>
            {/* Icon-collapsed rail: every visible bot, recency order. */}
            <SidebarGroup className="hidden items-center gap-1 px-0 pt-1 group-data-[collapsible=icon]:flex">
              <ul data-testid="roster-rail" className="flex flex-col items-center gap-1">
                {strip.map((bot) => (
                  <li key={bot.id} className="list-none">
                    <RailBotButton
                      bot={bot}
                      isActive={selectedBotId === bot.id}
                      onSelect={handleSelect}
                      onOpenMenu={handleBotContextMenu}
                    />
                  </li>
                ))}
              </ul>
            </SidebarGroup>
            <DndContext
              collisionDetection={rosterCollisionDetection}
              sensors={sensors}
              modifiers={[restrictToFirstScrollableAncestor]}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDragCancel={finishDrag}
              onDragEnd={handleDragEnd}
            >
              {pinnedBots.length > 0 || activeBotId !== null ? (
                <SidebarGroup className="px-4 pb-3 pt-2 group-data-[collapsible=icon]:hidden">
                  <RosterDropZone
                    id="pinned-zone"
                    className="min-h-24 rounded-xl transition-colors data-[drag-over=true]:bg-sidebar-row-hover"
                  >
                    <SortableContext
                      items={pinnedBots.map((bot) => bot.id)}
                      strategy={rectSortingStrategy}
                    >
                      <ul
                        data-testid="roster-strip"
                        className={cn(
                          "grid min-h-24 place-items-center gap-x-1 gap-y-2",
                          pinnedBots.length === 1 ? "grid-cols-1" : "grid-cols-3",
                        )}
                      >
                        {pinnedBots.map((bot) => (
                          <BotStripTile
                            key={bot.id}
                            bot={bot}
                            isActive={selectedBotId === bot.id}
                            onSelect={handleSelect}
                            onOpenMenu={handleBotContextMenu}
                          />
                        ))}
                      </ul>
                    </SortableContext>
                  </RosterDropZone>
                </SidebarGroup>
              ) : null}
              <SidebarGroup className="px-[var(--sidebar-content-inset)] pb-1 pt-1 group-data-[collapsible=icon]:hidden">
                <RosterDropZone
                  id="unpinned-zone"
                  className="min-h-12 rounded-lg transition-colors data-[drag-over=true]:bg-sidebar-row-hover"
                >
                  <SortableContext
                    items={orderedUnpinnedBotIds}
                    strategy={verticalListSortingStrategy}
                  >
                    <div className="flex flex-col gap-2">
                      {/* Group chats first, then every bot as its own DM row. */}
                      {groupSections
                        .filter((section) => section.id !== "unassigned")
                        .map((section) => (
                          <section key={section.id} aria-label={section.name}>
                            {renamingGroupId === section.id ? (
                              <div className="mb-0.5 flex items-center gap-1 px-2 py-0.5">
                                <input
                                  autoFocus
                                  aria-label={`Rename ${section.name}`}
                                  value={renamingGroupName}
                                  onFocus={(event) => event.currentTarget.select()}
                                  onChange={(event) =>
                                    setRenamingGroupName(event.currentTarget.value)
                                  }
                                  onBlur={() => void commitGroupRename(section.id, section.name)}
                                  onKeyDown={(event) => {
                                    if (event.key === "Enter") {
                                      event.preventDefault();
                                      event.currentTarget.blur();
                                    } else if (event.key === "Escape") {
                                      event.preventDefault();
                                      setRenamingGroupId(null);
                                    }
                                  }}
                                  className="min-w-0 flex-1 rounded bg-sidebar-row-hover px-1 text-[13px] font-medium text-sidebar-foreground outline-none ring-ring focus:ring-2"
                                />
                              </div>
                            ) : (
                              <ul className="flex flex-col gap-px">
                                <GroupRosterRow
                                  id={section.id}
                                  name={section.name}
                                  members={section.bots}
                                  isActive={pathname === `/groups/${section.id}`}
                                  onNavigate={navigateToGroup}
                                  onOpenMenu={handleGroupContextMenu}
                                />
                              </ul>
                            )}
                          </section>
                        ))}
                      <ul
                        className={cn(
                          "flex flex-col gap-px",
                          unpinnedBots.length > 0 && "min-h-12",
                        )}
                      >
                        {unpinnedBots.map((bot) => (
                          <BotRosterRow
                            key={bot.id}
                            bot={bot}
                            lastMessage={lastMessageByBotId[bot.id] ?? null}
                            isActive={selectedBotId === bot.id}
                            onSelect={handleSelect}
                            onOpenMenu={handleBotContextMenu}
                          />
                        ))}
                      </ul>
                    </div>
                  </SortableContext>
                  {unpinnedBots.length === 0 && pinnedBots.length === 0 ? (
                    <div className="px-2 py-6 text-center text-sm text-sidebar-muted-foreground">
                      No bots match
                    </div>
                  ) : null}
                </RosterDropZone>
              </SidebarGroup>
              <DragOverlay modifiers={[snapCenterToCursor]}>
                {activeBot ? <BotDragOverlay bot={activeBot} /> : null}
              </DragOverlay>
            </DndContext>
          </>
        )}
      </SidebarContent>
      {/* Rail add menu sits above the footer, like the expanded header's plus. */}
      <div className="hidden shrink-0 flex-col items-center pb-1 group-data-[collapsible=icon]:flex">
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label="Add bot or group"
                aria-haspopup="menu"
                onClick={handleAddMenu}
                className="flex size-9 cursor-pointer items-center justify-center rounded-lg text-sidebar-muted-foreground outline-none select-none hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                <PlusIcon className="size-4" />
              </button>
            }
          />
          <TooltipPopup side="right">Add</TooltipPopup>
        </Tooltip>
      </div>
      {newBotOpen ? (
        <NewBotDialog
          open
          onOpenChange={setNewBotOpen}
          onCreate={(input) => void handleCreateBot(input)}
        />
      ) : null}
      {newGroupOpen ? (
        <NewGroupDialog
          open
          bots={bots}
          onOpenChange={setNewGroupOpen}
          onCreate={(input) => void handleCreateGroup(input)}
        />
      ) : null}
      <SidebarChromeFooter />
    </>
  );
}
