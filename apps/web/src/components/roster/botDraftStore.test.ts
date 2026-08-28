import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { clearBotDraft, readBotDraft, readBotDraftRevision, writeBotDraft } from "./botDraftStore";

const memory = new Map<string, string>();

beforeEach(() => {
  memory.clear();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => {
        memory.set(key, value);
      },
      removeItem: (key: string) => {
        memory.delete(key);
      },
      clear: () => memory.clear(),
    },
  });
});

afterEach(() => {
  memory.clear();
});

describe("botDraftStore", () => {
  it("restores a typed draft after a simulated restart", () => {
    writeBotDraft("bot-1", "yo what tool calls u got?");
    expect(readBotDraft("bot-1")).toBe("yo what tool calls u got?");
  });

  it("clears a draft after send", () => {
    writeBotDraft("bot-1", "half a sentence");
    clearBotDraft("bot-1");
    expect(readBotDraft("bot-1")).toBe("");
  });

  it("keeps drafts for other bots", () => {
    writeBotDraft("bot-1", "one");
    writeBotDraft("bot-2", "two");
    clearBotDraft("bot-1");
    expect(readBotDraft("bot-2")).toBe("two");
  });

  it("increments a per-bot revision for every write", () => {
    const before = readBotDraftRevision("bot-revision");
    writeBotDraft("bot-revision", "same");
    writeBotDraft("bot-revision", "same");
    expect(readBotDraftRevision("bot-revision")).toBe(before + 2);
  });
});
