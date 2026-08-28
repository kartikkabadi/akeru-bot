// @effect-diagnostics nodeBuiltinImport:off
import * as NodeServices from "@effect/platform-node/NodeServices";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import {
  McpServerId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type ProviderRuntimeEvent,
  type ProviderSession,
} from "@t3tools/contracts";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import { assert, describe, expect, vi } from "vite-plus/test";

import { ServerConfig } from "../../config.ts";
import type { AkeruModelRunner } from "../AkeruModelRunner.ts";
import { AgentController } from "../Services/AgentController.ts";
import { LegacyProviderBridge } from "../Services/LegacyProviderBridge.ts";
import type { ProviderServiceShape } from "../Services/ProviderService.ts";
import { makeAgentControllerLive, type AgentControllerLiveOptions } from "./AgentController.ts";

const threadId = ThreadId.make("thread-akeru-controller");
const codexInstanceId = ProviderInstanceId.make("codex");

function providerSession(provider: ProviderDriverKind): ProviderSession {
  return {
    provider,
    providerInstanceId: ProviderInstanceId.make(String(provider)),
    threadId,
    status: "ready",
    runtimeMode: "approval-required",
    model: "model",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function makeBridge() {
  const startSession = vi.fn<ProviderServiceShape["startSession"]>((_threadId, input) =>
    Effect.succeed(providerSession(input.provider ?? ProviderDriverKind.make("cursor"))),
  );
  const sendTurn = vi.fn<ProviderServiceShape["sendTurn"]>((input) =>
    Effect.succeed({ threadId: input.threadId, turnId: TurnId.make("legacy-turn") }),
  );
  const service: ProviderServiceShape = {
    startSession,
    sendTurn,
    interruptTurn: () => Effect.void,
    respondToRequest: () => Effect.void,
    respondToUserInput: () => Effect.void,
    stopSession: () => Effect.void,
    rollbackConversation: () => Effect.void,
    listSessions: () => Effect.succeed([]),
    getCapabilities: () => Effect.succeed({ sessionModelSwitch: "in-session" }),
    getInstanceInfo: (instanceId) => {
      const driverKind = ProviderDriverKind.make(String(instanceId));
      return Effect.succeed({
        instanceId,
        driverKind,
        displayName: undefined,
        enabled: true,
        continuationIdentity: {
          driverKind,
          continuationKey: `${driverKind}:instance:${instanceId}`,
        },
      });
    },
    uploadFeedback: (input) => Effect.succeed({ feedbackId: `feedback-${input.threadId}` }),
    streamEvents: Stream.empty,
  };
  return { service, startSession, sendTurn };
}

function makeOptions(runner: AkeruModelRunner): AgentControllerLiveOptions {
  return {
    modelRunner: runner,
    prepareMcpRuntime: async (servers) => ({ servers, authorizationHeaders: {} }),
    makeConversationMemory: async () => ({
      prepare: async (context) => ({
        prompt: `History:${context.messages.map(({ text }) => text).join("|")}`,
        observed: false,
        degraded: false,
      }),
      destroy: async () => undefined,
    }),
    makeToolProviders: async () => [],
  };
}

function provide<A, E>(
  effect: Effect.Effect<A, E, AgentController>,
  bridge: ProviderServiceShape,
  options: AgentControllerLiveOptions,
) {
  return effect.pipe(
    Effect.provide(
      makeAgentControllerLive(options).pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(LegacyProviderBridge, bridge),
            Layer.succeed(HostProcessPlatform, "linux"),
            ServerConfig.layerTest(process.cwd(), {
              prefix: "akeru-controller-test-",
            }).pipe(Layer.provide(NodeServices.layer)),
          ),
        ),
      ),
    ),
    Effect.orDie,
  );
}

function resolveCodex(controller: AgentController["Service"]) {
  return controller.resolveEngine({
    threadId,
    engine: { provider: "codex", model: "gpt-5.6-sol" },
    fallback: { instanceId: codexInstanceId, model: "gpt-5.6-sol" },
    mode: "default",
  });
}

describe("AgentControllerLive", () => {
  it.effect("routes Codex through the Akeru runtime and emits canonical events", () => {
    const bridge = makeBridge();
    const runner: AkeruModelRunner = {
      stream: async function* () {
        yield { type: "text-start", id: "answer" };
        yield { type: "text-delta", id: "answer", text: "custom" };
        yield { type: "text-end", id: "answer" };
        yield { type: "response-messages", messages: [] };
      },
    };
    return provide(
      Effect.gen(function* () {
        const controller = yield* AgentController;
        yield* resolveCodex(controller);
        const events: ProviderRuntimeEvent[] = [];
        const fiber = yield* controller.streamEvents.pipe(
          Stream.runForEach((event) => Effect.sync(() => events.push(event))),
          Effect.forkChild({ startImmediately: true }),
        );
        yield* Effect.yieldNow;
        const session = yield* controller.startSession(threadId, {
          threadId,
          provider: ProviderDriverKind.make("codex"),
          providerInstanceId: codexInstanceId,
          cwd: process.cwd(),
          runtimeMode: "approval-required",
        });
        assert.equal(session.provider, "codex");
        yield* controller.sendTurn({ threadId, input: "Reply." });
        yield* Effect.promise(() =>
          vi.waitFor(() =>
            expect(events.some((event) => event.type === "turn.completed")).toBe(true),
          ),
        );
        expect(
          events
            .filter((event) => event.type === "content.delta")
            .map((event) => event.payload.delta),
        ).toEqual(["custom"]);
        expect(bridge.startSession).not.toHaveBeenCalled();
        expect(bridge.sendTurn).not.toHaveBeenCalled();
        yield* Fiber.interrupt(fiber);
      }),
      bridge.service,
      makeOptions(runner),
    );
  });

  it.effect("prepares durable context once before the current message", () => {
    const bridge = makeBridge();
    const messages: string[] = [];
    const runner: AkeruModelRunner = {
      stream: async function* (input) {
        const last = input.messages.at(-1);
        messages.push(typeof last?.content === "string" ? last.content : "");
        yield { type: "response-messages", messages: [] };
      },
    };
    return provide(
      Effect.gen(function* () {
        const controller = yield* AgentController;
        yield* resolveCodex(controller);
        yield* controller.startSession(threadId, {
          threadId,
          provider: ProviderDriverKind.make("codex"),
          providerInstanceId: codexInstanceId,
          runtimeMode: "full-access",
        });
        yield* controller.sendTurn({
          threadId,
          input: "Current",
          conversationContext: {
            resourceId: "memory-resource",
            threadId,
            messages: [
              {
                id: "prior",
                role: "user",
                text: "Prior",
                createdAt: "2026-01-01T00:00:00.000Z",
              },
            ],
          },
        });
        yield* Effect.promise(() => vi.waitFor(() => expect(messages).toHaveLength(1)));
        expect(messages[0]).toBe("History:Prior\n\nCurrent user message:\nCurrent");
      }),
      bridge.service,
      makeOptions(runner),
    );
  });

  it.effect("stores requested MCP ids when preparation returns an authenticated subset", () => {
    const bridge = makeBridge();
    const runner: AkeruModelRunner = { stream: async function* () {} };
    const mcpServer = {
      id: McpServerId.make("required-oauth"),
      name: "Required OAuth",
      transport: "url" as const,
      url: "https://mcp.example.com",
      authentication: "oauth" as const,
      enabled: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    return provide(
      Effect.gen(function* () {
        const controller = yield* AgentController;
        yield* resolveCodex(controller);
        const session = yield* controller.startSession(threadId, {
          threadId,
          provider: ProviderDriverKind.make("codex"),
          providerInstanceId: codexInstanceId,
          runtimeMode: "full-access",
          mcpServers: [mcpServer],
        });

        expect(session.mcpServerIds).toEqual([mcpServer.id]);
      }),
      bridge.service,
      {
        ...makeOptions(runner),
        prepareMcpRuntime: async () => ({ servers: [], authorizationHeaders: {} }),
      },
    );
  });

  it.effect("applies runtime-mode changes when reusing an Akeru session", () => {
    const bridge = makeBridge();
    const runner: AkeruModelRunner = { stream: async function* () {} };
    return provide(
      Effect.gen(function* () {
        const controller = yield* AgentController;
        yield* resolveCodex(controller);
        yield* controller.startSession(threadId, {
          threadId,
          provider: ProviderDriverKind.make("codex"),
          providerInstanceId: codexInstanceId,
          runtimeMode: "full-access",
        });
        const updated = yield* controller.startSession(threadId, {
          threadId,
          provider: ProviderDriverKind.make("codex"),
          providerInstanceId: codexInstanceId,
          runtimeMode: "approval-required",
        });

        expect(updated.runtimeMode).toBe("approval-required");
      }),
      bridge.service,
      makeOptions(runner),
    );
  });

  it.effect("keeps Cursor on its ACP-backed legacy bridge", () => {
    const bridge = makeBridge();
    const runner: AkeruModelRunner = { stream: async function* () {} };
    return provide(
      Effect.gen(function* () {
        const controller = yield* AgentController;
        yield* controller.resolveEngine({
          threadId,
          engine: { provider: "cursor", model: "cursor-model" },
          fallback: {
            instanceId: ProviderInstanceId.make("cursor"),
            model: "cursor-model",
          },
          mode: "default",
        });
        yield* controller.startSession(threadId, {
          threadId,
          provider: ProviderDriverKind.make("cursor"),
          providerInstanceId: ProviderInstanceId.make("cursor"),
          runtimeMode: "approval-required",
        });
        yield* controller.sendTurn({ threadId, input: "Cursor" });
        expect(bridge.startSession).toHaveBeenCalledOnce();
        expect(bridge.sendTurn).toHaveBeenCalledOnce();
      }),
      bridge.service,
      makeOptions(runner),
    );
  });

  it.effect("does not hold the global session lock while tools initialize", () => {
    const bridge = makeBridge();
    const runner: AkeruModelRunner = { stream: async function* () {} };
    const secondThreadId = ThreadId.make("thread-akeru-controller-second");
    let releaseFirst!: () => void;
    let markFirstEntered!: () => void;
    const firstEntered = new Promise<void>((resolve) => {
      markFirstEntered = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    return provide(
      Effect.gen(function* () {
        const controller = yield* AgentController;
        yield* resolveCodex(controller);
        yield* controller.resolveEngine({
          threadId: secondThreadId,
          engine: { provider: "codex", model: "gpt-5.6-sol" },
          fallback: { instanceId: codexInstanceId, model: "gpt-5.6-sol" },
          mode: "default",
        });
        const first = yield* controller
          .startSession(threadId, {
            threadId,
            provider: ProviderDriverKind.make("codex"),
            providerInstanceId: codexInstanceId,
            runtimeMode: "full-access",
          })
          .pipe(Effect.forkChild({ startImmediately: true }));
        yield* Effect.promise(() => firstEntered);

        const second = yield* controller.startSession(secondThreadId, {
          threadId: secondThreadId,
          provider: ProviderDriverKind.make("codex"),
          providerInstanceId: codexInstanceId,
          runtimeMode: "full-access",
        });

        expect(second.threadId).toBe(secondThreadId);
        releaseFirst();
        yield* Fiber.join(first);
      }),
      bridge.service,
      {
        ...makeOptions(runner),
        makeToolProviders: async ({ threadId: requestedThreadId }) => {
          if (requestedThreadId === threadId) {
            markFirstEntered();
            await release;
          }
          return [];
        },
      },
    );
  });

  it.effect("aborts tool initialization when a pending session stops", () => {
    const bridge = makeBridge();
    const runner: AkeruModelRunner = { stream: async function* () {} };
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    let aborted = false;
    return provide(
      Effect.gen(function* () {
        const controller = yield* AgentController;
        yield* resolveCodex(controller);
        const start = yield* controller
          .startSession(threadId, {
            threadId,
            provider: ProviderDriverKind.make("codex"),
            providerInstanceId: codexInstanceId,
            runtimeMode: "full-access",
          })
          .pipe(Effect.forkChild({ startImmediately: true }));
        yield* Effect.promise(() => started);

        yield* controller.stopSession({ threadId });
        yield* Effect.promise(() =>
          vi.waitFor(() => {
            expect(aborted).toBe(true);
          }),
        );
        yield* Fiber.interrupt(start);
      }),
      bridge.service,
      {
        ...makeOptions(runner),
        makeTools: async ({ signal }) =>
          new Promise((_resolve, reject) => {
            markStarted();
            const stop = () => {
              aborted = true;
              reject(signal?.reason ?? new Error("stopped"));
            };
            if (signal?.aborted) stop();
            else signal?.addEventListener("abort", stop, { once: true });
          }),
      },
    );
  });

  it.effect("passes remote sandboxes to the Akeru tool host", () => {
    const bridge = makeBridge();
    const runner: AkeruModelRunner = { stream: async function* () {} };
    const makeToolProviders = vi.fn(async () => []);
    return provide(
      Effect.gen(function* () {
        const controller = yield* AgentController;
        yield* resolveCodex(controller);
        const session = yield* controller.startSession(threadId, {
          threadId,
          provider: ProviderDriverKind.make("codex"),
          providerInstanceId: codexInstanceId,
          botSandbox: "vercel",
          runtimeMode: "full-access",
        });
        expect(session.provider).toBe(ProviderDriverKind.make("codex"));
        expect(makeToolProviders).toHaveBeenCalledWith(
          expect.objectContaining({ botSandbox: "vercel" }),
        );
      }),
      bridge.service,
      { ...makeOptions(runner), makeToolProviders },
    );
  });
});
