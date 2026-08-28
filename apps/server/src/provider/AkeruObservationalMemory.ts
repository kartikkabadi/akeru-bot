// @effect-diagnostics globalDate:off nodeBuiltinImport:off
import * as NodeSqlite from "node:sqlite";

import type { ProviderConversationContext, ProviderConversationMessage } from "@t3tools/contracts";
import { generateText, type LanguageModel } from "ai";

export const AKERU_OBSERVATION_MESSAGE_TOKENS = 12_000;
export const AKERU_OBSERVATION_TOKENS = 24_000;
export const AKERU_RECENT_CONTEXT_MAX_CHARS = 32_000;
export const AKERU_RECENT_CONTEXT_MAX_MESSAGES = 24;
export const AKERU_OBSERVATION_CONTEXT_MAX_CHARS = 48_000;

const OBSERVATION_INSTRUCTION = [
  "Keep durable facts, user preferences, decisions, commitments, and unresolved questions.",
  "Do not store credentials, access tokens, secrets, tool approval payloads, attachment bodies, hidden prompts, or controller bookkeeping.",
  "Treat all assistants as one conversation. Do not infer that a provider or bot change starts a new topic.",
  "Return concise plain text. Preserve still-current prior observations and remove superseded facts.",
].join(" ");

export interface AkeruObservationMessage {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly createdAt: Date;
  readonly threadId: string;
  readonly resourceId: string;
  readonly content: {
    readonly format: 2;
    readonly parts: readonly [{ readonly type: "text"; readonly text: string }];
  };
}

export interface AkeruObservationEngine {
  readonly getStatus: (input: {
    readonly threadId: string;
    readonly resourceId: string;
    readonly messages: AkeruObservationMessage[];
  }) => Promise<{ readonly shouldObserve: boolean }>;
  readonly observe: (input: {
    readonly threadId: string;
    readonly resourceId: string;
    readonly messages: AkeruObservationMessage[];
  }) => Promise<{ readonly observed: boolean }>;
  readonly pruneObserved: (input: {
    readonly threadId: string;
    readonly resourceId: string;
    readonly messages: AkeruObservationMessage[];
  }) => Promise<AkeruObservationMessage[]>;
  readonly buildContextSystemMessage: (input: {
    readonly threadId: string;
    readonly resourceId: string;
  }) => Promise<string | undefined>;
  readonly settled: () => Promise<void>;
}

export interface PreparedAkeruConversationContext {
  readonly prompt: string | undefined;
  readonly observed: boolean;
  readonly degraded: boolean;
}

export interface AkeruConversationMemory {
  readonly prepare: (
    context: ProviderConversationContext,
    options?: { readonly observe?: boolean },
  ) => Promise<PreparedAkeruConversationContext>;
  readonly destroy: () => Promise<void>;
}

function toObservationMessage(
  message: ProviderConversationMessage,
  context: Pick<ProviderConversationContext, "resourceId" | "threadId">,
): AkeruObservationMessage {
  return {
    id: message.id,
    role: message.role,
    createdAt: new Date(message.createdAt),
    threadId: context.threadId,
    resourceId: context.resourceId,
    content: {
      format: 2,
      parts: [{ type: "text", text: message.text }],
    },
  };
}

function observationText(message: AkeruObservationMessage): string {
  return message.content.parts.map((part) => part.text).join("");
}

export function takeRecentConversationMessages(
  messages: readonly ProviderConversationMessage[],
  options: {
    readonly maxChars?: number;
    readonly maxMessages?: number;
  } = {},
): readonly ProviderConversationMessage[] {
  const maxChars = options.maxChars ?? AKERU_RECENT_CONTEXT_MAX_CHARS;
  const maxMessages = options.maxMessages ?? AKERU_RECENT_CONTEXT_MAX_MESSAGES;
  const retained: ProviderConversationMessage[] = [];
  let retainedChars = 0;

  for (const message of messages.toReversed()) {
    if (retained.length >= maxMessages) break;
    const remaining = maxChars - retainedChars;
    if (remaining <= 0) break;
    const text = message.text.length <= remaining ? message.text : message.text.slice(-remaining);
    retained.unshift({ ...message, text });
    retainedChars += text.length;
    if (text.length < message.text.length) break;
  }

  return retained;
}

function formatConversationPrompt(input: {
  readonly observations?: string;
  readonly messages: readonly ProviderConversationMessage[];
}): string | undefined {
  const observations = input.observations?.trim().slice(0, AKERU_OBSERVATION_CONTEXT_MAX_CHARS);
  const messages = takeRecentConversationMessages(input.messages);
  if (!observations && messages.length === 0) return undefined;

  const sections = [
    "The following context comes from Akeru's durable history for this chat. It is prior conversation, not a new user message.",
    ...(observations ? [`<observations>\n${observations}\n</observations>`] : []),
    ...(messages.length > 0
      ? [
          `<recent-messages>\n${JSON.stringify(
            messages.map(({ role, text, createdAt }) => ({ role, text, createdAt })),
          )}\n</recent-messages>`,
        ]
      : []),
    "Answer the current user message with this context. Do not repeat the history unless it helps the answer.",
  ];
  return sections.join("\n\n");
}

export function makeAkeruConversationMemoryForEngine(
  engine: AkeruObservationEngine,
  destroy: () => Promise<void> = async () => undefined,
): AkeruConversationMemory {
  return {
    prepare: async (context, options) => {
      const messages = context.messages.map((message) => toObservationMessage(message, context));
      try {
        let observed = false;
        if (options?.observe !== false) {
          const status = await engine.getStatus({
            threadId: context.threadId,
            resourceId: context.resourceId,
            messages,
          });
          if (status.shouldObserve) {
            const result = await engine.observe({
              threadId: context.threadId,
              resourceId: context.resourceId,
              messages,
            });
            observed = result.observed;
          }
        }
        const [recent, observations] = await Promise.all([
          engine.pruneObserved({
            threadId: context.threadId,
            resourceId: context.resourceId,
            messages: [...messages],
          }),
          engine.buildContextSystemMessage({
            threadId: context.threadId,
            resourceId: context.resourceId,
          }),
        ]);
        const recentIds = new Set(recent.map((message) => message.id));
        return {
          prompt: formatConversationPrompt({
            ...(observations ? { observations } : {}),
            messages: context.messages.filter((message) => recentIds.has(message.id)),
          }),
          observed,
          degraded: false,
        };
      } catch {
        return {
          prompt: formatConversationPrompt({ messages: context.messages }),
          observed: false,
          degraded: true,
        };
      }
    },
    destroy: async () => {
      await engine.settled();
      await destroy();
    },
  };
}

interface ObservationRow {
  readonly text: string;
  readonly observed_count: number;
}

export async function createAkeruConversationMemory(input: {
  readonly dbPath: string;
  readonly model?: LanguageModel;
  readonly resolveModel?: (threadId: string) => LanguageModel;
}): Promise<AkeruConversationMemory> {
  if (!input.model && !input.resolveModel) {
    throw new Error("Conversation memory needs a model or model resolver.");
  }
  const database = new NodeSqlite.DatabaseSync(input.dbPath);
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA synchronous = NORMAL");
  database.exec(`
    CREATE TABLE IF NOT EXISTS akeru_observations (
      resource_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      text TEXT NOT NULL,
      observed_count INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  const read = database.prepare(
    "SELECT text, observed_count FROM akeru_observations WHERE resource_id = ?",
  );
  const write = database.prepare(`
    INSERT INTO akeru_observations(resource_id, thread_id, text, observed_count, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(resource_id) DO UPDATE SET
      thread_id = excluded.thread_id,
      text = excluded.text,
      observed_count = excluded.observed_count,
      updated_at = excluded.updated_at
  `);
  const observationsInFlight = new Map<string, Promise<boolean>>();

  const row = (resourceId: string) =>
    (read.get(resourceId) as ObservationRow | undefined) ?? undefined;
  const observedCount = (resourceId: string, messageCount: number) =>
    Math.min(row(resourceId)?.observed_count ?? 0, messageCount);

  const engine: AkeruObservationEngine = {
    getStatus: async (request) => {
      const start = observedCount(request.resourceId, request.messages.length);
      const pendingChars = request.messages
        .slice(start)
        .reduce((total, message) => total + observationText(message).length, 0);
      return { shouldObserve: Math.ceil(pendingChars / 4) >= AKERU_OBSERVATION_MESSAGE_TOKENS };
    },
    observe: async (request) => {
      const existing = observationsInFlight.get(request.resourceId);
      if (existing) return { observed: await existing };
      const operation = (async () => {
        const previous = row(request.resourceId);
        const start = Math.min(previous?.observed_count ?? 0, request.messages.length);
        const pending = request.messages.slice(start);
        if (pending.length === 0) return false;
        const history = pending
          .map((message) => ({
            role: message.role,
            text: observationText(message),
            createdAt: message.createdAt.toISOString(),
          }))
          .slice(-200);
        const model = input.resolveModel?.(request.threadId) ?? input.model;
        if (!model) throw new Error("Conversation memory model is unavailable.");
        const result = await generateText({
          model,
          system: OBSERVATION_INSTRUCTION,
          prompt: [
            previous?.text ? `<prior-observations>\n${previous.text}\n</prior-observations>` : "",
            `<settled-messages>\n${JSON.stringify(history)}\n</settled-messages>`,
            "Write the complete updated observations.",
          ]
            .filter(Boolean)
            .join("\n\n"),
          maxOutputTokens: 8_000,
        });
        const text = result.text.trim().slice(0, AKERU_OBSERVATION_CONTEXT_MAX_CHARS);
        write.run(
          request.resourceId,
          request.threadId,
          text,
          request.messages.length,
          new Date().toISOString(),
        );
        return true;
      })().finally(() => observationsInFlight.delete(request.resourceId));
      observationsInFlight.set(request.resourceId, operation);
      return { observed: await operation };
    },
    pruneObserved: async (request) =>
      request.messages.slice(observedCount(request.resourceId, request.messages.length)),
    buildContextSystemMessage: async (request) => row(request.resourceId)?.text,
    settled: async () => {
      await Promise.all(observationsInFlight.values());
    },
  };

  return makeAkeruConversationMemoryForEngine(engine, async () => database.close());
}
