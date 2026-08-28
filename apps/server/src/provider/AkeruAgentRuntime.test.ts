// @effect-diagnostics globalTimers:off
import {
  ApprovalRequestId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type ProviderRuntimeEvent,
} from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import { createAkeruAgentSession } from "./AkeruAgentRuntime.ts";
import type { AkeruModelRunner } from "./AkeruModelRunner.ts";
import type { AkeruToolDefinition } from "./AkeruToolRegistry.ts";

const threadId = ThreadId.make("akeru-runtime-thread");

async function until(check: () => boolean): Promise<void> {
  await vi.waitFor(() => expect(check()).toBe(true));
}

function openSession(input: {
  readonly runner: AkeruModelRunner;
  readonly tools?: readonly AkeruToolDefinition[];
}) {
  const events: ProviderRuntimeEvent[] = [];
  const session = createAkeruAgentSession({
    session: {
      threadId,
      provider: "codex",
      providerInstanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5.6-sol",
      interactionMode: "default",
      runtimeMode: "approval-required",
      mcpServerIds: [],
      tools: new Map((input.tools ?? []).map((tool) => [tool.name, tool])),
    },
    modelRunner: input.runner,
    publish: (event) => events.push(event),
  });
  return { events, session };
}

describe("Akeru agent runtime", () => {
  it("streams canonical events and uses only the selected model identity", async () => {
    const systems: string[] = [];
    const runner: AkeruModelRunner = {
      stream: async function* (input) {
        systems.push(input.system);
        yield { type: "text-start", id: "answer" };
        yield { type: "text-delta", id: "answer", text: "Akeru" };
        yield { type: "text-end", id: "answer" };
        yield {
          type: "usage",
          inputTokens: 10,
          outputTokens: 2,
          totalTokens: 12,
          reasoningTokens: 0,
        };
        yield { type: "response-messages", messages: [{ role: "assistant", content: "Akeru" }] };
      },
    };
    const { events, session } = openSession({ runner });

    session.send({ threadId, input: "Reply." });
    await until(() => events.some((event) => event.type === "turn.completed"));

    expect(events.map(({ type }) => type).slice(-8)).toEqual([
      "turn.started",
      "session.state.changed",
      "item.started",
      "content.delta",
      "item.completed",
      "thread.token-usage.updated",
      "turn.completed",
      "session.state.changed",
    ]);
    expect(systems[0]).toBe(
      'Selected model ID: "openai/gpt-5.6-sol".\nWhen asked what model you are, answer with this exact selected model ID.',
    );
    expect(session.snapshot().activeTurnId).toBeUndefined();
  });

  it("suspends mutating tools for approval and remembers session approval", async () => {
    const executions: unknown[] = [];
    const tool: AkeruToolDefinition = {
      name: "Shell",
      description: "Run a command.",
      inputSchema: { type: "object" },
      category: "execute",
      execute: async (args) => {
        executions.push(args);
        return { exitCode: 0 };
      },
    };
    let call = 0;
    const runner: AkeruModelRunner = {
      stream: async function* (input) {
        call += 1;
        await input.executeTool({
          tool,
          toolCallId: `shell-${call}`,
          args: { command: "echo safe" },
          signal: input.signal,
        });
        yield { type: "response-messages", messages: [] };
      },
    };
    const { events, session } = openSession({ runner, tools: [tool] });

    session.send({ threadId, input: "Run it." });
    await until(() => events.some((event) => event.type === "request.opened"));
    expect(executions).toHaveLength(0);
    expect(session.snapshot().status).toBe("running");
    expect(events.find((event) => event.type === "request.opened")?.payload).toMatchObject({
      requestType: "command_execution_approval",
    });
    session.respondToRequest({
      threadId,
      requestId: ApprovalRequestId.make("shell-1"),
      decision: "acceptForSession",
    });
    await until(() => events.some((event) => event.type === "turn.completed"));
    expect(executions).toHaveLength(1);

    session.send({ threadId, input: "Run it again." });
    await until(() => events.filter((event) => event.type === "turn.completed").length === 2);
    expect(executions).toHaveLength(2);
    expect(events.filter((event) => event.type === "request.opened")).toHaveLength(1);
    expect(events.find((event) => event.type === "request.resolved")?.payload).toMatchObject({
      requestType: "command_execution_approval",
    });

    session.configure({
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.6-sol" },
      interactionMode: "plan",
    });
    session.send({ threadId, input: "Try it in plan mode." });
    await until(() => events.filter((event) => event.type === "turn.completed").length === 3);
    expect(executions).toHaveLength(2);
  });

  it("keeps acceptAlways grants scoped to one tool", async () => {
    const executions: string[] = [];
    const firstTool: AkeruToolDefinition = {
      name: "FirstShell",
      description: "Run the first command.",
      inputSchema: { type: "object" },
      category: "execute",
      execute: async () => executions.push("first"),
    };
    const secondTool: AkeruToolDefinition = {
      ...firstTool,
      name: "SecondShell",
      execute: async () => executions.push("second"),
    };
    const runner: AkeruModelRunner = {
      stream: async function* (input) {
        await input.executeTool({
          tool: firstTool,
          toolCallId: "first-shell",
          args: {},
          signal: input.signal,
        });
        await input.executeTool({
          tool: secondTool,
          toolCallId: "second-shell",
          args: {},
          signal: input.signal,
        });
        yield { type: "response-messages", messages: [] };
      },
    };
    const { events, session } = openSession({ runner, tools: [firstTool, secondTool] });

    session.send({ threadId, input: "Run both." });
    await until(() => events.some((event) => event.type === "request.opened"));
    session.respondToRequest({
      threadId,
      requestId: ApprovalRequestId.make("first-shell"),
      decision: "acceptAlways",
    });
    await until(() => events.filter((event) => event.type === "request.opened").length === 2);
    expect(executions).toEqual(["first"]);
    session.respondToRequest({
      threadId,
      requestId: ApprovalRequestId.make("second-shell"),
      decision: "decline",
    });
    await until(() => events.some((event) => event.type === "turn.completed"));
  });

  it("keeps tool item types stable when execution fails", async () => {
    const tool: AkeruToolDefinition = {
      name: "Shell",
      description: "Run a command.",
      inputSchema: { type: "object" },
      category: "execute",
      execute: async () => {
        throw new Error("failed");
      },
    };
    const runner: AkeruModelRunner = {
      stream: async function* (input) {
        await input.executeTool({
          tool,
          toolCallId: "shell-failure",
          args: { command: "false" },
          signal: input.signal,
        });
        yield { type: "response-messages", messages: [] };
      },
    };
    const { events, session } = openSession({ runner, tools: [tool] });

    session.send({ threadId, input: "Run it." });
    await until(() => events.some((event) => event.type === "request.opened"));
    session.respondToRequest({
      threadId,
      requestId: ApprovalRequestId.make("shell-failure"),
      decision: "accept",
    });
    await until(() => events.some((event) => event.type === "turn.completed"));

    const toolEvents = events.filter(
      (event) => "itemId" in event && event.itemId === "shell-failure",
    );
    expect(toolEvents).toHaveLength(2);
    expect(toolEvents.map((event) => event.payload)).toEqual([
      expect.objectContaining({ itemType: "command_execution", status: "inProgress" }),
      expect.objectContaining({ itemType: "command_execution", status: "failed" }),
    ]);
  });

  it("resolves pending approvals when closing a session", async () => {
    const tool: AkeruToolDefinition = {
      name: "Shell",
      description: "Run a command.",
      inputSchema: { type: "object" },
      category: "execute",
      execute: async () => ({ exitCode: 0 }),
    };
    const runner: AkeruModelRunner = {
      stream: async function* (input) {
        await input.executeTool({
          tool,
          toolCallId: "pending-shell",
          args: { command: "echo safe" },
          signal: input.signal,
        });
        yield { type: "response-messages", messages: [] };
      },
    };
    const { events, session } = openSession({ runner, tools: [tool] });

    session.send({ threadId, input: "Run it." });
    await until(() => events.some((event) => event.type === "request.opened"));
    await session.close();

    expect(events.find((event) => event.type === "request.resolved")).toMatchObject({
      payload: { requestType: "command_execution_approval", decision: "cancel" },
    });
  });

  it("keeps closed sessions closed after an active turn settles", async () => {
    const runner: AkeruModelRunner = {
      stream: async function* (input) {
        await new Promise<void>((_resolve, reject) => {
          input.signal.addEventListener("abort", () => reject(input.signal.reason), { once: true });
        });
        yield { type: "response-messages", messages: [] };
      },
    };
    const { events, session } = openSession({ runner });

    session.send({ threadId, input: "Wait." });
    await session.close();
    await until(() => events.some((event) => event.type === "turn.completed"));

    expect(session.snapshot().status).toBe("closed");
    expect(events.find((event) => event.type === "turn.completed")).toMatchObject({
      type: "turn.completed",
      payload: { state: "interrupted" },
    });
    expect(events.at(-1)).toMatchObject({
      type: "session.state.changed",
      payload: { state: "stopped" },
    });
  });

  it("interrupts a model stream and settles the active turn", async () => {
    const runner: AkeruModelRunner = {
      stream: async function* (input) {
        await new Promise<void>((_resolve, reject) => {
          input.signal.addEventListener("abort", () => reject(input.signal.reason), { once: true });
        });
        yield { type: "response-messages", messages: [] };
      },
    };
    const { events, session } = openSession({ runner });
    session.send({ threadId, input: "Wait." });
    session.interrupt();
    await until(() => events.some((event) => event.type === "turn.completed"));
    const completed = events.find((event) => event.type === "turn.completed");
    expect(completed?.payload).toMatchObject({ state: "interrupted" });
    expect(session.snapshot().activeTurnId).toBeUndefined();
    expect(session.snapshot().provider).toBe(ProviderDriverKind.make("codex"));
  });
});
