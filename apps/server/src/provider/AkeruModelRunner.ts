import {
  dynamicTool,
  jsonSchema,
  streamText,
  stepCountIs,
  type ModelMessage,
  type ToolSet,
} from "ai";

import {
  createAkeruLanguageModel,
  type AkeruModelProvider,
  type AkeruTokenSource,
} from "./AkeruModelAdapters.ts";
import type { AkeruToolDefinition } from "./AkeruToolRegistry.ts";

export type AkeruModelStreamPart =
  | { readonly type: "text-start"; readonly id: string }
  | { readonly type: "text-delta"; readonly id: string; readonly text: string }
  | { readonly type: "text-end"; readonly id: string }
  | { readonly type: "reasoning-start"; readonly id: string }
  | { readonly type: "reasoning-delta"; readonly id: string; readonly text: string }
  | { readonly type: "reasoning-end"; readonly id: string }
  | {
      readonly type: "usage";
      readonly inputTokens: number;
      readonly outputTokens: number;
      readonly totalTokens: number;
      readonly reasoningTokens: number;
    }
  | { readonly type: "response-messages"; readonly messages: readonly ModelMessage[] }
  | { readonly type: "abort"; readonly reason?: string }
  | { readonly type: "error"; readonly error: unknown };

export interface AkeruModelRunInput {
  readonly provider: AkeruModelProvider;
  readonly model: string;
  readonly system: string;
  readonly messages: readonly ModelMessage[];
  readonly tools: ReadonlyMap<string, AkeruToolDefinition>;
  readonly signal: AbortSignal;
  readonly executeTool: (input: {
    readonly tool: AkeruToolDefinition;
    readonly toolCallId: string;
    readonly args: unknown;
    readonly signal: AbortSignal;
  }) => Promise<unknown>;
}

export interface AkeruModelRunner {
  readonly stream: (input: AkeruModelRunInput) => AsyncIterable<AkeruModelStreamPart>;
}

function toAiSdkTools(input: AkeruModelRunInput): ToolSet {
  return Object.fromEntries(
    [...input.tools.values()].map((definition) => [
      definition.name,
      dynamicTool({
        description: definition.description,
        inputSchema: jsonSchema(definition.inputSchema),
        execute: (args, options) =>
          input.executeTool({
            tool: definition,
            toolCallId: options.toolCallId,
            args,
            signal: options.abortSignal ?? input.signal,
          }),
      }),
    ]),
  );
}

export function createAiSdkModelRunner(tokens: AkeruTokenSource): AkeruModelRunner {
  return {
    stream: async function* (input) {
      const result = streamText({
        model: createAkeruLanguageModel({
          provider: input.provider,
          model: input.model,
          tokens,
        }),
        system: input.system,
        messages: [...input.messages],
        tools: toAiSdkTools(input),
        ...(input.provider === "codex" ? { providerOptions: { openai: { store: false } } } : {}),
        stopWhen: stepCountIs(64),
        abortSignal: input.signal,
      });
      for await (const part of result.fullStream) {
        switch (part.type) {
          case "text-start":
          case "text-end":
          case "reasoning-start":
          case "reasoning-end":
            yield { type: part.type, id: part.id };
            break;
          case "text-delta":
          case "reasoning-delta":
            yield { type: part.type, id: part.id, text: part.text };
            break;
          case "finish-step":
            break;
          case "abort":
            yield { type: "abort", ...(part.reason ? { reason: part.reason } : {}) };
            break;
          case "error":
            yield { type: "error", error: part.error };
            break;
          default:
            break;
        }
      }
      const usage = await result.totalUsage;
      yield {
        type: "usage",
        inputTokens: usage.inputTokens ?? 0,
        outputTokens: usage.outputTokens ?? 0,
        totalTokens: usage.totalTokens ?? 0,
        reasoningTokens: usage.outputTokenDetails.reasoningTokens ?? 0,
      };
      const response = await result.response;
      yield { type: "response-messages", messages: response.messages };
    },
  };
}
