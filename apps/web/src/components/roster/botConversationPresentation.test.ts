import { MessageId, TurnId, type OrchestrationMessage } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  botAwaitsReply,
  latestTurnFailureDetail,
  visibleBotChatMessages,
} from "./botConversationPresentation";

const message = (
  id: string,
  role: "user" | "assistant" | "system",
  streaming: boolean,
  turnId: string | null = null,
): OrchestrationMessage =>
  ({
    id: MessageId.make(id),
    role,
    text: id,
    turnId: turnId === null ? null : TurnId.make(turnId),
    streaming,
    createdAt: "2026-08-27T00:00:00.000Z",
    updatedAt: "2026-08-27T00:00:00.000Z",
  }) as const;

describe("latestTurnFailureDetail", () => {
  const activity = (kind: string, createdAt: string, detail?: string) =>
    ({
      id: `${kind}:${createdAt}`,
      createdAt,
      tone: "error",
      kind,
      summary: "Provider turn start failed",
      payload: detail === undefined ? {} : { detail },
      turnId: null,
    }) as never;

  it("surfaces the newest failure since the last user message", () => {
    const failure = activity(
      "provider.turn.start.failed",
      "2026-08-27T00:00:02.000Z",
      "Context.dev must be connected before this bot can use it.\n    at stack",
    );
    expect(latestTurnFailureDetail([failure], "2026-08-27T00:00:01.000Z")).toBe(
      "Context.dev must be connected before this bot can use it.",
    );
  });

  it("ignores failures from earlier turns and empty chats", () => {
    const stale = activity("provider.turn.start.failed", "2026-08-27T00:00:00.000Z", "old failure");
    expect(latestTurnFailureDetail([stale], "2026-08-27T00:00:01.000Z")).toBeNull();
    expect(latestTurnFailureDetail([stale], null)).toBeNull();
  });
});

describe("botAwaitsReply", () => {
  it("owes a reply while the newest record is an unanswered user message", () => {
    expect(botAwaitsReply([message("user", "user", false)])).toBe(true);
    expect(
      botAwaitsReply([
        message("user", "user", false),
        message("partial", "assistant", true, "turn-1"),
      ]),
    ).toBe(true);
  });

  it("stops once the answer lands or the turn terminally fails", () => {
    expect(
      botAwaitsReply([
        message("user", "user", false),
        message("answer", "assistant", false, "turn-1"),
      ]),
    ).toBe(false);
    expect(botAwaitsReply([message("user", "user", false)], { turnFailed: true })).toBe(false);
    expect(botAwaitsReply([])).toBe(false);
  });
});

describe("bot conversation presentation", () => {
  it("keeps user messages and settled answers only", () => {
    const messages = [
      message("user", "user", false),
      message("reasoning", "assistant", true, "turn-1"),
      message("answer", "assistant", false, "turn-1"),
      message("system", "system", false),
    ];

    expect(visibleBotChatMessages(messages).map((entry) => entry.id)).toEqual(["user", "answer"]);
  });

  it("shows only the last settled assistant record from one turn", () => {
    const messages = [
      message("user", "user", false),
      message("intermediate", "assistant", false, "turn-1"),
      message("final", "assistant", false, "turn-1"),
    ];

    expect(visibleBotChatMessages(messages).map((entry) => entry.id)).toEqual(["user", "final"]);
  });

  it("hides assistant records from the active turn behind the working status", () => {
    const messages = [
      message("first-user", "user", false),
      message("first-answer", "assistant", false, "turn-1"),
      message("active-user", "user", false),
      message("active-intermediate", "assistant", false, "turn-2"),
    ];

    expect(visibleBotChatMessages(messages, true).map((entry) => entry.id)).toEqual([
      "first-user",
      "first-answer",
      "active-user",
    ]);
  });
});
