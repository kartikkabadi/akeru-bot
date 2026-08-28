// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { McpServerId, type McpServer } from "@t3tools/contracts";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { McpOAuthStoreError } from "./McpOAuthStore.ts";
import {
  formatMcpDiscoveryFailure,
  McpOAuthFlowError,
  McpOAuthRuntime,
  validateMcpOAuthRedirectUrl,
  type McpOAuthDriver,
} from "./McpOAuth.ts";

const createdDirs = new Set<string>();

afterEach(() => {
  for (const directory of createdDirs) {
    NodeFS.rmSync(directory, { recursive: true, force: true });
  }
  createdDirs.clear();
});

function contextServer(): McpServer {
  return {
    id: McpServerId.make("builtin-context"),
    name: "Context.dev",
    transport: "url",
    url: "https://mcp.context.dev/mcp",
    authentication: "oauth",
    enabled: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function makeRuntime(overrides: Partial<McpOAuthDriver> = {}) {
  const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "akeru-mcp-oauth-"));
  createdDirs.add(directory);
  const driver: McpOAuthDriver = {
    start: vi.fn(async (input) => {
      const authorizationUrl = new URL("https://mcp.context.dev/authorize");
      authorizationUrl.searchParams.set("state", input.state);
      authorizationUrl.searchParams.set("redirect_uri", input.redirectUrl);
      return { status: "redirect" as const, authorizationUrl: authorizationUrl.toString() };
    }),
    complete: vi.fn(async (input) => {
      input.storage.set("tokens", JSON.stringify({ access_token: "context-access" }));
    }),
    discoverTools: vi.fn(async () => ["search", "fetch"]),
    accessToken: vi.fn(async (input) => {
      const raw = input.storage.get("tokens");
      return raw ? (JSON.parse(raw) as { access_token: string }).access_token : undefined;
    }),
    ...overrides,
  };
  const authPath = NodePath.join(directory, "mcp-oauth.json");
  return {
    authPath,
    driver,
    runtime: new McpOAuthRuntime(authPath, {
      driver,
      now: () => 1_000,
      randomUUID: () => "fixed-login-state",
    }),
  };
}

const callbackUrl = "http://localhost:5733/plugins/oauth/callback?environment=environment-test";

describe("McpOAuthRuntime", () => {
  it("refuses to overwrite invalid stored credentials", () => {
    const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "akeru-mcp-oauth-"));
    createdDirs.add(directory);
    const authPath = NodePath.join(directory, "mcp-oauth.json");
    NodeFS.writeFileSync(authPath, "not-json", { mode: 0o600 });

    expect(() => new McpOAuthRuntime(authPath)).toThrow(McpOAuthStoreError);
    expect(NodeFS.readFileSync(authPath, "utf8")).toBe("not-json");
  });

  it("accepts only the app callback path and an allowed client origin", () => {
    expect(validateMcpOAuthRedirectUrl(callbackUrl, ["http://localhost:5733"]).toString()).toBe(
      callbackUrl,
    );
    expect(() =>
      validateMcpOAuthRedirectUrl(
        "https://attacker.example/plugins/oauth/callback?environment=environment-test",
        ["http://localhost:5733"],
      ),
    ).toThrow(McpOAuthFlowError);
    expect(() =>
      validateMcpOAuthRedirectUrl("http://localhost:5733/other?environment=environment-test", [
        "http://localhost:5733",
      ]),
    ).toThrow(McpOAuthFlowError);
  });

  it("persists OAuth material under the secrets path and connects only after tool discovery", async () => {
    const { authPath, driver, runtime } = makeRuntime();
    const server = contextServer();

    const started = await runtime.start(server, callbackUrl, ["http://localhost:5733"]);
    expect(started).toMatchObject({
      status: "login-required",
      loginId: "fixed-login-state",
    });
    expect(runtime.statuses([server])).toEqual([{ mcpServerId: server.id, status: "connecting" }]);

    const completed = await runtime.complete(
      { code: "authorization-code", state: "fixed-login-state" },
      "http://localhost:5733",
    );
    expect(completed).toEqual({ status: "connected", toolCount: 2 });
    expect(driver.complete).toHaveBeenCalledOnce();
    expect(driver.discoverTools).toHaveBeenCalledOnce();
    expect(runtime.statuses([server])).toEqual([
      { mcpServerId: server.id, status: "connected", toolCount: 2 },
    ]);
    expect(NodeFS.existsSync(authPath)).toBe(true);
    expect(NodeFS.statSync(authPath).mode & 0o777).toBe(0o600);

    const prepared = await runtime.prepareRuntime([server]);
    expect(prepared.servers).toEqual([server]);
    expect(prepared.authorizationHeaders).toEqual({
      "builtin-context": "Bearer context-access",
    });
  });

  it("keeps login polling pending while tool discovery is in progress", async () => {
    let markDiscoveryStarted: (() => void) | undefined;
    let finishDiscovery: ((tools: readonly string[]) => void) | undefined;
    const discoveryStarted = new Promise<void>((resolve) => {
      markDiscoveryStarted = resolve;
    });
    const discoveryResult = new Promise<readonly string[]>((resolve) => {
      finishDiscovery = resolve;
    });
    const { runtime } = makeRuntime({
      discoverTools: vi.fn(async () => {
        markDiscoveryStarted?.();
        return discoveryResult;
      }),
    });
    const server = contextServer();
    const login = await runtime.start(server, callbackUrl, ["http://localhost:5733"]);
    expect(login).toMatchObject({ status: "login-required" });
    if (login.status !== "login-required") throw new TypeError("OAuth login did not start.");

    const completion = runtime.complete(
      { code: "authorization-code", state: "fixed-login-state" },
      "http://localhost:5733",
    );
    await discoveryStarted;

    expect(runtime.poll(login.loginId)).toEqual({ status: "pending", nextPollMs: 1_000 });
    finishDiscovery?.(["search"]);
    await expect(completion).resolves.toEqual({ status: "connected", toolCount: 1 });
  });

  it("lets optional OAuth plugins connect or run without authentication", async () => {
    const { runtime } = makeRuntime();
    const server = { ...contextServer(), authentication: "optional-oauth" as const };

    expect(runtime.statuses([server])).toEqual([
      { mcpServerId: server.id, status: "authentication-required" },
    ]);
    await expect(runtime.prepareRuntime([server])).resolves.toEqual({
      servers: [server],
      authorizationHeaders: {},
    });
    await expect(
      runtime.start(server, callbackUrl, ["http://localhost:5733"]),
    ).resolves.toMatchObject({ status: "login-required" });
  });

  it("blocks a required OAuth plugin until authorization completes", async () => {
    const { runtime } = makeRuntime();
    const server = contextServer();

    await expect(runtime.prepareRuntime([server])).rejects.toThrow(
      "Context.dev must be connected before this bot can use it.",
    );
    expect(runtime.statuses([server])).toEqual([
      { mcpServerId: server.id, status: "authentication-required" },
    ]);
  });

  it("disconnect clears stored credentials and pending logins", async () => {
    const { driver, runtime } = makeRuntime();
    const server = contextServer();

    // Connected plugin: disconnect drops the tokens and the runtime access.
    await runtime.start(server, callbackUrl, ["http://localhost:5733"]);
    await runtime.complete(
      { code: "authorization-code", state: "fixed-login-state" },
      "http://localhost:5733",
    );
    runtime.disconnect(server.id);
    expect(runtime.statuses([server])).toEqual([
      { mcpServerId: server.id, status: "authentication-required" },
    ]);
    await expect(runtime.prepareRuntime([server])).rejects.toThrow(
      "Context.dev must be connected before this bot can use it.",
    );

    // Stuck login: disconnect abandons the pending state instead of waiting
    // for the ten-minute expiry, so the old callback can no longer land.
    await runtime.start(server, callbackUrl, ["http://localhost:5733"]);
    expect(runtime.statuses([server])).toEqual([{ mcpServerId: server.id, status: "connecting" }]);
    runtime.disconnect(server.id);
    expect(runtime.statuses([server])).toEqual([
      { mcpServerId: server.id, status: "authentication-required" },
    ]);
    await expect(
      runtime.complete(
        { code: "authorization-code", state: "fixed-login-state" },
        "http://localhost:5733",
      ),
    ).rejects.toThrow(McpOAuthFlowError);
    expect(driver.complete).toHaveBeenCalledOnce();
  });

  it("reports a failed connection when authorization returns no tools", async () => {
    const { runtime } = makeRuntime({ discoverTools: vi.fn(async () => []) });
    const server = contextServer();
    await runtime.start(server, callbackUrl, ["http://localhost:5733"]);

    const result = await runtime.complete(
      { code: "authorization-code", state: "fixed-login-state" },
      "http://localhost:5733",
    );

    expect(result.status).toBe("failed");
    expect(runtime.statuses([server])[0]).toMatchObject({
      status: "failed",
    });
  });

  it("preserves a safe tool discovery failure", async () => {
    const reason = "Context.dev rejected the authorized MCP connection (HTTP 403).";
    const { runtime } = makeRuntime({
      discoverTools: vi.fn(async () => {
        throw new McpOAuthFlowError(reason);
      }),
    });
    const server = contextServer();
    await runtime.start(server, callbackUrl, ["http://localhost:5733"]);

    const result = await runtime.complete(
      { code: "authorization-code", state: "fixed-login-state" },
      "http://localhost:5733",
    );

    expect(result).toEqual({ status: "failed", error: reason });
    expect(runtime.statuses([server])).toEqual([
      { mcpServerId: server.id, status: "failed", error: reason },
    ]);
  });

  it("formats discovery failures without exposing response details", () => {
    expect(
      formatMcpDiscoveryFailure("Executor", {
        message: "request failed with a private upstream response",
        httpStatus: 403,
      }),
    ).toBe(
      "Executor rejected the authorized MCP connection (HTTP 403). Connect again and approve access.",
    );
    expect(
      formatMcpDiscoveryFailure("Executor", {
        message: "connection timed out with private request context",
        code: "ETIMEDOUT",
      }),
    ).toBe("Executor did not respond during tool discovery. Connect again.");
  });

  it("rejects callback state and origin mismatches", async () => {
    const { runtime } = makeRuntime();
    const server = contextServer();
    await runtime.start(server, callbackUrl, ["http://localhost:5733"]);

    await expect(
      runtime.complete({ code: "authorization-code", state: "wrong-state" }, callbackUrl),
    ).rejects.toThrow(McpOAuthFlowError);
    await expect(
      runtime.complete(
        { code: "authorization-code", state: "fixed-login-state" },
        "https://attacker.example",
      ),
    ).rejects.toThrow(McpOAuthFlowError);
  });
});
