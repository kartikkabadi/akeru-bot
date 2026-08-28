import type { StartThreadTurnInput } from "@t3tools/client-runtime/state/threads";
import type {
  BotId,
  GroupId,
  ModelSelection,
  ProjectId,
  ProviderInteractionMode,
  RuntimeMode,
  ThreadId,
} from "@t3tools/contracts";

export function buildBotTurnStartInput(input: {
  botId: BotId;
  threadId: ThreadId;
  projectId: ProjectId;
  title: string;
  message: StartThreadTurnInput["message"];
  modelSelection: ModelSelection;
  runtimeMode: RuntimeMode;
  interactionMode: ProviderInteractionMode;
  createdAt: string;
  createThread: boolean;
}): StartThreadTurnInput {
  return {
    threadId: input.threadId,
    message: input.message,
    modelSelection: input.modelSelection,
    titleSeed: input.title,
    runtimeMode: input.runtimeMode,
    interactionMode: input.interactionMode,
    ...(input.createThread
      ? {
          bootstrap: {
            createThread: {
              projectId: input.projectId,
              botId: input.botId,
              title: input.title,
              modelSelection: input.modelSelection,
              runtimeMode: input.runtimeMode,
              interactionMode: input.interactionMode,
              branch: null,
              worktreePath: null,
              createdAt: input.createdAt,
            },
          },
        }
      : {}),
    createdAt: input.createdAt,
  };
}

export function buildGroupTurnStartInput(input: {
  groupId: GroupId;
  respondingBotId?: BotId;
  threadId: ThreadId;
  projectId: ProjectId;
  title: string;
  message: StartThreadTurnInput["message"];
  modelSelection: ModelSelection;
  runtimeMode: RuntimeMode;
  interactionMode: ProviderInteractionMode;
  createdAt: string;
  createThread: boolean;
}): StartThreadTurnInput {
  return {
    threadId: input.threadId,
    message: input.message,
    modelSelection: input.modelSelection,
    titleSeed: input.title,
    runtimeMode: input.runtimeMode,
    interactionMode: input.interactionMode,
    ...(input.respondingBotId ? { respondingBotId: input.respondingBotId } : {}),
    ...(input.createThread
      ? {
          bootstrap: {
            createThread: {
              projectId: input.projectId,
              groupId: input.groupId,
              title: input.title,
              modelSelection: input.modelSelection,
              runtimeMode: input.runtimeMode,
              interactionMode: input.interactionMode,
              branch: null,
              worktreePath: null,
              createdAt: input.createdAt,
            },
          },
        }
      : {}),
    createdAt: input.createdAt,
  };
}

export function findLatestBotThreadTarget(
  botId: string,
  environmentId: string,
  threads: readonly {
    environmentId: string;
    id: string;
    botId?: string | null | undefined;
    updatedAt: string;
    archivedAt: string | null;
    deletedAt?: string | null | undefined;
  }[],
): { environmentId: string; threadId: string } | null {
  const latest = threads
    .filter(
      (thread) =>
        thread.environmentId === environmentId &&
        thread.botId === botId &&
        thread.archivedAt === null &&
        thread.deletedAt == null,
    )
    .toSorted(
      (left, right) =>
        right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id),
    )[0];
  return latest ? { environmentId: latest.environmentId, threadId: latest.id } : null;
}

/**
 * Latest durable thread for one group member. Fan-out gives each member its
 * own thread inside the group, keyed by the thread's respondingBotId. Older
 * single-thread groups map their mixed thread to whichever member answered
 * last, so history stays reachable.
 */
export function findLatestGroupMemberThreadTarget(
  groupId: string,
  botId: string,
  environmentId: string,
  threads: readonly {
    environmentId: string;
    id: string;
    groupId?: string | null | undefined;
    respondingBotId?: string | null | undefined;
    updatedAt: string;
    archivedAt: string | null;
    deletedAt?: string | null | undefined;
  }[],
  options?: { readonly adoptUnrouted?: boolean },
): { environmentId: string; threadId: string } | null {
  const candidates = threads.filter(
    (thread) =>
      thread.environmentId === environmentId &&
      thread.groupId === groupId &&
      thread.archivedAt === null &&
      thread.deletedAt == null,
  );
  const latest = candidates
    .filter(
      (thread) =>
        thread.respondingBotId === botId ||
        (options?.adoptUnrouted === true && thread.respondingBotId == null),
    )
    .toSorted(
      (left, right) =>
        right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id),
    )[0];
  return latest ? { environmentId: latest.environmentId, threadId: latest.id } : null;
}

export function findLatestGroupThreadTarget(
  groupId: string,
  environmentId: string,
  threads: readonly {
    environmentId: string;
    id: string;
    groupId?: string | null | undefined;
    updatedAt: string;
    archivedAt: string | null;
    deletedAt?: string | null | undefined;
  }[],
): { environmentId: string; threadId: string } | null {
  const latest = threads
    .filter(
      (thread) =>
        thread.environmentId === environmentId &&
        thread.groupId === groupId &&
        thread.archivedAt === null &&
        thread.deletedAt == null,
    )
    .toSorted(
      (left, right) =>
        right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id),
    )[0];
  return latest ? { environmentId: latest.environmentId, threadId: latest.id } : null;
}
