import { EnvironmentId, ThreadId, type ScopedThreadRef } from "@t3tools/contracts";
import { useMemo } from "react";

import { useThreadShell, useThreadShells } from "../../state/entities";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { findLatestBotThreadTarget } from "./botThreadRuntime.logic";
import { parseChatPath, resolveBotPresence, type RosterPresence } from "./roster.logic";
import { useRosterStore } from "./rosterStore";

/**
 * Live presence for one bot, derived from its latest durable server thread.
 */
export function useBotPresence(botId: string): RosterPresence {
  const chatPath = useRosterStore((state) => state.chatPathByBotId[botId] ?? null);
  const environmentId = usePrimaryEnvironmentId();
  const threadShells = useThreadShells();
  const ref = useMemo<ScopedThreadRef | null>(() => {
    const durableTarget = environmentId
      ? findLatestBotThreadTarget(botId, environmentId, threadShells)
      : null;
    const target = durableTarget ?? (chatPath === null ? null : parseChatPath(chatPath));
    return target
      ? {
          environmentId: EnvironmentId.make(target.environmentId),
          threadId: ThreadId.make(target.threadId),
        }
      : null;
  }, [botId, chatPath, environmentId, threadShells]);
  return resolveBotPresence(useThreadShell(ref));
}

/**
 * Live presence for a group across every member thread. Fan-out means several
 * members can work at once, so the group is working while any member works
 * and needs the user while any member waits.
 */
export function useGroupPresence(groupId: string): RosterPresence {
  const environmentId = usePrimaryEnvironmentId();
  const threadShells = useThreadShells();
  return useMemo(() => {
    let working = false;
    for (const shell of threadShells) {
      if (
        shell.environmentId !== environmentId ||
        shell.groupId !== groupId ||
        shell.archivedAt !== null
      ) {
        continue;
      }
      const presence = resolveBotPresence(shell);
      if (presence === "needs-you") return "needs-you";
      if (presence === "working") working = true;
    }
    return working ? "working" : "idle";
  }, [environmentId, groupId, threadShells]);
}
