// @effect-diagnostics globalFetch:off
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { wrapLanguageModel, type LanguageModelMiddleware } from "ai";

import type {
  SubscriptionAuthService,
  SubscriptionRuntimeCredential,
} from "../subscription-auth/service.ts";

export type AkeruModelProvider = "codex" | "claudeAgent" | "grok";

export interface AkeruTokenSource {
  readonly getCredential: (
    provider: AkeruModelProvider,
  ) => Promise<SubscriptionRuntimeCredential | undefined>;
}

const subscriptionProvider = {
  codex: "openai-codex",
  claudeAgent: "anthropic",
  grok: "xai",
} as const;

export function subscriptionTokenSource(service: SubscriptionAuthService): AkeruTokenSource {
  return {
    getCredential: (provider) => service.getRuntimeCredential(subscriptionProvider[provider]),
  };
}

export type AkeruFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const defaultFetch: AkeruFetch = (input, init) => fetch(input, init);

function requestHeaders(input: string | URL | Request, init?: RequestInit): Headers {
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  if (init?.headers) {
    new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  }
  headers.delete("authorization");
  headers.delete("x-api-key");
  return headers;
}

async function requiredCredential(
  source: AkeruTokenSource,
  provider: AkeruModelProvider,
): Promise<SubscriptionRuntimeCredential> {
  const credential = await source.getCredential(provider);
  if (!credential) throw new Error(`Connect ${provider} before starting an Akeru session.`);
  return credential;
}

export function buildCodexOAuthFetch(
  source: AkeruTokenSource,
  fetchImpl: AkeruFetch = defaultFetch,
): AkeruFetch {
  return async (input, init) => {
    const credential = await requiredCredential(source, "codex");
    const headers = requestHeaders(input, init);
    headers.set("Authorization", `Bearer ${credential.accessToken}`);
    headers.set("originator", "akeru");
    headers.set("User-Agent", "akeru");
    if (credential.accountId) headers.set("ChatGPT-Account-ID", credential.accountId);
    const sourceUrl = input instanceof Request ? input.url : input.toString();
    const parsed = new URL(sourceUrl);
    const url =
      parsed.pathname.includes("/v1/responses") || parsed.pathname.includes("/chat/completions")
        ? "https://chatgpt.com/backend-api/codex/responses"
        : parsed.toString();
    return fetchImpl(url, { ...init, headers });
  };
}

const ANTHROPIC_OAUTH_BETAS = [
  "oauth-2025-04-20",
  "claude-code-20250219",
  "interleaved-thinking-2025-05-14",
  "fine-grained-tool-streaming-2025-05-14",
] as const;

export function buildAnthropicOAuthFetch(
  source: AkeruTokenSource,
  fetchImpl: AkeruFetch = defaultFetch,
): AkeruFetch {
  return async (input, init) => {
    const credential = await requiredCredential(source, "claudeAgent");
    const headers = requestHeaders(input, init);
    const existingBetas = (headers.get("anthropic-beta") ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    headers.set("Authorization", `Bearer ${credential.accessToken}`);
    headers.set(
      "anthropic-beta",
      [...new Set([...ANTHROPIC_OAUTH_BETAS, ...existingBetas])].join(","),
    );
    headers.set("anthropic-version", "2023-06-01");
    return fetchImpl(input, { ...init, headers });
  };
}

export function buildXAIOAuthFetch(
  source: AkeruTokenSource,
  fetchImpl: AkeruFetch = defaultFetch,
): AkeruFetch {
  return async (input, init) => {
    const credential = await requiredCredential(source, "grok");
    const headers = requestHeaders(input, init);
    headers.set("Authorization", `Bearer ${credential.accessToken}`);
    return fetchImpl(input, { ...init, headers });
  };
}

const claudeSubscriptionIdentity: LanguageModelMiddleware = {
  specificationVersion: "v3",
  transformParams: async ({ params }) => ({
    ...params,
    prompt: [
      {
        role: "system",
        content: "You are Claude Code, Anthropic's official CLI for Claude.",
      },
      ...params.prompt,
    ],
  }),
};

export function createAkeruLanguageModel(input: {
  readonly provider: AkeruModelProvider;
  readonly model: string;
  readonly tokens: AkeruTokenSource;
}) {
  switch (input.provider) {
    case "codex":
      return createOpenAI({
        name: "akeru-codex",
        apiKey: "oauth-placeholder",
        fetch: buildCodexOAuthFetch(input.tokens) as typeof fetch,
      }).responses(input.model);
    case "claudeAgent":
      return wrapLanguageModel({
        model: createAnthropic({
          apiKey: "oauth-placeholder",
          fetch: buildAnthropicOAuthFetch(input.tokens) as typeof fetch,
        })(input.model),
        middleware: claudeSubscriptionIdentity,
      });
    case "grok":
      return createOpenAICompatible({
        name: "xai",
        baseURL: "https://api.x.ai/v1",
        apiKey: "oauth-placeholder",
        fetch: buildXAIOAuthFetch(input.tokens) as typeof fetch,
      }).chatModel(input.model);
  }
}
