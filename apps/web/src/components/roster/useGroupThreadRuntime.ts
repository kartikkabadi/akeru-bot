import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  BotId,
  DEFAULT_RUNTIME_MODE,
  EnvironmentId,
  GroupId,
  ProviderInstanceId,
  ThreadId,
  type ModelSelection,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { useCallback, useMemo, useRef, useState } from "react";

import { usePrimarySettings } from "../../hooks/useSettings";
import { newMessageId, newThreadId } from "../../lib/utils";
import { resolveAppModelSelectionState } from "../../modelSelection";
import { environmentGroupsAtom } from "../../state/bots";
import {
  useAllEnvironmentShellsBootstrapped,
  useProjects,
  useThreadMessagesForRefs,
  useThreadShells,
} from "../../state/entities";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { primaryServerProvidersAtom } from "../../state/server";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { DEFAULT_INTERACTION_MODE } from "../../types";
import { sortScopedProjectsForSidebar } from "../Sidebar.logic";
import { botAwaitsReply } from "./botConversationPresentation";
import {
  buildGroupTurnStartInput,
  findLatestGroupMemberThreadTarget,
} from "./botThreadRuntime.logic";
import { buildGroupContextNote, hasEveryoneMention, mergeGroupMemberMessages } from "./groupFanout";
import { resolveBotPresence } from "./roster.logic";
import { useRosterStore } from "./rosterStore";

const NO_ENVIRONMENT = "" as EnvironmentId;

function errorMessage(result: Parameters<typeof squashAtomCommandFailure>[0]): string {
  const error = squashAtomCommandFailure(result);
  return error instanceof Error ? error.message : "Could not send the message.";
}

function threadTitle(prompt: string, files: readonly File[]): string {
  const seed = prompt || (files[0] ? `Image: ${files[0].name}` : "New thread");
  return seed.length > 80 ? `${seed.slice(0, 79)}…` : seed;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener(
      "error",
      () => reject(reader.error ?? new Error(`Could not read ${file.name}.`)),
      { once: true },
    );
    reader.addEventListener(
      "load",
      () =>
        typeof reader.result === "string"
          ? resolve(reader.result)
          : reject(new Error(`Could not read ${file.name}.`)),
      { once: true },
    );
    reader.readAsDataURL(file);
  });
}

export function useGroupThreadRuntime(groupId: string) {
  const projects = useProjects();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const serverGroups = useAtomValue(environmentGroupsAtom(primaryEnvironmentId ?? NO_ENVIRONMENT));
  const threadShells = useThreadShells();
  const bootstrapped = useAllEnvironmentShellsBootstrapped();
  const settings = usePrimarySettings();
  const providers = useAtomValue(primaryServerProvidersAtom);
  const bots = useRosterStore((state) => state.bots);
  const group = useRosterStore((state) =>
    state.groups.find((candidate) => candidate.id === groupId),
  );
  const primaryThreadShells = useMemo(
    () =>
      primaryEnvironmentId
        ? threadShells.filter((thread) => thread.environmentId === primaryEnvironmentId)
        : [],
    [primaryEnvironmentId, threadShells],
  );
  const members = useMemo(
    () => bots.filter((bot) => bot.groupId === groupId && bot.archivedAt === null),
    [bots, groupId],
  );
  // Each member owns one thread inside the group so members work concurrently.
  const retainedMemberRefs = useRef<{ groupId: string; refs: Map<string, ScopedThreadRef> }>({
    groupId,
    refs: new Map(),
  });
  if (retainedMemberRefs.current.groupId !== groupId) {
    retainedMemberRefs.current = { groupId, refs: new Map() };
  }
  const memberRefEntries = useMemo(
    () =>
      members.map((member) => {
        const target = primaryEnvironmentId
          ? findLatestGroupMemberThreadTarget(
              groupId,
              member.id,
              primaryEnvironmentId,
              primaryThreadShells,
              { adoptUnrouted: member.id === group?.bossBotId },
            )
          : null;
        return {
          botId: member.id,
          threadRef: target
            ? scopeThreadRef(
                EnvironmentId.make(target.environmentId),
                ThreadId.make(target.threadId),
              )
            : (retainedMemberRefs.current.refs.get(member.id) ?? null),
        };
      }),
    [group?.bossBotId, groupId, members, primaryEnvironmentId, primaryThreadShells],
  );
  for (const entry of memberRefEntries) {
    if (entry.threadRef) retainedMemberRefs.current.refs.set(entry.botId, entry.threadRef);
  }
  const linkedRefs = useMemo(
    () => memberRefEntries.flatMap((entry) => (entry.threadRef === null ? [] : [entry.threadRef])),
    [memberRefEntries],
  );
  const memberMessageLists = useThreadMessagesForRefs(linkedRefs);
  const shellByThreadId = useMemo(
    () => new Map(primaryThreadShells.map((shell) => [shell.id, shell])),
    [primaryThreadShells],
  );
  // Choice prompts surface from whichever member thread is waiting on the user.
  const pendingInputRef = useMemo(
    () =>
      linkedRefs.find((ref) => shellByThreadId.get(ref.threadId)?.hasPendingUserInput === true) ??
      null,
    [linkedRefs, shellByThreadId],
  );
  const [pendingBotIds, setPendingBotIds] = useState<ReadonlyArray<string>>([]);
  const workingBotIds = useMemo(() => {
    const working = new Set<string>();
    let listIndex = 0;
    for (const entry of memberRefEntries) {
      const shell = entry.threadRef ? shellByThreadId.get(entry.threadRef.threadId) : null;
      const list = entry.threadRef === null ? [] : (memberMessageLists[listIndex++] ?? []);
      if (!shell) continue;
      const presence = resolveBotPresence(shell);
      // An unanswered user message keeps the member working even while its
      // provider session churns through stop/restart states mid-turn.
      const turnFailed =
        shell.session?.status === "error" ||
        shell.latestTurn?.state === "error" ||
        shell.latestTurn?.state === "interrupted";
      // A member with a rendered choice card is waiting, not working; a stale
      // pending-input flag from a dead turn must not hide the working state.
      if (
        presence === "working" ||
        (!shell.hasPendingApprovals && botAwaitsReply(list, { turnFailed }))
      ) {
        working.add(entry.botId);
      }
    }
    for (const botId of pendingBotIds) working.add(botId);
    return [...working];
  }, [memberMessageLists, memberRefEntries, pendingBotIds, shellByThreadId]);
  const messages = useMemo(() => {
    let listIndex = 0;
    return mergeGroupMemberMessages(
      memberRefEntries.flatMap((entry) => {
        if (entry.threadRef === null) return [];
        const list = memberMessageLists[listIndex] ?? [];
        listIndex += 1;
        return [
          {
            botId: entry.botId,
            working: workingBotIds.includes(entry.botId),
            messages: list,
          },
        ];
      }),
    );
  }, [memberMessageLists, memberRefEntries, workingBotIds]);
  const defaultProject = useMemo(
    () =>
      bootstrapped && primaryEnvironmentId
        ? (sortScopedProjectsForSidebar(
            projects.filter((project) => project.environmentId === primaryEnvironmentId),
            primaryThreadShells,
            "updated_at",
          )[0] ?? null)
        : null,
    [bootstrapped, primaryEnvironmentId, primaryThreadShells, projects],
  );
  const activeThread = memberRefEntries
    .map((entry) => (entry.threadRef ? shellByThreadId.get(entry.threadRef.threadId) : undefined))
    .find((thread) => thread !== undefined);
  const activeProject =
    projects.find(
      (project) =>
        project.environmentId === activeThread?.environmentId &&
        project.id === activeThread.projectId,
    ) ?? defaultProject;
  const appDefaultModelSelection = useMemo(
    () => resolveAppModelSelectionState(settings, providers),
    [providers, settings],
  );
  const startTurn = useAtomCommand(threadEnvironment.startTurn, { reportFailure: false });
  const groupReady = serverGroups.some((candidate) => candidate.id === groupId);
  const sendInFlightRef = useRef(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = useCallback(
    async (prompt: string, files: readonly File[], requestedBotId?: string): Promise<boolean> => {
      if (sendInFlightRef.current) return false;
      if (!groupReady || !group) {
        setError("The group is still connecting.");
        return false;
      }
      if (!activeProject) {
        setError("Add a project before you message a group.");
        return false;
      }
      const unsupported = files.find((file) => !file.type.startsWith("image/"));
      if (unsupported) {
        setError("Group attachments must be images.");
        return false;
      }

      const everyone = requestedBotId === undefined && hasEveryoneMention(prompt);
      const targets = members.filter((bot) =>
        requestedBotId !== undefined
          ? bot.id === requestedBotId
          : everyone || bot.id === group.bossBotId,
      );
      if (targets.length === 0) {
        setError("Choose a current group member.");
        return false;
      }
      const memberNames = members.map((bot) => bot.name);

      sendInFlightRef.current = true;
      setSending(true);
      setPendingBotIds(targets.map((bot) => bot.id));
      setError(null);
      const createdAt = new Date().toISOString();

      try {
        const attachments = await Promise.all(
          files.map(async (file) => ({
            type: "image" as const,
            name: file.name,
            mimeType: file.type,
            sizeBytes: file.size,
            dataUrl: await readFileAsDataUrl(file),
          })),
        );
        const outcomes = await Promise.all(
          targets.map(async (member) => {
            const currentRef = retainedMemberRefs.current.refs.get(member.id) ?? null;
            const threadId = currentRef?.threadId ?? newThreadId();
            const environmentId = currentRef?.environmentId ?? activeProject.environmentId;
            const modelSelection: ModelSelection = member.engine
              ? {
                  instanceId: ProviderInstanceId.make(member.engine.provider),
                  model: member.engine.model,
                }
              : (activeProject.defaultModelSelection ?? appDefaultModelSelection);
            const result = await startTurn({
              environmentId,
              input: buildGroupTurnStartInput({
                groupId: GroupId.make(groupId),
                respondingBotId: BotId.make(member.id),
                threadId,
                projectId: activeProject.id,
                title: threadTitle(prompt, files),
                message: {
                  messageId: newMessageId(),
                  role: "user",
                  // Context note tells the member who it is and when to stay
                  // silent; the group view strips it before display.
                  text: `${prompt}${buildGroupContextNote({
                    memberName: member.name,
                    groupName: group.name,
                    memberNames,
                    everyone,
                  })}`,
                  attachments,
                },
                modelSelection,
                runtimeMode: member.runtimeMode ?? DEFAULT_RUNTIME_MODE,
                interactionMode: DEFAULT_INTERACTION_MODE,
                createdAt,
                createThread: currentRef === null,
              }),
            });
            if (result._tag === "Failure") return errorMessage(result);
            retainedMemberRefs.current.refs.set(member.id, scopeThreadRef(environmentId, threadId));
            return null;
          }),
        );
        const failure = outcomes.find((outcome) => outcome !== null);
        if (failure !== undefined && failure !== null) {
          setError(failure);
          return outcomes.some((outcome) => outcome === null);
        }
        return true;
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not send the message.");
        return false;
      } finally {
        sendInFlightRef.current = false;
        setSending(false);
        setPendingBotIds([]);
      }
    },
    [activeProject, appDefaultModelSelection, group, groupId, groupReady, members, startTurn],
  );

  return {
    bootstrapped,
    defaultProject: activeProject,
    error,
    groupReady,
    messages,
    pendingInputRef,
    send,
    sending,
    workingBotIds,
  };
}
