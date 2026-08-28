// @effect-diagnostics globalDate:off nodeBuiltinImport:off
import * as NodePath from "node:path";

import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import {
  isAkeruRuntimeDriver,
  ProviderInstanceId,
  type AkeruRuntimeDriverKind,
  type BotSandbox,
  type McpServer,
  type ModelSelection,
  type ProviderConversationContext,
  type ProviderDriverKind,
  type ProviderRuntimeEvent,
  type ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import { resolveAttachmentPath } from "../../attachmentStore.ts";
import { ServerConfig } from "../../config.ts";
import { McpOAuthRuntime, type PreparedMcpRuntime } from "../../mcp-auth/McpOAuth.ts";
import { SubscriptionAuthService } from "../../subscription-auth/service.ts";
import { createAkeruAgentSession, type AkeruAgentSession } from "../AkeruAgentRuntime.ts";
import {
  createAkeruLanguageModel,
  subscriptionTokenSource,
  type AkeruModelProvider,
} from "../AkeruModelAdapters.ts";
import { createAiSdkModelRunner, type AkeruModelRunner } from "../AkeruModelRunner.ts";
import {
  createAkeruConversationMemory,
  type AkeruConversationMemory,
} from "../AkeruObservationalMemory.ts";
import { createAkeruMcpToolProvider } from "../AkeruMcpTools.ts";
import { createAkeruSandboxToolProvider, isRemoteBotSandbox } from "../AkeruSandboxTools.ts";
import {
  createAkeruToolRegistry,
  type AkeruToolDefinition,
  type AkeruToolProvider,
} from "../AkeruToolRegistry.ts";
import { AgentControllerRuntimeError, AgentControllerUnsupportedEngineError } from "../Errors.ts";
import { AgentController, type AgentControllerShape } from "../Services/AgentController.ts";
import { LegacyProviderBridge } from "../Services/LegacyProviderBridge.ts";

interface ResolvedEngine {
  readonly modelSelection: ModelSelection;
  readonly provider: ProviderDriverKind;
  readonly providerInstanceId: ProviderInstanceId;
  readonly mode: "default" | "plan";
}

interface ActiveAkeruSession {
  readonly session: AkeruAgentSession;
}

export interface AgentControllerLiveOptions {
  readonly modelRunner?: AkeruModelRunner;
  readonly handlesWithAkeruRuntime?: (
    driver: ProviderDriverKind,
  ) => driver is AkeruRuntimeDriverKind;
  readonly prepareMcpRuntime?: (servers: readonly McpServer[]) => Promise<PreparedMcpRuntime>;
  readonly makeConversationMemory?: () => Promise<AkeruConversationMemory>;
  readonly makeToolProviders?: (input: {
    readonly threadId: ThreadId;
    readonly cwd?: string;
    readonly mcpServers: readonly McpServer[];
    readonly authorizationHeaders: Readonly<Record<string, string>>;
    readonly botSandbox?: BotSandbox | null;
  }) => Promise<readonly AkeruToolProvider[]>;
  readonly makeTools?: (input: {
    readonly cwd?: string;
    readonly providers: readonly AkeruToolProvider[];
    readonly signal?: AbortSignal;
  }) => Promise<{
    readonly tools: ReadonlyMap<string, AkeruToolDefinition>;
    readonly close: () => Promise<void>;
  }>;
}

function failureDetail(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function modelProvider(driver: AkeruRuntimeDriverKind): AkeruModelProvider {
  if (driver === "codex") return "codex";
  if (driver === "claudeAgent") return "claudeAgent";
  return "grok";
}

const make = (options?: AgentControllerLiveOptions) =>
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const hostPlatform = yield* HostProcessPlatform;
    const legacyProviderBridge = yield* LegacyProviderBridge;
    const mutationLock = yield* Semaphore.make(1);
    const runtimeEvents = yield* PubSub.unbounded<ProviderRuntimeEvent>();
    const resolvedByThread = new Map<string, ResolvedEngine>();
    const sessions = new Map<string, ActiveAkeruSession>();
    const sessionVersions = new Map<string, number>();
    const pendingSessionStarts = new Map<string, AbortController>();
    const legacyContextSeeded = new Map<string, boolean>();
    const nextSessionVersion = (key: string) => {
      const version = (sessionVersions.get(key) ?? 0) + 1;
      sessionVersions.set(key, version);
      return version;
    };
    const subscriptionAuth = SubscriptionAuthService.forSecretsDir(config.secretsDir);
    const tokens = subscriptionTokenSource(subscriptionAuth);
    const modelRunner = options?.modelRunner ?? createAiSdkModelRunner(tokens);
    const handlesWithAkeruRuntime = options?.handlesWithAkeruRuntime ?? isAkeruRuntimeDriver;
    const mcpOAuth = McpOAuthRuntime.forSecretsDir(config.secretsDir);
    const prepareMcpRuntime =
      options?.prepareMcpRuntime ??
      ((servers: readonly McpServer[]) => mcpOAuth.prepareRuntime(servers));

    const run = <A>(operation: string, execute: () => Promise<A>) =>
      Effect.tryPromise({
        try: execute,
        catch: (cause) =>
          new AgentControllerRuntimeError({
            operation,
            detail: failureDetail(cause),
            cause,
          }),
      });

    const memory = yield* run("memory.construct", () =>
      options?.makeConversationMemory
        ? options.makeConversationMemory()
        : createAkeruConversationMemory({
            dbPath: NodePath.join(config.stateDir, "akeru-observational-memory.sqlite"),
            resolveModel: (threadId) => {
              const resolved = resolvedByThread.get(threadId);
              if (!resolved || !handlesWithAkeruRuntime(resolved.provider)) {
                throw new Error(`Thread '${threadId}' has no Akeru model for observation.`);
              }
              return createAkeruLanguageModel({
                provider: modelProvider(resolved.provider),
                model: resolved.modelSelection.model,
                tokens,
              });
            },
          }),
    );

    const inspectEngine: AgentControllerShape["inspectEngine"] = Effect.fn(
      "AgentController.inspectEngine",
    )(function* (modelSelection) {
      const provider = String(modelSelection.instanceId);
      const model = modelSelection.model;
      const unavailable = (cause: unknown) =>
        new AgentControllerUnsupportedEngineError({
          provider,
          model,
          detail: `Provider instance '${provider}' is not available.`,
          cause,
        });
      const routing = yield* legacyProviderBridge
        .getInstanceInfo(modelSelection.instanceId)
        .pipe(Effect.mapError(unavailable));
      const capabilities = yield* legacyProviderBridge
        .getCapabilities(modelSelection.instanceId)
        .pipe(Effect.mapError(unavailable));
      return { modelSelection, routing, capabilities };
    });

    const resolveEngine: AgentControllerShape["resolveEngine"] = (input) =>
      mutationLock.withPermits(1)(
        Effect.gen(function* () {
          const modelSelection =
            input.engine === null
              ? input.fallback
              : {
                  instanceId: ProviderInstanceId.make(input.engine.provider),
                  model: input.engine.model,
                };
          const inspected = yield* inspectEngine(modelSelection);
          const resolved: ResolvedEngine = {
            modelSelection,
            provider: inspected.routing.driverKind,
            providerInstanceId: modelSelection.instanceId,
            mode: input.mode,
          };
          const key = String(input.threadId);
          resolvedByThread.set(key, resolved);
          if (!sessions.has(key)) {
            nextSessionVersion(key);
            pendingSessionStarts.get(key)?.abort(new Error("The selected engine changed."));
            pendingSessionStarts.delete(key);
          }
          sessions.get(key)?.session.configure({
            modelSelection,
            interactionMode: input.mode,
          });
          return { ...inspected, mode: input.mode };
        }),
      );

    const prepareContext = Effect.fn("AgentController.prepareContext")(function* (
      context: ProviderConversationContext,
      observe = true,
    ) {
      const prepared = yield* run("memory.prepare", () => memory.prepare(context, { observe }));
      if (prepared.degraded) {
        yield* Effect.logWarning(
          "observational memory failed; using the bounded recent-message window",
          { threadId: context.threadId, resourceId: context.resourceId },
        );
      }
      return prepared.prompt;
    });

    const startSession: AgentControllerShape["startSession"] = Effect.fn(
      "AgentController.startSession",
    )(function* (threadId, input) {
      const key = String(threadId);
      const resolved = resolvedByThread.get(key);
      if (!resolved) {
        return yield* new AgentControllerRuntimeError({
          operation: "startSession",
          detail: `Thread '${threadId}' has no resolved engine.`,
        });
      }

      if (!handlesWithAkeruRuntime(resolved.provider)) {
        return yield* mutationLock.withPermits(1)(
          Effect.gen(function* () {
            const existing = sessions.get(key);
            if (existing) {
              sessions.delete(key);
              nextSessionVersion(key);
              yield* run("session.replace", () => existing.session.close());
            }
            const preparedMcp = yield* run("mcp.prepare", () =>
              prepareMcpRuntime(input.mcpServers ?? []),
            );
            const result = yield* legacyProviderBridge.startSession(threadId, {
              ...input,
              mcpServers: [...preparedMcp.servers],
              mcpServerAuthorizationHeaders: preparedMcp.authorizationHeaders,
            });
            legacyContextSeeded.set(key, input.resumeCursor !== undefined);
            return result;
          }),
        );
      }

      const decision = yield* mutationLock.withPermits(1)(
        Effect.sync(() => {
          const current = resolvedByThread.get(key);
          if (!current || !handlesWithAkeruRuntime(current.provider)) {
            return { kind: "changed" as const };
          }
          const existing = sessions.get(key);
          if (existing) {
            const snapshot = existing.session.snapshot();
            const activeMcpServerIds = snapshot.mcpServerIds ?? [];
            const requestedMcpServerIds = (input.mcpServers ?? []).map((server) => server.id);
            const canReuse =
              snapshot.provider === modelProvider(current.provider) &&
              snapshot.providerInstanceId === current.providerInstanceId &&
              snapshot.cwd === input.cwd &&
              activeMcpServerIds.length === requestedMcpServerIds.length &&
              activeMcpServerIds.every((id, index) => id === requestedMcpServerIds[index]);
            if (canReuse) {
              existing.session.configure({
                modelSelection: current.modelSelection,
                interactionMode: current.mode,
                runtimeMode: input.runtimeMode,
              });
              return { kind: "reused" as const, snapshot: existing.session.snapshot() };
            }
            sessions.delete(key);
          }
          pendingSessionStarts.get(key)?.abort(new Error("A newer session start replaced it."));
          const startController = new AbortController();
          pendingSessionStarts.set(key, startController);
          return {
            kind: "build" as const,
            resolved: current,
            provider: modelProvider(current.provider),
            existing,
            startController,
            version: nextSessionVersion(key),
          };
        }),
      );
      if (decision.kind === "changed") {
        return yield* new AgentControllerRuntimeError({
          operation: "startSession",
          detail: `Thread '${threadId}' changed engine while starting its session.`,
        });
      }
      if (decision.kind === "reused") return decision.snapshot;
      const replacedSession = decision.existing?.session;
      if (replacedSession) {
        yield* run("session.replace", () => replacedSession.close());
      }

      const preparedMcp = yield* run("mcp.prepare", () =>
        prepareMcpRuntime(input.mcpServers ?? []),
      );
      const remoteSandbox = isRemoteBotSandbox(input.botSandbox) ? input.botSandbox : undefined;
      const providers = yield* run("tools.providers", () =>
        options?.makeToolProviders
          ? options.makeToolProviders({
              threadId,
              ...(input.cwd ? { cwd: input.cwd } : {}),
              mcpServers: preparedMcp.servers,
              authorizationHeaders: preparedMcp.authorizationHeaders,
              ...(input.botSandbox !== undefined ? { botSandbox: input.botSandbox } : {}),
            })
          : Promise.resolve([
              createAkeruMcpToolProvider({
                servers: preparedMcp.servers,
                authorizationHeaders: preparedMcp.authorizationHeaders,
                ...(input.cwd ? { cwd: input.cwd } : {}),
              }),
              ...(remoteSandbox
                ? [
                    createAkeruSandboxToolProvider({
                      sandbox: remoteSandbox,
                      sessionId: String(threadId),
                      ...(input.cwd ? { workspaceRoot: input.cwd } : {}),
                      transferRoot: config.attachmentsDir,
                    }),
                  ]
                : []),
            ]),
      );
      const registry = yield* run("tools.create", () =>
        options?.makeTools
          ? options.makeTools({
              ...(!remoteSandbox && input.cwd ? { cwd: input.cwd } : {}),
              providers,
              signal: decision.startController.signal,
            })
          : createAkeruToolRegistry({
              platform: hostPlatform,
              ...(!remoteSandbox && input.cwd ? { cwd: input.cwd } : {}),
              providers,
              signal: decision.startController.signal,
            }),
      );
      const installed = yield* mutationLock.withPermits(1)(
        Effect.sync(() => {
          if (
            sessionVersions.get(key) !== decision.version ||
            resolvedByThread.get(key) !== decision.resolved
          ) {
            return undefined;
          }
          const session = createAkeruAgentSession({
            session: {
              threadId,
              provider: decision.provider,
              providerInstanceId: decision.resolved.providerInstanceId,
              model: decision.resolved.modelSelection.model,
              interactionMode: decision.resolved.mode,
              runtimeMode: input.runtimeMode,
              ...(input.cwd ? { cwd: input.cwd } : {}),
              mcpServerIds: (input.mcpServers ?? []).map((server) => server.id),
              tools: registry.tools,
              contextSeeded: input.resumeCursor !== undefined,
            },
            modelRunner,
            publish: (event) => PubSub.publishUnsafe(runtimeEvents, event),
            closeTools: registry.close,
          });
          if (pendingSessionStarts.get(key) === decision.startController) {
            pendingSessionStarts.delete(key);
          }
          sessions.set(key, { session });
          return session;
        }),
      );
      if (!installed) {
        yield* run("tools.cancelStart", () => registry.close());
        return yield* new AgentControllerRuntimeError({
          operation: "startSession",
          detail: `Thread '${threadId}' changed while starting its session.`,
        });
      }
      return installed.snapshot();
    });

    const sendTurn: AgentControllerShape["sendTurn"] = Effect.fn("AgentController.sendTurn")(
      function* (input) {
        const key = String(input.threadId);
        const active = sessions.get(key);
        if (!active) {
          const resolvedProvider = resolvedByThread.get(key)?.provider;
          if (resolvedProvider && handlesWithAkeruRuntime(resolvedProvider)) {
            return yield* new AgentControllerRuntimeError({
              operation: "sendTurn",
              detail: `Akeru session for thread '${input.threadId}' is not running.`,
            });
          }
          const shouldSeed = legacyContextSeeded.get(key) !== true;
          const contextPrompt =
            shouldSeed && input.conversationContext
              ? yield* prepareContext(input.conversationContext, false)
              : undefined;
          const result = yield* legacyProviderBridge.sendTurn({
            ...input,
            ...(contextPrompt
              ? { input: `${contextPrompt}\n\nCurrent user message:\n${input.input ?? ""}` }
              : {}),
          });
          legacyContextSeeded.set(key, true);
          return result;
        }
        const attachmentLines = yield* Effect.forEach(input.attachments ?? [], (attachment) => {
          const path = resolveAttachmentPath({
            attachmentsDir: config.attachmentsDir,
            attachment,
          });
          if (path === null) {
            return Effect.fail(
              new AgentControllerRuntimeError({
                operation: "sendTurn.attachments",
                detail: `Attachment '${attachment.id}' has an invalid path.`,
              }),
            );
          }
          return Effect.succeed(`[Attached file "${attachment.name}" is saved at: ${path}]`);
        });
        const current = [input.input, ...attachmentLines]
          .filter((part): part is string => typeof part === "string" && part.length > 0)
          .join("\n\n");
        let contextPrompt =
          !active.session.hasConversationContext() && input.conversationContext
            ? yield* prepareContext(input.conversationContext)
            : undefined;
        let target = sessions.get(key);
        if (
          target &&
          target !== active &&
          !target.session.hasConversationContext() &&
          !contextPrompt &&
          input.conversationContext
        ) {
          contextPrompt = yield* prepareContext(input.conversationContext);
          target = sessions.get(key);
        }
        if (!target) {
          return yield* new AgentControllerRuntimeError({
            operation: "sendTurn",
            detail: `Akeru session for thread '${input.threadId}' stopped while preparing the turn.`,
          });
        }
        const result = yield* Effect.try({
          try: () =>
            target.session.send({
              ...input,
              input: contextPrompt
                ? `${contextPrompt}\n\nCurrent user message:\n${current}`
                : current,
              conversationContext: undefined,
              attachments: undefined,
            }),
          catch: (cause) =>
            new AgentControllerRuntimeError({
              operation: "sendTurn",
              detail: failureDetail(cause),
              cause,
            }),
        });
        return result;
      },
    );

    const interruptTurn: AgentControllerShape["interruptTurn"] = Effect.fn(
      "AgentController.interruptTurn",
    )(function* (input) {
      const active = sessions.get(String(input.threadId));
      if (!active) return yield* legacyProviderBridge.interruptTurn(input);
      active.session.interrupt();
    });

    const respondToRequest: AgentControllerShape["respondToRequest"] = Effect.fn(
      "AgentController.respondToRequest",
    )(function* (input) {
      const active = sessions.get(String(input.threadId));
      if (!active) return yield* legacyProviderBridge.respondToRequest(input);
      yield* Effect.try({
        try: () => active.session.respondToRequest(input),
        catch: (cause) =>
          new AgentControllerRuntimeError({
            operation: "respondToRequest",
            detail: failureDetail(cause),
            cause,
          }),
      });
    });

    const respondToUserInput: AgentControllerShape["respondToUserInput"] = Effect.fn(
      "AgentController.respondToUserInput",
    )(function* (input) {
      const active = sessions.get(String(input.threadId));
      if (!active) return yield* legacyProviderBridge.respondToUserInput(input);
      yield* Effect.try({
        try: () => active.session.respondToUserInput(input),
        catch: (cause) =>
          new AgentControllerRuntimeError({
            operation: "respondToUserInput",
            detail: failureDetail(cause),
            cause,
          }),
      });
    });

    const stopSession: AgentControllerShape["stopSession"] = Effect.fn(
      "AgentController.stopSession",
    )(function* (input) {
      const key = String(input.threadId);
      const stopped = yield* mutationLock.withPermits(1)(
        Effect.sync(() => {
          nextSessionVersion(key);
          pendingSessionStarts.get(key)?.abort(new Error("Akeru session start stopped."));
          pendingSessionStarts.delete(key);
          const active = sessions.get(key);
          sessions.delete(key);
          const provider = resolvedByThread.get(key)?.provider;
          return {
            active,
            akeru: provider !== undefined && handlesWithAkeruRuntime(provider),
          };
        }),
      );
      const stoppedSession = stopped.active?.session;
      if (stoppedSession) {
        yield* run("session.close", () => stoppedSession.close());
        return;
      }
      if (stopped.akeru) return;
      const result = yield* legacyProviderBridge.stopSession(input);
      legacyContextSeeded.delete(key);
      return result;
    });

    const rollbackConversation: AgentControllerShape["rollbackConversation"] = (input) => {
      const resolved = resolvedByThread.get(String(input.threadId));
      if (resolved && handlesWithAkeruRuntime(resolved.provider)) {
        return Effect.fail(
          new AgentControllerRuntimeError({
            operation: "rollbackConversation",
            detail: `Akeru conversation rollback is not available for thread '${input.threadId}'.`,
          }),
        );
      }
      return legacyProviderBridge.rollbackConversation(input);
    };

    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        for (const active of sessions.values()) {
          yield* run("session.close", () => active.session.close()).pipe(
            Effect.ignoreCause({ log: true }),
          );
        }
        sessions.clear();
        for (const controller of pendingSessionStarts.values()) {
          controller.abort(new Error("Agent controller stopped."));
        }
        pendingSessionStarts.clear();
        legacyContextSeeded.clear();
        yield* run("memory.destroy", () => memory.destroy()).pipe(
          Effect.ignoreCause({ log: true }),
        );
      }),
    );

    return AgentController.of({
      resolveEngine,
      inspectEngine,
      startSession,
      sendTurn,
      interruptTurn,
      respondToRequest,
      respondToUserInput,
      stopSession,
      listSessions: () =>
        Effect.map(legacyProviderBridge.listSessions(), (legacySessions) => [
          ...legacySessions,
          ...[...sessions.values()].map((active) => active.session.snapshot()),
        ]),
      rollbackConversation,
      uploadFeedback: legacyProviderBridge.uploadFeedback,
      get streamEvents() {
        return Stream.merge(legacyProviderBridge.streamEvents, Stream.fromPubSub(runtimeEvents));
      },
    });
  });

export const makeAgentControllerLive = (options?: AgentControllerLiveOptions) =>
  Layer.effect(AgentController, make(options));

export const AgentControllerLive = makeAgentControllerLive();
