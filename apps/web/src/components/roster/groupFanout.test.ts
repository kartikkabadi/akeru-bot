import { MessageId, type OrchestrationMessage } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildGroupContextNote,
  hasEveryoneMention,
  isSilentGroupReply,
  mergeGroupMemberMessages,
  splitMentionSegments,
  stripGroupFanoutNote,
} from "./groupFanout";

function message(input: {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
}): OrchestrationMessage {
  return {
    id: MessageId.make(input.id),
    role: input.role,
    text: input.text,
    attachments: [],
    turnId: null,
    streaming: false,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  } as OrchestrationMessage;
}

describe("group fan-out", () => {
  it("detects @everyone as its own token", () => {
    expect(hasEveryoneMention("@everyone hows it going")).toBe(true);
    expect(hasEveryoneMention("hey @everyone!")).toBe(true);
    expect(hasEveryoneMention("mail@everyone.com")).toBe(false);
    expect(hasEveryoneMention("@Everyone")).toBe(true);
  });

  it("recognizes silent replies", () => {
    expect(isSilentGroupReply("SILENT")).toBe(true);
    expect(isSilentGroupReply(" silent. ")).toBe(true);
    expect(isSilentGroupReply("[SILENT]")).toBe(true);
    expect(isSilentGroupReply("I stay silent on this")).toBe(false);
  });

  it("builds and strips the group-context note", () => {
    const note = buildGroupContextNote({
      memberName: "Testing Agent",
      groupName: "Test Group",
      memberNames: ["test", "Testing Agent"],
      everyone: true,
    });
    expect(note).toContain("You are Testing Agent");
    expect(note).toContain("together with test");
    expect(note).toContain("SILENT");
    expect(stripGroupFanoutNote(`hello${note}`)).toBe("hello");
    expect(stripGroupFanoutNote("hello")).toBe("hello");
  });

  it("merges member threads, dedupes the fanned-out user message, hides silent replies", () => {
    const noteA = buildGroupContextNote({
      memberName: "A",
      groupName: "G",
      memberNames: ["A", "B"],
      everyone: true,
    });
    const noteB = buildGroupContextNote({
      memberName: "B",
      groupName: "G",
      memberNames: ["A", "B"],
      everyone: true,
    });
    const merged = mergeGroupMemberMessages([
      {
        botId: "bot-a",
        working: false,
        messages: [
          message({
            id: "u-a",
            role: "user",
            text: `hi${noteA}`,
            createdAt: "2026-01-01T00:00:00Z",
          }),
          message({
            id: "m-a",
            role: "assistant",
            text: "Doing great",
            createdAt: "2026-01-01T00:00:05Z",
          }),
        ],
      },
      {
        botId: "bot-b",
        working: false,
        messages: [
          message({
            id: "u-b",
            role: "user",
            text: `hi${noteB}`,
            createdAt: "2026-01-01T00:00:00Z",
          }),
          message({
            id: "m-b",
            role: "assistant",
            text: "SILENT",
            createdAt: "2026-01-01T00:00:04Z",
          }),
        ],
      },
    ]);
    expect(merged.map((entry) => entry.message.id)).toEqual(["u-a", "m-a"]);
    expect(merged[0]?.message.text).toBe("hi");
    expect(merged[1]?.botId).toBe("bot-a");
  });

  it("keeps an early member reply visible while another member still works", () => {
    const merged = mergeGroupMemberMessages([
      {
        botId: "bot-a",
        working: false,
        messages: [
          message({ id: "u-a", role: "user", text: "hi", createdAt: "2026-01-01T00:00:00Z" }),
          message({
            id: "m-a",
            role: "assistant",
            text: "First!",
            createdAt: "2026-01-01T00:00:02Z",
          }),
        ],
      },
      {
        botId: "bot-b",
        working: true,
        messages: [
          message({ id: "u-b", role: "user", text: "hi", createdAt: "2026-01-01T00:00:00Z" }),
        ],
      },
    ]);
    expect(merged.map((entry) => entry.message.id)).toEqual(["u-a", "m-a"]);
  });

  it("splits @mentions of known names into highlighted segments", () => {
    expect(splitMentionSegments("@everyone hows it going", ["Testing Agent"])).toEqual([
      { type: "mention", text: "@everyone", start: 0 },
      { type: "text", text: " hows it going", start: 9 },
    ]);
    expect(splitMentionSegments("ask @Testing Agent pls", ["Testing Agent", "test"])).toEqual([
      { type: "text", text: "ask ", start: 0 },
      { type: "mention", text: "@Testing Agent", start: 4 },
      { type: "text", text: " pls", start: 18 },
    ]);
    expect(splitMentionSegments("mail@everyone.com", [])).toEqual([
      { type: "text", text: "mail@everyone.com", start: 0 },
    ]);
  });
});
