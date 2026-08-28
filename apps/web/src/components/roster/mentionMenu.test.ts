import { describe, expect, it } from "vite-plus/test";

import { buildMentionMenuItems, mentionInsertText, nextMentionIndex } from "./mentionMenu";

const bots = [
  { id: "bot-newsletter", name: "Newsletter" },
  { id: "bot-instagram", name: "Instagram" },
];
const plugins = [{ id: "builtin-typefully", name: "Typefully" }];

describe("mention menu", () => {
  it("lists everyone, bots, then plugins for an empty query", () => {
    expect(buildMentionMenuItems("", bots, plugins).map((item) => item.id)).toEqual([
      "everyone",
      "bot-newsletter",
      "bot-instagram",
      "builtin-typefully",
    ]);
  });

  it("filters by name across kinds", () => {
    expect(buildMentionMenuItems("type", bots, plugins).map((item) => item.id)).toEqual([
      "builtin-typefully",
    ]);
    expect(buildMentionMenuItems("every", bots, plugins).map((item) => item.id)).toEqual([
      "everyone",
    ]);
  });

  it("inserts the label as a mention token", () => {
    const [item] = buildMentionMenuItems("news", bots, plugins);
    expect(item && mentionInsertText(item)).toBe("@Newsletter ");
  });

  it("wraps the active index in both directions", () => {
    expect(nextMentionIndex(0, 3, 1)).toBe(1);
    expect(nextMentionIndex(2, 3, 1)).toBe(0);
    expect(nextMentionIndex(0, 3, -1)).toBe(2);
    expect(nextMentionIndex(0, 0, 1)).toBe(0);
  });
});
