// @effect-diagnostics nodeBuiltinImport:off globalDate:off
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeOS from "node:os";
import * as NodeCrypto from "node:crypto";
import { describe, expect, it } from "vite-plus/test";

import {
  SubscriptionAuthService,
  subscriptionProviderSettingsPatch,
  subscriptionProviderSettingsPatchFor,
} from "./service.ts";

function fixture() {
  const directory = NodePath.join(
    NodeOS.tmpdir(),
    `akeru-subscription-auth-${NodeCrypto.randomUUID()}`,
  );
  NodeFS.mkdirSync(directory, { recursive: true });
  const authPath = NodePath.join(directory, "subscription-auth.json");
  return { directory, authPath };
}

describe("subscription auth storage", () => {
  it("maps connected subscriptions to picker provider settings", () => {
    expect(
      subscriptionProviderSettingsPatch([
        { provider: "openai-codex", connected: true },
        { provider: "anthropic", connected: true },
        { provider: "cursor", connected: true },
        { provider: "xai", connected: true },
        { provider: "kimi-for-coding", connected: false },
      ]),
    ).toEqual({
      providers: {
        codex: { enabled: true },
        claudeAgent: { enabled: true },
        cursor: { enabled: true },
        grok: { enabled: true },
      },
    });
  });

  it("updates only the subscription whose connection changed", () => {
    expect(subscriptionProviderSettingsPatchFor("cursor", false)).toEqual({
      providers: { cursor: { enabled: false } },
    });
    expect(
      subscriptionProviderSettingsPatch([
        { provider: "openai-codex", connected: false },
        { provider: "xai", connected: true },
      ]),
    ).toEqual({ providers: { grok: { enabled: true } } });
  });

  it("loads provider status without exposing tokens", () => {
    const { authPath } = fixture();
    NodeFS.writeFileSync(
      authPath,
      JSON.stringify({
        anthropic: {
          type: "oauth",
          access: "secret-access",
          refresh: "secret-refresh",
          expires: 1_800_000_000_000,
        },
      }),
    );

    const service = new SubscriptionAuthService(authPath);
    const anthropic = service.statuses().find((status) => status.provider === "anthropic");
    expect(anthropic).toEqual({
      provider: "anthropic",
      connected: true,
      expiresAt: 1_800_000_000_000,
    });
    expect(JSON.stringify(service.statuses())).not.toContain("secret-access");
    expect(JSON.stringify(service.statuses())).not.toContain("secret-refresh");
  });

  it("returns a still-valid access token without rewriting storage", async () => {
    const { authPath } = fixture();
    NodeFS.writeFileSync(
      authPath,
      JSON.stringify({
        xai: {
          type: "oauth",
          access: "short-lived-access",
          refresh: "never-return-this",
          expires: Date.now() + 60_000,
        },
      }),
    );
    const before = NodeFS.readFileSync(authPath, "utf-8");
    const service = new SubscriptionAuthService(authPath);
    await expect(service.getAccessToken("xai")).resolves.toBe("short-lived-access");
    expect(NodeFS.readFileSync(authPath, "utf-8")).toBe(before);
  });

  it("returns request credentials without refresh-token access", async () => {
    const { authPath } = fixture();
    NodeFS.writeFileSync(
      authPath,
      JSON.stringify({
        "openai-codex": {
          type: "oauth",
          access: "codex-access",
          refresh: "codex-refresh",
          expires: Date.now() + 60_000,
          accountId: "account-123",
        },
      }),
    );
    const service = new SubscriptionAuthService(authPath);

    await expect(service.getRuntimeCredential("openai-codex")).resolves.toEqual({
      accessToken: "codex-access",
      accountId: "account-123",
    });
    expect(JSON.stringify(await service.getRuntimeCredential("openai-codex"))).not.toContain(
      "codex-refresh",
    );
  });

  it("persists pending logins across a server restart", async () => {
    const { authPath } = fixture();
    const first = new SubscriptionAuthService(authPath);
    const started = await first.startLogin("anthropic");

    const restarted = new SubscriptionAuthService(authPath);
    const result = await restarted.completeLogin(started.loginId, "invalid-code");
    expect(result).toEqual({ status: "failed", error: "Invalid authorization state" });
    expect(NodeFS.statSync(`${authPath}.pending`).mode & 0o777).toBe(0o600);
  });

  it("does not restore stale credentials from another client", () => {
    const { authPath } = fixture();
    NodeFS.writeFileSync(
      authPath,
      JSON.stringify({
        "openai-codex": { type: "oauth", access: "a", refresh: "r", expires: 1 },
        cursor: { type: "oauth", access: "b", refresh: "s", expires: 1 },
      }),
    );
    const first = new SubscriptionAuthService(authPath);
    const second = new SubscriptionAuthService(authPath);

    first.logout("openai-codex");
    second.logout("cursor");

    expect(JSON.parse(NodeFS.readFileSync(authPath, "utf-8"))).toEqual({});
  });

  it("logs out atomically and secures the rewritten file", () => {
    const { authPath } = fixture();
    NodeFS.writeFileSync(
      authPath,
      JSON.stringify({
        cursor: { type: "oauth", access: "a", refresh: "r", expires: 1 },
      }),
    );
    const service = new SubscriptionAuthService(authPath);
    service.logout("cursor");
    expect(JSON.parse(NodeFS.readFileSync(authPath, "utf-8"))).toEqual({});
    expect(NodeFS.statSync(authPath).mode & 0o777).toBe(0o600);
  });
});
