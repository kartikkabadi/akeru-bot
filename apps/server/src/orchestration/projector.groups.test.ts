import {
  CommandId,
  EventId,
  ProjectId,
  ThreadId,
  type OrchestrationEvent,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { describe, expect, it } from "@effect/vitest";

import { createEmptyReadModel, projectEvent } from "./projector.ts";

function makeEvent(input: {
  sequence: number;
  type: OrchestrationEvent["type"];
  occurredAt: string;
  aggregateKind: OrchestrationEvent["aggregateKind"];
  aggregateId: string;
  commandId: string | null;
  payload: unknown;
}): OrchestrationEvent {
  return {
    sequence: input.sequence,
    eventId: EventId.make(`event-${input.sequence}`),
    type: input.type,
    aggregateKind: input.aggregateKind,
    aggregateId:
      input.aggregateKind === "project"
        ? ProjectId.make(input.aggregateId)
        : ThreadId.make(input.aggregateId),
    occurredAt: input.occurredAt,
    commandId: input.commandId === null ? null : CommandId.make(input.commandId),
    causationEventId: null,
    correlationId: null,
    metadata: {},
    payload: input.payload as never,
  } as OrchestrationEvent;
}

describe("orchestration projector groups", () => {
  it.effect("removes deleted bots from group projections even without an unassign event", () =>
    Effect.gen(function* () {
      const now = "2026-01-01T00:00:00.000Z";
      const afterBot = yield* projectEvent(
        createEmptyReadModel(now),
        makeEvent({
          sequence: 1,
          type: "bot.created",
          aggregateKind: "bot",
          aggregateId: "bot-1",
          occurredAt: now,
          commandId: "cmd-bot-create",
          payload: {
            botId: "bot-1",
            name: "Builder",
            title: "Assistant",
            label: null,
            description: null,
            disabledMcpServerIds: [],
            avatar: { kind: "dither", seed: "builder" },
            engine: null,
            sandbox: "local",
            runtimeMode: "full-access",
            usageCap: null,
            groupId: "group-1",
            createdAt: now,
            updatedAt: now,
          },
        }),
      );
      const afterGroup = yield* projectEvent(
        afterBot,
        makeEvent({
          sequence: 2,
          type: "group.created",
          aggregateKind: "group",
          aggregateId: "group-1",
          occurredAt: now,
          commandId: "cmd-group-create",
          payload: {
            groupId: "group-1",
            name: "Engineering",
            bossBotId: null,
            members: [{ botId: "bot-1", role: "specialist" }],
            createdAt: now,
            updatedAt: now,
          },
        }),
      );
      const afterDelete = yield* projectEvent(
        afterGroup,
        makeEvent({
          sequence: 3,
          type: "bot.deleted",
          aggregateKind: "bot",
          aggregateId: "bot-1",
          occurredAt: now,
          commandId: "cmd-bot-delete",
          payload: { botId: "bot-1", deletedAt: now },
        }),
      );

      expect(afterDelete.bots).toEqual([]);
      expect(afterDelete.groups[0]?.members).toEqual([]);
    }),
  );

  it.effect("clears a bot group id when group membership is removed", () =>
    Effect.gen(function* () {
      const now = "2026-01-01T00:00:00.000Z";
      const afterBot = yield* projectEvent(
        createEmptyReadModel(now),
        makeEvent({
          sequence: 1,
          type: "bot.created",
          aggregateKind: "bot",
          aggregateId: "bot-1",
          occurredAt: now,
          commandId: "cmd-bot-create",
          payload: {
            botId: "bot-1",
            name: "Builder",
            title: "Assistant",
            label: null,
            description: null,
            disabledMcpServerIds: [],
            avatar: { kind: "dither", seed: "builder" },
            engine: null,
            sandbox: "local",
            runtimeMode: "full-access",
            usageCap: null,
            groupId: "group-1",
            createdAt: now,
            updatedAt: now,
          },
        }),
      );
      const afterUnassign = yield* projectEvent(
        afterBot,
        makeEvent({
          sequence: 2,
          type: "group.member-unassigned",
          aggregateKind: "group",
          aggregateId: "group-1",
          occurredAt: now,
          commandId: "cmd-group-unassign",
          payload: { groupId: "group-1", botId: "bot-1", updatedAt: now },
        }),
      );

      expect(afterUnassign.bots[0]?.groupId).toBeNull();
    }),
  );
});
