// @effect-diagnostics nodeBuiltinImport:off
import { describe, expect, it } from "vite-plus/test";

import {
  buildAnthropicOAuthFetch,
  buildCodexOAuthFetch,
  buildXAIOAuthFetch,
  createAkeruLanguageModel,
  type AkeruFetch,
  type AkeruModelProvider,
  type AkeruTokenSource,
} from "./AkeruModelAdapters.ts";

function tokenSource(): AkeruTokenSource {
  const credentials = {
    codex: { accessToken: "codex-token", accountId: "account-123" },
    claudeAgent: { accessToken: "claude-token" },
    grok: { accessToken: "grok-token" },
  } as const;
  return {
    getCredential: async (provider: AkeruModelProvider) => credentials[provider],
  };
}

function recordingFetch() {
  const calls: Array<{
    readonly input: string | URL | Request;
    readonly init?: RequestInit;
  }> = [];
  const fetchImpl: AkeruFetch = async (input, init) => {
    calls.push({ input, ...(init ? { init } : {}) });
    return new Response("{}", { status: 200 });
  };
  return { calls, fetchImpl };
}

describe("Akeru model adapters", () => {
  it("rewrites Codex Responses requests and injects subscription metadata", async () => {
    const recording = recordingFetch();
    await buildCodexOAuthFetch(tokenSource(), recording.fetchImpl)(
      "https://api.openai.com/v1/responses",
      { headers: { Authorization: "Bearer stale", "x-request-id": "request-1" } },
    );

    const call = recording.calls[0];
    expect(String(call?.input)).toBe("https://chatgpt.com/backend-api/codex/responses");
    const headers = new Headers(call?.init?.headers);
    expect(headers.get("authorization")).toBe("Bearer codex-token");
    expect(headers.get("chatgpt-account-id")).toBe("account-123");
    expect(headers.get("originator")).toBe("akeru");
    expect(headers.get("user-agent")).toBe("akeru");
    expect(headers.get("x-request-id")).toBe("request-1");
  });

  it("adds the Claude subscription beta and version headers", async () => {
    const recording = recordingFetch();
    await buildAnthropicOAuthFetch(tokenSource(), recording.fetchImpl)(
      "https://api.anthropic.com/v1/messages",
      { headers: { "anthropic-beta": "existing-beta", "x-api-key": "stale" } },
    );

    const headers = new Headers(recording.calls[0]?.init?.headers);
    expect(headers.get("authorization")).toBe("Bearer claude-token");
    expect(headers.get("x-api-key")).toBeNull();
    expect(headers.get("anthropic-version")).toBe("2023-06-01");
    expect(headers.get("anthropic-beta")).toContain("oauth-2025-04-20");
    expect(headers.get("anthropic-beta")).toContain("claude-code-20250219");
    expect(headers.get("anthropic-beta")).toContain("existing-beta");
  });

  it("uses the xAI OAuth bearer without leaking placeholder credentials", async () => {
    const recording = recordingFetch();
    await buildXAIOAuthFetch(tokenSource(), recording.fetchImpl)(
      "https://api.x.ai/v1/chat/completions",
      { headers: { Authorization: "Bearer placeholder", "x-api-key": "placeholder" } },
    );

    const headers = new Headers(recording.calls[0]?.init?.headers);
    expect(headers.get("authorization")).toBe("Bearer grok-token");
    expect(headers.get("x-api-key")).toBeNull();
  });

  it("constructs provider models without Mastra provider factories", () => {
    expect(
      createAkeruLanguageModel({ provider: "codex", model: "gpt-5.6-sol", tokens: tokenSource() })
        .modelId,
    ).toBe("gpt-5.6-sol");
    expect(
      createAkeruLanguageModel({
        provider: "claudeAgent",
        model: "claude-fable-5",
        tokens: tokenSource(),
      }).modelId,
    ).toBe("claude-fable-5");
    expect(
      createAkeruLanguageModel({ provider: "grok", model: "grok-4.6", tokens: tokenSource() })
        .modelId,
    ).toBe("grok-4.6");
  });

  it("fails closed when the selected subscription is disconnected", async () => {
    const recording = recordingFetch();
    const disconnected: AkeruTokenSource = { getCredential: async () => undefined };
    await expect(
      buildCodexOAuthFetch(
        disconnected,
        recording.fetchImpl,
      )("https://api.openai.com/v1/responses"),
    ).rejects.toThrow("Connect codex");
    expect(recording.calls).toHaveLength(0);
  });
});
