import { describe, expect, it } from "vite-plus/test";

import { availableGroupBots, selectedGroupBotIds } from "./NewGroupDialog";
import { filterRosterBots } from "./roster.logic";
import type { Bot } from "./types";

function bot(
  id: string,
  groupId: string | null = null,
  archivedAt: string | null = null,
  title = "Assistant",
): Bot {
  return {
    id,
    name: id,
    title,
    label: null,
    description: null,
    disabledMcpServerIds: [],
    avatar: { kind: "blob", shape: "circle", color: "#5B7FD4" },
    engine: null,
    sandbox: null,
    runtimeMode: "full-access",
    usageCap: null,
    groupId,
    pinned: false,
    archivedAt,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };
}

describe("new group", () => {
  it("offers only active unassigned bots", () => {
    expect(
      availableGroupBots([
        bot("available"),
        bot("assigned", "group-product"),
        bot("archived", null, "2026-08-27T00:00:00.000Z"),
      ]).map((entry) => entry.id),
    ).toEqual(["available"]);
  });

  it("searches available bots by name", () => {
    const bots = [bot("Atlas"), bot("Builder")];

    expect(filterRosterBots(bots, "atlas").map((entry) => entry.id)).toEqual(["Atlas"]);
  });

  it("returns selected bot ids in roster order", () => {
    const bots = [bot("first"), bot("second"), bot("third")];

    expect(selectedGroupBotIds(bots, new Set(["third", "first"]))).toEqual(["first", "third"]);
  });
});
