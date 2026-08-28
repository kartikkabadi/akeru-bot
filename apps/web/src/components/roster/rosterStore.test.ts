import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import {
  advanceRosterDragTarget,
  previewRosterDrag,
  resolveRosterDropTarget,
  useRosterStore,
} from "./rosterStore";
import type { Bot, Group } from "./types";

function bot(id: string, archivedAt: string | null = null): Bot {
  return {
    id,
    name: id,
    title: "Assistant",
    label: null,
    description: null,
    disabledMcpServerIds: [],
    avatar: { kind: "blob", shape: "circle", color: "#5B7FD4" },
    engine: null,
    sandbox: null,
    runtimeMode: "full-access",
    usageCap: null,
    groupId: null,
    pinned: false,
    archivedAt,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };
}

function group(id: string): Group {
  return {
    id,
    name: id,
    bossBotId: null,
    members: [],
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };
}

const initialState = useRosterStore.getState();

beforeEach(() => {
  useRosterStore.setState({
    bots: [],
    groups: [],
    lastMessageByBotId: {},
    selectedBotId: null,
    chatPathByBotId: {},
  });
});

afterEach(() => {
  useRosterStore.setState({
    bots: initialState.bots,
    groups: initialState.groups,
    lastMessageByBotId: initialState.lastMessageByBotId,
    selectedBotId: initialState.selectedBotId,
    chatPathByBotId: initialState.chatPathByBotId,
  });
  if (typeof window !== "undefined") {
    window.localStorage.removeItem("akeru:roster:v1");
  }
});

describe("bot selection", () => {
  it("selects the first available bot when a roster arrives without the active bot", () => {
    useRosterStore.setState({ selectedBotId: "missing" });
    useRosterStore.getState().replaceRoster({
      bots: [bot("archived", "2026-08-20T00:00:00.000Z"), bot("akeru")],
      groups: [],
    });

    expect(useRosterStore.getState().selectedBotId).toBe("akeru");
  });

  it("cleans deleted bot selection and cached conversation state", () => {
    useRosterStore.setState({
      bots: [bot("deleted"), bot("remaining")],
      selectedBotId: "deleted",
      chatPathByBotId: { deleted: "/env/thread-deleted", remaining: "/env/thread-remaining" },
      lastMessageByBotId: {
        deleted: { text: "gone", at: "2026-08-20T00:00:00.000Z" },
        remaining: { text: "here", at: "2026-08-20T00:00:00.000Z" },
      },
    });

    useRosterStore.getState().replaceRoster({ bots: [bot("remaining")], groups: [] });

    expect(useRosterStore.getState().selectedBotId).toBe("remaining");
    expect(useRosterStore.getState().chatPathByBotId).toEqual({
      remaining: "/env/thread-remaining",
    });
    expect(useRosterStore.getState().lastMessageByBotId).toEqual({
      remaining: { text: "here", at: "2026-08-20T00:00:00.000Z" },
    });
  });

  it("updates a bot's roster preview after a local message", () => {
    const message = { text: "Ship it", at: "2026-08-20T00:00:00.000Z" };

    useRosterStore.getState().recordLastMessage("akeru", message);

    expect(useRosterStore.getState().lastMessageByBotId.akeru).toEqual(message);
  });

  it("keeps each bot's remembered thread path", () => {
    useRosterStore.getState().recordChatPath("akeru", "/env-1/thread-1");
    useRosterStore.getState().recordChatPath("mori", "/draft/draft-2");

    expect(useRosterStore.getState().chatPathByBotId).toEqual({
      akeru: "/env-1/thread-1",
      mori: "/draft/draft-2",
    });

    useRosterStore.getState().forgetChatPath("akeru");
    expect(useRosterStore.getState().chatPathByBotId).toEqual({
      mori: "/draft/draft-2",
    });
  });
});

describe("group order", () => {
  it("moves groups within bounds and preserves the order after server refresh", () => {
    useRosterStore.getState().replaceRoster({
      bots: [bot("one")],
      groups: [group("product"), group("support"), group("research")],
    });

    useRosterStore.getState().moveGroup("support", "up");
    useRosterStore.getState().moveGroup("support", "up");
    expect(useRosterStore.getState().groups.map((entry) => entry.id)).toEqual([
      "support",
      "product",
      "research",
    ]);

    useRosterStore.getState().replaceRoster({
      bots: [bot("one")],
      groups: [group("product"), group("support"), group("research"), group("new")],
    });
    expect(useRosterStore.getState().groups.map((entry) => entry.id)).toEqual([
      "support",
      "product",
      "research",
      "new",
    ]);
  });
});

describe("pin and order", () => {
  it("reserves the pinned strip immediately and commits that preview on drop", () => {
    const initial = [bot("one"), bot("two"), bot("three")];
    useRosterStore.setState({ bots: initial });

    const preview = previewRosterDrag(initial, "two", "pinned-zone");

    expect(preview?.map(({ id, pinned }) => [id, pinned])).toEqual([
      ["two", true],
      ["one", false],
      ["three", false],
    ]);
    expect(initial.find((entry) => entry.id === "two")?.pinned).toBe(false);

    useRosterStore.getState().commitBotLayout(preview ?? initial);
    expect(useRosterStore.getState().bots.find((entry) => entry.id === "two")?.pinned).toBe(true);
  });

  it.each([
    ["pin-a", ["dragged", "pin-a", "pin-b", "pin-c"]],
    ["pin-b", ["pin-a", "dragged", "pin-b", "pin-c"]],
    ["pin-c", ["pin-a", "pin-b", "dragged", "pin-c"]],
    ["pinned-zone", ["pin-a", "pin-b", "pin-c", "dragged"]],
  ])("pins at every strip position over %s", (overId, expectedPinnedIds) => {
    const initial = [
      { ...bot("pin-a"), pinned: true },
      { ...bot("pin-b"), pinned: true },
      { ...bot("pin-c"), pinned: true },
      bot("plain-a"),
      bot("dragged"),
      bot("plain-c"),
    ];

    const preview = previewRosterDrag(initial, "dragged", overId);

    expect(preview?.filter((entry) => entry.pinned).map((entry) => entry.id)).toEqual(
      expectedPinnedIds,
    );
    expect(preview?.filter((entry) => !entry.pinned).map((entry) => entry.id)).toEqual([
      "plain-a",
      "plain-c",
    ]);
  });

  it("pins and unpins only on a completed partition move", () => {
    useRosterStore.setState({ bots: [bot("one"), bot("two"), bot("three")] });

    useRosterStore.getState().moveBot("two", null, true);
    expect(useRosterStore.getState().bots.map(({ id, pinned }) => [id, pinned])).toEqual([
      ["two", true],
      ["one", false],
      ["three", false],
    ]);

    useRosterStore.getState().moveBot("two", null, false);
    expect(useRosterStore.getState().bots.map(({ id, pinned }) => [id, pinned])).toEqual([
      ["one", false],
      ["three", false],
      ["two", false],
    ]);
  });

  it("moves downward as soon as the dragged bot reaches the next row", () => {
    useRosterStore.setState({ bots: [bot("one"), bot("two"), bot("three")] });

    useRosterStore.getState().moveBot("one", "two", false);

    expect(useRosterStore.getState().bots.map((entry) => entry.id)).toEqual([
      "two",
      "one",
      "three",
    ]);
  });

  it("reorders both partitions and supports valid cross-partition drops", () => {
    useRosterStore.setState({
      bots: [
        { ...bot("pin-a"), pinned: true },
        { ...bot("pin-b"), pinned: true },
        bot("plain-a"),
        bot("plain-b"),
      ],
    });

    useRosterStore.getState().moveBot("pin-b", "pin-a", true);
    useRosterStore.getState().moveBot("plain-b", "plain-a", false);
    useRosterStore.getState().moveBot("plain-a", "pin-a", true);
    expect(useRosterStore.getState().bots.map(({ id, pinned }) => [id, pinned])).toEqual([
      ["pin-b", true],
      ["plain-a", true],
      ["pin-a", true],
      ["plain-b", false],
    ]);
  });

  it("ignores an invalid cross-partition target", () => {
    useRosterStore.setState({ bots: [{ ...bot("pinned"), pinned: true }, bot("plain")] });

    useRosterStore.getState().moveBot("pinned", "plain", true);
    expect(useRosterStore.getState().bots.map((entry) => entry.id)).toEqual(["pinned", "plain"]);
  });

  it("reorders grouped bots against their rendered order", () => {
    const layout = [
      { ...bot("a-one"), groupId: "a" },
      { ...bot("b-one"), groupId: "b" },
      { ...bot("a-two"), groupId: "a" },
      { ...bot("b-two"), groupId: "b" },
    ];

    const preview = previewRosterDrag(layout, "a-one", "a-two", [
      "a-one",
      "a-two",
      "b-one",
      "b-two",
    ]);

    expect(preview?.map((entry) => entry.id)).toEqual(["a-two", "a-one", "b-one", "b-two"]);
    expect(previewRosterDrag(layout, "a-one", "b-one")).toBeNull();
    expect(
      previewRosterDrag(
        [{ ...bot("pinned-a"), pinned: true, groupId: "a" }, ...layout],
        "pinned-a",
        "b-one",
      ),
    ).toBeNull();
  });

  it("rejects an active-element final hit instead of falling through to its zone", () => {
    expect(
      resolveRosterDropTarget("active", ["active", "active", "pinned-zone"], "active"),
    ).toBeNull();
    expect(resolveRosterDropTarget("active", ["pinned-zone"], "active")).toBe("pinned-zone");
  });

  it("allows a target again after the pointer returns to the active bot", () => {
    const first = advanceRosterDragTarget(null, "active", "adjacent");
    const repeated = advanceRosterDragTarget(first.lastOverId, "active", "adjacent");
    const reset = advanceRosterDragTarget(repeated.lastOverId, "active", "active");
    const reversed = advanceRosterDragTarget(reset.lastOverId, "active", "adjacent");

    expect(first.previewTargetId).toBe("adjacent");
    expect(repeated.previewTargetId).toBeNull();
    expect(reset.lastOverId).toBeNull();
    expect(reversed.previewTargetId).toBe("adjacent");
  });
});
