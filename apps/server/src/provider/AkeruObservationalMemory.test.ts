// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { ThreadId } from "@t3tools/contracts";
import { MockLanguageModelV3 } from "ai/test";
import { assert, describe, expect, it, vi } from "vite-plus/test";

import {
  AKERU_RECENT_CONTEXT_MAX_CHARS,
  createAkeruConversationMemory,
  makeAkeruConversationMemoryForEngine,
  takeRecentConversationMessages,
  type AkeruObservationEngine,
} from "./AkeruObservationalMemory.ts";

const context = {
  resourceId: "akeru-memory:v1:environment:test:project:one:group:one:thread:memory-thread",
  threadId: ThreadId.make("memory-thread"),
  messages: [
    {
      id: "old-user",
      role: "user" as const,
      text: "My launch city is Kyoto.",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "recent-assistant",
      role: "assistant" as const,
      text: "I saved that preference.",
      createdAt: "2026-01-01T00:00:01.000Z",
    },
  ],
};

function makeEngine(overrides: Partial<AkeruObservationEngine> = {}): AkeruObservationEngine {
  return {
    getStatus: vi.fn(async () => ({ shouldObserve: true })),
    observe: vi.fn(async () => ({ observed: true })),
    pruneObserved: vi.fn(async ({ messages }) => messages.slice(-1)),
    buildContextSystemMessage: vi.fn(async () => "Important prior fact: launch city is Kyoto."),
    settled: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("AkeruObservationalMemory", () => {
  it("injects observations with a bounded recent-message window and explicit scope", async () => {
    const engine = makeEngine();
    const memory = makeAkeruConversationMemoryForEngine(engine);

    const prepared = await memory.prepare(context);

    assert.equal(prepared.observed, true);
    assert.equal(prepared.degraded, false);
    assert.include(prepared.prompt ?? "", "launch city is Kyoto");
    assert.include(prepared.prompt ?? "", "I saved that preference.");
    assert.notInclude(prepared.prompt ?? "", "My launch city is Kyoto.");
    expect(engine.getStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: "memory-thread",
        resourceId: context.resourceId,
      }),
    );
    expect(engine.observe).toHaveBeenCalledOnce();
  });

  it("prepares legacy context without calling the observation model", async () => {
    const engine = makeEngine();
    const memory = makeAkeruConversationMemoryForEngine(engine);

    const prepared = await memory.prepare(context, { observe: false });

    assert.equal(prepared.degraded, false);
    expect(engine.getStatus).not.toHaveBeenCalled();
    expect(engine.observe).not.toHaveBeenCalled();
  });

  it("continues with a bounded recent window when observation processing fails", async () => {
    const messages = Array.from({ length: 40 }, (_, index) => ({
      id: `message-${index}`,
      role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
      text: `${index}: ${"x".repeat(2_000)}`,
      createdAt: `2026-01-01T00:00:${String(index).padStart(2, "0")}.000Z`,
    }));
    const engine = makeEngine({
      getStatus: vi.fn(async () => {
        throw new Error("observer unavailable");
      }),
    });
    const memory = makeAkeruConversationMemoryForEngine(engine);

    const prepared = await memory.prepare({ ...context, messages });

    assert.equal(prepared.degraded, true);
    assert.equal(prepared.observed, false);
    assert.isAtMost(prepared.prompt?.length ?? 0, AKERU_RECENT_CONTEXT_MAX_CHARS + 5_000);
    assert.include(prepared.prompt ?? "", "39:");
    assert.notInclude(prepared.prompt ?? "", '"text":"0: ');
  });

  it("bounds message count and characters from the newest settled messages", () => {
    const messages = Array.from({ length: 30 }, (_, index) => ({
      id: `bounded-${index}`,
      role: "user" as const,
      text: "x".repeat(2_000),
      createdAt: "2026-01-01T00:00:00.000Z",
    }));
    const recent = takeRecentConversationMessages(messages);

    assert.isAtMost(recent.length, 24);
    assert.isAtMost(
      recent.reduce((total, message) => total + message.text.length, 0),
      AKERU_RECENT_CONTEXT_MAX_CHARS,
    );
    assert.equal(recent.at(-1)?.id, "bounded-29");
  });

  it("initializes and reopens Akeru observation storage on an environment-local path", async () => {
    const baseDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "akeru-om-storage-"));
    const dbPath = NodePath.join(baseDir, "observations.sqlite");
    const model = new MockLanguageModelV3({
      provider: "akeru-subscription-test",
      modelId: "observation-test",
    });

    try {
      const first = await createAkeruConversationMemory({ dbPath, model });
      const firstPrepared = await first.prepare({
        ...context,
        messages: context.messages.slice(0, 1),
      });
      assert.equal(firstPrepared.degraded, false);
      await first.destroy();

      assert.equal(NodeFS.existsSync(dbPath), true);
      const reopened = await createAkeruConversationMemory({ dbPath, model });
      const secondPrepared = await reopened.prepare({
        ...context,
        messages: context.messages.slice(0, 1),
      });
      assert.equal(secondPrepared.degraded, false);
      await reopened.destroy();
    } finally {
      NodeFS.rmSync(baseDir, { recursive: true, force: true });
    }
  });
});
