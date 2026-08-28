import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, OrchestrationBot, OrchestrationGroup } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";
import { useCallback, useEffect, useState } from "react";

import {
  botEnvironment,
  environmentBotsAtom,
  environmentGroupsAtom,
  environmentRosterLoadedAtom,
} from "../../state/bots";
import { useEnvironments, usePrimaryEnvironmentId } from "../../state/environments";
import { useAtomCommand } from "../../state/use-atom-command";
import { useRosterStore } from "./rosterStore";
import type { BotAvatar } from "./types";

const EMPTY_BOTS_ATOM = Atom.make<ReadonlyArray<OrchestrationBot>>([]);
const EMPTY_GROUPS_ATOM = Atom.make<ReadonlyArray<OrchestrationGroup>>([]);
const EMPTY_ROSTER_LOADED_ATOM = Atom.make(false);

export function resolveRosterLoadingState(input: {
  readonly environmentCatalogReady: boolean;
  readonly environmentId: EnvironmentId | null;
  readonly snapshotLoaded: boolean;
  readonly syncedEnvironmentId: EnvironmentId | null;
}): boolean {
  if (!input.environmentCatalogReady) return true;
  if (input.environmentId === null) return false;
  return !input.snapshotLoaded || input.syncedEnvironmentId !== input.environmentId;
}

/** Mirrors the primary environment's persisted bot roster into the UI store. */
export function useServerRosterSync(): boolean {
  const environmentId = usePrimaryEnvironmentId();
  const { isReady: environmentCatalogReady } = useEnvironments();
  const loaded = useAtomValue(
    environmentId === null ? EMPTY_ROSTER_LOADED_ATOM : environmentRosterLoadedAtom(environmentId),
  );
  const bots = useAtomValue(
    environmentId === null ? EMPTY_BOTS_ATOM : environmentBotsAtom(environmentId),
  );
  const groups = useAtomValue(
    environmentId === null ? EMPTY_GROUPS_ATOM : environmentGroupsAtom(environmentId),
  );
  const [syncedEnvironmentId, setSyncedEnvironmentId] = useState<EnvironmentId | null>(null);

  useEffect(() => {
    if (environmentId === null) {
      setSyncedEnvironmentId(null);
      return;
    }
    if (!loaded) return;
    useRosterStore.getState().replaceRoster({
      bots: bots.map((bot) => ({
        ...bot,
        avatar: { ...bot.avatar },
        pinned: false,
      })),
      groups: groups.map((group) => ({ ...group })),
    });
    setSyncedEnvironmentId(environmentId);
  }, [bots, environmentId, groups, loaded]);

  return resolveRosterLoadingState({
    environmentCatalogReady,
    environmentId,
    snapshotLoaded: loaded,
    syncedEnvironmentId,
  });
}

export function useSaveBotAvatar(): (botId: string, avatar: BotAvatar) => Promise<boolean> {
  const environmentId = usePrimaryEnvironmentId();
  const bots = useAtomValue(
    environmentId === null ? EMPTY_BOTS_ATOM : environmentBotsAtom(environmentId),
  );
  const updateBot = useAtomCommand(botEnvironment.update, { reportFailure: false });

  return useCallback(
    async (botId: string, avatar: BotAvatar) => {
      const serverBot = bots.find((candidate) => candidate.id === botId);
      if (environmentId !== null && serverBot !== undefined) {
        const result = await updateBot({
          environmentId,
          input: { botId: serverBot.id, avatar },
        });
        return result._tag === "Success";
      }
      useRosterStore.getState().setBotAvatar(botId, avatar);
      return true;
    },
    [bots, environmentId, updateBot],
  );
}
