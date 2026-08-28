// @effect-diagnostics globalDate:off nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";

import {
  EventId,
  RuntimeItemId,
  RuntimeRequestId,
  TurnId,
  type McpServerId,
  type ModelSelection,
  type ProviderApprovalDecision,
  type ProviderConversationContext,
  type ProviderDriverKind,
  type ProviderInstanceId,
  type ProviderRespondToRequestInput,
  type ProviderRespondToUserInputInput,
  type ProviderRuntimeEvent,
  type ProviderSendTurnInput,
  type ProviderSession,
  type ProviderTurnStartResult,
  type RuntimeMode,
  type ThreadId,
  type UserInputQuestion,
} from "@t3tools/contracts";
import type { ModelMessage } from "ai";

import { buildAkeruRuntimePrompt } from "./AkeruAgentInstructions.ts";
import type { AkeruModelProvider } from "./AkeruModelAdapters.ts";
import type { AkeruModelRunner } from "./AkeruModelRunner.ts";
import { decideAkeruToolPermission, type AkeruToolDefinition } from "./AkeruToolRegistry.ts";

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (cause: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}

interface PendingApproval {
  readonly tool: AkeruToolDefinition;
  readonly deferred: Deferred<ProviderApprovalDecision>;
}

interface PendingInput {
  readonly deferred: Deferred<Readonly<Record<string, unknown>>>;
}

function selectedModelId(provider: AkeruModelProvider, model: string): string {
  switch (provider) {
    case "codex":
      return `openai/${model}`;
    case "claudeAgent":
      return `anthropic/${model}`;
    case "grok":
      return `xai/${model}`;
  }
}

function errorDetail(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function toolItemType(
  category: AkeruToolDefinition["category"],
): "command_execution" | "file_change" | "mcp_tool_call" | "dynamic_tool_call" {
  switch (category) {
    case "execute":
      return "command_execution";
    case "edit":
      return "file_change";
    case "mcp":
      return "mcp_tool_call";
    case "read":
    case "ask":
    case "external":
      return "dynamic_tool_call";
  }
}

function conversationMessages(context: ProviderConversationContext): ModelMessage[] {
  return context.messages.map(
    (message): ModelMessage => ({
      role: message.role,
      content: message.text,
    }),
  );
}

function toolRequestType(category: AkeruToolDefinition["category"]) {
  switch (category) {
    case "execute":
      return "command_execution_approval" as const;
    case "edit":
      return "file_change_approval" as const;
    case "mcp":
      return "mcp_elicitation_approval" as const;
    case "read":
      return "file_read_approval" as const;
    case "ask":
    case "external":
      return "dynamic_tool_call" as const;
  }
}

export interface AkeruAgentSessionInput {
  readonly threadId: ThreadId;
  readonly provider: AkeruModelProvider;
  readonly providerInstanceId: ProviderInstanceId;
  readonly model: string;
  readonly interactionMode: "default" | "plan";
  readonly runtimeMode: RuntimeMode;
  readonly cwd?: string;
  readonly mcpServerIds: readonly McpServerId[];
  readonly tools: ReadonlyMap<string, AkeruToolDefinition>;
  readonly contextSeeded?: boolean;
}

export interface AkeruAgentSession {
  readonly snapshot: () => ProviderSession;
  readonly hasConversationContext: () => boolean;
  readonly configure: (input: {
    readonly modelSelection: ModelSelection;
    readonly interactionMode: "default" | "plan";
    readonly runtimeMode?: RuntimeMode;
  }) => void;
  readonly send: (input: ProviderSendTurnInput) => ProviderTurnStartResult;
  readonly interrupt: () => void;
  readonly respondToRequest: (input: ProviderRespondToRequestInput) => void;
  readonly respondToUserInput: (input: ProviderRespondToUserInputInput) => void;
  readonly close: () => Promise<void>;
}

export function createAkeruAgentSession(input: {
  readonly session: AkeruAgentSessionInput;
  readonly modelRunner: AkeruModelRunner;
  readonly publish: (event: ProviderRuntimeEvent) => void;
  readonly closeTools?: () => Promise<void>;
}): AkeruAgentSession {
  const session = input.session;
  const createdAt = new Date().toISOString();
  const transcript: ModelMessage[] = [];
  const pendingApprovals = new Map<string, PendingApproval>();
  const pendingInputs = new Map<string, PendingInput>();
  const allowedTools = new Set<string>();
  let model = session.model;
  let interactionMode = session.interactionMode;
  let runtimeMode = session.runtimeMode;
  let status: ProviderSession["status"] = "ready";
  let contextSeeded = session.contextSeeded === true;
  let activeTurnId: TurnId | undefined;
  let abortController: AbortController | undefined;
  let activeRun: Promise<void> | undefined;
  let closed = false;

  const baseEvent = (turnId?: TurnId) => ({
    eventId: EventId.make(`akeru-${NodeCrypto.randomUUID()}`),
    provider: session.provider as ProviderDriverKind,
    providerInstanceId: session.providerInstanceId,
    threadId: session.threadId,
    createdAt: new Date().toISOString(),
    ...(turnId ? { turnId } : {}),
  });

  const publishState = (state: "ready" | "running" | "waiting" | "stopped" | "error") => {
    status =
      state === "running" || state === "waiting"
        ? "running"
        : state === "stopped"
          ? "closed"
          : state === "error"
            ? "error"
            : "ready";
    input.publish({
      ...baseEvent(activeTurnId),
      type: "session.state.changed",
      payload: { state },
    });
  };

  const rejectPending = (cause: unknown) => {
    for (const [requestId, pending] of pendingApprovals) {
      input.publish({
        ...baseEvent(activeTurnId),
        requestId: RuntimeRequestId.make(requestId),
        type: "request.resolved",
        payload: {
          requestType: toolRequestType(pending.tool.category),
          decision: "cancel",
        },
      });
      pending.deferred.reject(cause);
    }
    for (const [requestId, pending] of pendingInputs) {
      input.publish({
        ...baseEvent(activeTurnId),
        requestId: RuntimeRequestId.make(requestId),
        type: "user-input.resolved",
        payload: { answers: {} },
      });
      pending.deferred.reject(cause);
    }
    pendingApprovals.clear();
    pendingInputs.clear();
  };

  const askUser = async (
    toolCallId: string,
    questions: readonly UserInputQuestion[],
  ): Promise<unknown> => {
    const waiting = deferred<Readonly<Record<string, unknown>>>();
    pendingInputs.set(toolCallId, { deferred: waiting });
    publishState("waiting");
    input.publish({
      ...baseEvent(activeTurnId),
      requestId: RuntimeRequestId.make(toolCallId),
      type: "user-input.requested",
      payload: { questions: [...questions] },
    });
    const answers = await waiting.promise;
    pendingInputs.delete(toolCallId);
    publishState("running");
    const values = Object.values(answers);
    return values.length === 1 ? values[0] : answers;
  };

  const executeTool = async (toolInput: {
    readonly tool: AkeruToolDefinition;
    readonly toolCallId: string;
    readonly args: unknown;
    readonly signal: AbortSignal;
  }): Promise<unknown> => {
    const { tool, toolCallId, args, signal } = toolInput;
    const permission = decideAkeruToolPermission({
      runtimeMode,
      interactionMode,
      category: tool.category,
      sessionAllowed: allowedTools.has(tool.name),
    });
    if (permission === "deny") {
      input.publish({
        ...baseEvent(activeTurnId),
        itemId: RuntimeItemId.make(toolCallId),
        type: "item.completed",
        payload: {
          itemType: toolItemType(tool.category),
          status: "declined",
          title: tool.name,
          data: { reason: "Tool is unavailable in plan mode." },
        },
      });
      return { error: `${tool.name} is unavailable in plan mode.` };
    }
    if (permission === "ask") {
      const waiting = deferred<ProviderApprovalDecision>();
      pendingApprovals.set(toolCallId, { tool, deferred: waiting });
      publishState("waiting");
      input.publish({
        ...baseEvent(activeTurnId),
        requestId: RuntimeRequestId.make(toolCallId),
        type: "request.opened",
        payload: {
          requestType: toolRequestType(tool.category),
          detail: `Allow ${tool.name}?`,
          args,
          options: [
            { decision: "accept", label: "Allow" },
            { decision: "acceptForSession", label: "Allow for session" },
            { decision: "decline", label: "Decline" },
          ],
        },
      });
      const decision = await waiting.promise;
      pendingApprovals.delete(toolCallId);
      if (decision === "acceptForSession" || decision === "acceptAlways") {
        allowedTools.add(tool.name);
      }
      publishState("running");
      if (decision === "decline" || decision === "cancel") {
        input.publish({
          ...baseEvent(activeTurnId),
          itemId: RuntimeItemId.make(toolCallId),
          type: "item.completed",
          payload: {
            itemType: toolItemType(tool.category),
            status: "declined",
            title: tool.name,
            data: { reason: "Tool was declined by the user." },
          },
        });
        return { error: `${tool.name} was declined by the user.` };
      }
    }
    const itemId = RuntimeItemId.make(toolCallId);
    const itemType = toolItemType(tool.category);
    input.publish({
      ...baseEvent(activeTurnId),
      itemId,
      type: "item.started",
      payload: {
        itemType,
        status: "inProgress",
        title: tool.name,
        data: { args },
      },
    });
    try {
      const result = await tool.execute(args, {
        signal,
        askUser: (questions) => askUser(toolCallId, questions),
      });
      input.publish({
        ...baseEvent(activeTurnId),
        itemId,
        type: "item.completed",
        payload: {
          itemType,
          status: "completed",
          title: tool.name,
          data: { result },
        },
      });
      return result;
    } catch (cause) {
      input.publish({
        ...baseEvent(activeTurnId),
        itemId,
        type: "item.completed",
        payload: {
          itemType,
          status: "failed",
          title: tool.name,
          data: { error: errorDetail(cause) },
        },
      });
      throw cause;
    }
  };

  const runTurn = async (turnId: TurnId, transcriptStart: number, contextWasSeeded: boolean) => {
    const itemTypes = new Map<string, "assistant_message" | "reasoning">();
    try {
      for await (const part of input.modelRunner.stream({
        provider: session.provider,
        model,
        system: buildAkeruRuntimePrompt(selectedModelId(session.provider, model)),
        messages: transcript,
        tools: session.tools,
        signal: abortController?.signal ?? AbortSignal.abort(),
        executeTool,
      })) {
        switch (part.type) {
          case "text-start":
          case "reasoning-start": {
            const itemType = part.type === "text-start" ? "assistant_message" : "reasoning";
            itemTypes.set(part.id, itemType);
            input.publish({
              ...baseEvent(turnId),
              itemId: RuntimeItemId.make(part.id),
              type: "item.started",
              payload: { itemType, status: "inProgress" },
            });
            break;
          }
          case "text-delta":
          case "reasoning-delta":
            input.publish({
              ...baseEvent(turnId),
              itemId: RuntimeItemId.make(part.id),
              type: "content.delta",
              payload: {
                streamKind: part.type === "text-delta" ? "assistant_text" : "reasoning_text",
                delta: part.text,
              },
            });
            break;
          case "text-end":
          case "reasoning-end":
            input.publish({
              ...baseEvent(turnId),
              itemId: RuntimeItemId.make(part.id),
              type: "item.completed",
              payload: {
                itemType: itemTypes.get(part.id) ?? "assistant_message",
                status: "completed",
              },
            });
            break;
          case "usage":
            input.publish({
              ...baseEvent(turnId),
              type: "thread.token-usage.updated",
              payload: {
                usage: {
                  usedTokens: part.totalTokens,
                  inputTokens: part.inputTokens,
                  outputTokens: part.outputTokens,
                  reasoningOutputTokens: part.reasoningTokens,
                },
              },
            });
            break;
          case "response-messages":
            transcript.push(...part.messages);
            break;
          case "error":
            throw part.error;
          case "abort":
            throw abortController?.signal.reason ?? new Error(part.reason ?? "Turn interrupted.");
        }
      }
      input.publish({
        ...baseEvent(turnId),
        type: "turn.completed",
        payload: { state: "completed" },
      });
      activeTurnId = undefined;
      abortController = undefined;
      activeRun = undefined;
      if (!closed) publishState("ready");
    } catch (cause) {
      const interrupted = abortController?.signal.aborted === true;
      const detail = errorDetail(cause);
      transcript.splice(transcriptStart);
      if (!contextWasSeeded) contextSeeded = false;
      if (!interrupted) {
        input.publish({
          ...baseEvent(turnId),
          type: "runtime.error",
          payload: { message: detail, class: "provider_error" },
        });
      }
      input.publish({
        ...baseEvent(turnId),
        type: "turn.completed",
        payload: {
          state: interrupted ? "interrupted" : "failed",
          ...(!interrupted ? { errorMessage: detail } : {}),
        },
      });
      activeTurnId = undefined;
      abortController = undefined;
      activeRun = undefined;
      if (!closed) publishState("ready");
    }
  };

  input.publish({
    ...baseEvent(),
    type: "session.started",
    payload: { message: "Akeru agent session ready" },
  });
  publishState("ready");

  return {
    snapshot: () => ({
      provider: session.provider as ProviderDriverKind,
      providerInstanceId: session.providerInstanceId,
      status,
      runtimeMode,
      ...(session.cwd ? { cwd: session.cwd } : {}),
      model,
      threadId: session.threadId,
      mcpServerIds: session.mcpServerIds,
      ...(activeTurnId ? { activeTurnId } : {}),
      createdAt,
      updatedAt: new Date().toISOString(),
    }),
    hasConversationContext: () => contextSeeded,
    configure: (next) => {
      model = next.modelSelection.model;
      if (next.interactionMode === "plan" && interactionMode !== "plan") {
        allowedTools.clear();
      }
      interactionMode = next.interactionMode;
      if (next.runtimeMode) runtimeMode = next.runtimeMode;
    },
    send: (turnInput) => {
      if (closed) throw new Error(`Akeru session '${session.threadId}' is closed.`);
      if (activeTurnId)
        throw new Error(`Akeru session '${session.threadId}' already has an active turn.`);
      const transcriptStart = transcript.length;
      const contextWasSeeded = contextSeeded;
      if (!contextSeeded && turnInput.conversationContext) {
        transcript.push(...conversationMessages(turnInput.conversationContext));
      }
      const content = turnInput.input?.trim() ?? "";
      if (!content && (turnInput.attachments?.length ?? 0) === 0) {
        throw new Error("Akeru turns need text or an attachment.");
      }
      transcript.push({ role: "user", content });
      contextSeeded = true;
      const turnId = TurnId.make(`akeru-turn-${NodeCrypto.randomUUID()}`);
      activeTurnId = turnId;
      abortController = new AbortController();
      input.publish({
        ...baseEvent(turnId),
        type: "turn.started",
        payload: { model },
      });
      publishState("running");
      activeRun = runTurn(turnId, transcriptStart, contextWasSeeded);
      void activeRun;
      return { threadId: session.threadId, turnId };
    },
    interrupt: () => {
      const cause = new Error("Turn interrupted.");
      rejectPending(cause);
      abortController?.abort(cause);
    },
    respondToRequest: (response) => {
      const key = String(response.requestId);
      const pending = pendingApprovals.get(key);
      if (!pending) throw new Error(`Approval request '${key}' is not pending.`);
      pendingApprovals.delete(key);
      input.publish({
        ...baseEvent(activeTurnId),
        requestId: RuntimeRequestId.make(key),
        type: "request.resolved",
        payload: {
          requestType: toolRequestType(pending.tool.category),
          decision: response.decision,
        },
      });
      pending.deferred.resolve(response.decision);
    },
    respondToUserInput: (response) => {
      const key = String(response.requestId);
      const pending = pendingInputs.get(key);
      if (!pending) throw new Error(`User input request '${key}' is not pending.`);
      pendingInputs.delete(key);
      input.publish({
        ...baseEvent(activeTurnId),
        requestId: RuntimeRequestId.make(key),
        type: "user-input.resolved",
        payload: { answers: response.answers },
      });
      pending.deferred.resolve(response.answers);
    },
    close: async () => {
      if (closed) return;
      closed = true;
      const cause = new Error("Akeru session closed.");
      rejectPending(cause);
      abortController?.abort(cause);
      await activeRun;
      try {
        await input.closeTools?.();
      } finally {
        publishState("stopped");
      }
    },
  };
}
