// @effect-diagnostics globalDate:off nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
import * as NodePath from "node:path";
import * as NodeTimersPromises from "node:timers/promises";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { auth, type OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import {
  McpAuthError,
  type McpAuthCompleteInput,
  type McpAuthConnectionStatus,
  type McpAuthLoginProgress,
  type McpAuthStartResult,
  type McpServer,
  McpServerId,
} from "@t3tools/contracts";

import {
  McpOAuthStore,
  type StoredConnection,
  type StoredMcpOAuthData,
  type StoredPendingLogin,
} from "./McpOAuthStore.ts";

const CALLBACK_PATH = "/plugins/oauth/callback";
const LOGIN_TIMEOUT_MS = 10 * 60_000;
const NEXT_POLL_MS = 1_000;
const SECRET_FILE_NAME = "mcp-oauth.json";
const MAX_PENDING_LOGINS = 16;
const DISCOVERY_TIMEOUT_MS = 30_000;
const DISCOVERY_DISCONNECT_TIMEOUT_MS = 1_000;

export class McpOAuthFlowError extends Error {
  readonly _tag = "McpOAuthFlowError";
  readonly reason: string;

  constructor(reason: string) {
    super(reason);
    this.reason = reason;
  }
}

export interface OAuthStorage {
  readonly get: (name: string) => string | undefined;
  readonly set: (name: string, value: string) => void;
  readonly delete: (name: string) => void;
}

export interface McpOAuthDriverInput {
  readonly mcpServerId: McpServerId;
  readonly serverUrl: string;
  readonly serverName: string;
  readonly redirectUrl: string;
  readonly state: string;
  readonly storage: OAuthStorage;
}

export interface McpOAuthDriver {
  readonly start: (
    input: McpOAuthDriverInput,
  ) => Promise<
    | { readonly status: "authorized" }
    | { readonly status: "redirect"; readonly authorizationUrl: string }
  >;
  readonly complete: (
    input: McpOAuthDriverInput & {
      readonly code: string;
      readonly iss?: string;
    },
  ) => Promise<void>;
  readonly discoverTools: (input: McpOAuthDriverInput) => Promise<readonly string[]>;
  readonly accessToken: (input: McpOAuthDriverInput) => Promise<string | undefined>;
}

const CLIENT_INFORMATION_KEY = "client_info";
const TOKENS_KEY = "tokens";
const CODE_VERIFIER_KEY = "code_verifier";

class AkeruMcpOAuthProvider implements OAuthClientProvider {
  readonly redirectUrl: string;
  readonly clientMetadata: OAuthClientMetadata;
  private readonly input: McpOAuthDriverInput;
  private readonly onAuthorizationUrl: (url: URL) => void;

  constructor(input: McpOAuthDriverInput, onAuthorizationUrl?: (url: URL) => void) {
    this.input = input;
    this.redirectUrl = input.redirectUrl;
    this.clientMetadata = {
      redirect_uris: [input.redirectUrl],
      client_name: "Akeru Bot",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
    this.onAuthorizationUrl = onAuthorizationUrl ?? (() => undefined);
  }

  state(): string {
    return this.input.state;
  }

  clientInformation(): OAuthClientInformationMixed | undefined {
    const value = this.input.storage.get(CLIENT_INFORMATION_KEY);
    return value ? (JSON.parse(value) as OAuthClientInformationMixed) : undefined;
  }

  saveClientInformation(value: OAuthClientInformationMixed): void {
    this.input.storage.set(CLIENT_INFORMATION_KEY, JSON.stringify(value));
  }

  tokens(): OAuthTokens | undefined {
    const value = this.input.storage.get(TOKENS_KEY);
    return value ? (JSON.parse(value) as OAuthTokens) : undefined;
  }

  saveTokens(value: OAuthTokens): void {
    this.input.storage.set(TOKENS_KEY, JSON.stringify(value));
  }

  redirectToAuthorization(url: URL): void {
    this.onAuthorizationUrl(url);
  }

  saveCodeVerifier(value: string): void {
    this.input.storage.set(CODE_VERIFIER_KEY, value);
  }

  codeVerifier(): string {
    const value = this.input.storage.get(CODE_VERIFIER_KEY);
    if (!value) throw new McpOAuthFlowError("The MCP OAuth code verifier is missing.");
    return value;
  }

  invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier"): void {
    if (scope === "all" || scope === "client") this.input.storage.delete(CLIENT_INFORMATION_KEY);
    if (scope === "all" || scope === "tokens") this.input.storage.delete(TOKENS_KEY);
    if (scope === "all" || scope === "verifier") this.input.storage.delete(CODE_VERIFIER_KEY);
  }
}

function makeProvider(input: McpOAuthDriverInput, onAuthorizationUrl?: (url: URL) => void) {
  return new AkeruMcpOAuthProvider(input, onAuthorizationUrl);
}

async function disconnectDiscoveryClient(client: Client): Promise<void> {
  const timeout = new AbortController();
  try {
    await Promise.race([
      client.close().catch(() => undefined),
      NodeTimersPromises.setTimeout(DISCOVERY_DISCONNECT_TIMEOUT_MS, undefined, {
        signal: timeout.signal,
        ref: false,
      }).catch(() => undefined),
    ]);
  } finally {
    timeout.abort();
  }
}

export const akeruMcpOAuthDriver: McpOAuthDriver = {
  async start(input) {
    let authorizationUrl: URL | undefined;
    const provider = makeProvider(input, (url) => {
      authorizationUrl = url;
    });
    const result = await auth(provider, { serverUrl: input.serverUrl });
    if (result === "AUTHORIZED") return { status: "authorized" };
    if (!authorizationUrl) {
      throw new McpOAuthFlowError("The OAuth server did not return an authorization URL.");
    }
    return { status: "redirect", authorizationUrl: authorizationUrl.toString() };
  },

  async complete(input) {
    const provider = makeProvider(input);
    const result = await auth(provider, {
      serverUrl: input.serverUrl,
      authorizationCode: input.code,
    });
    if (result !== "AUTHORIZED") {
      throw new McpOAuthFlowError("The OAuth server did not accept the authorization code.");
    }
  },

  async discoverTools(input) {
    const provider = makeProvider(input);
    const client = new Client({
      name: `akeru-mcp-oauth-${input.mcpServerId}`,
      version: "1.0.0",
    });
    const transport = new StreamableHTTPClientTransport(new URL(input.serverUrl), {
      authProvider: provider,
    });
    try {
      await client.connect(transport as Parameters<typeof client.connect>[0], {
        timeout: DISCOVERY_TIMEOUT_MS,
      });
      const result = await client.listTools(undefined, { timeout: DISCOVERY_TIMEOUT_MS });
      return result.tools.map((tool) => tool.name);
    } catch (cause) {
      throw new McpOAuthFlowError(
        formatMcpDiscoveryFailure(input.serverName, {
          message: cause instanceof Error ? cause.message : String(cause),
        }),
      );
    } finally {
      await disconnectDiscoveryClient(client);
    }
  },

  async accessToken(input) {
    const provider = makeProvider(input);
    const result = await auth(provider, { serverUrl: input.serverUrl });
    if (result !== "AUTHORIZED") return undefined;
    return (await provider.tokens())?.access_token;
  },
};

function normalizeOrigin(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
      return undefined;
    }
    return url.origin;
  } catch {
    return undefined;
  }
}

export function validateMcpOAuthRedirectUrl(
  redirectUrl: string,
  allowedOrigins: readonly string[],
): URL {
  let parsed: URL;
  try {
    parsed = new URL(redirectUrl);
  } catch {
    throw new McpOAuthFlowError("OAuth callback URL must be an absolute HTTP or HTTPS URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new McpOAuthFlowError("OAuth callback URL must use HTTP or HTTPS.");
  }
  if (parsed.username || parsed.password || parsed.hash) {
    throw new McpOAuthFlowError("OAuth callback URL contains unsupported URL fields.");
  }
  if (parsed.pathname !== CALLBACK_PATH) {
    throw new McpOAuthFlowError(`OAuth callback URL must use ${CALLBACK_PATH}.`);
  }
  const queryKeys = [...parsed.searchParams.keys()];
  const environmentId = parsed.searchParams.get("environment");
  if (
    queryKeys.length !== 1 ||
    queryKeys[0] !== "environment" ||
    !environmentId ||
    environmentId.length > 128
  ) {
    throw new McpOAuthFlowError("OAuth callback URL must identify one Akeru environment.");
  }
  const origins = new Set(
    allowedOrigins.map(normalizeOrigin).filter((value) => value !== undefined),
  );
  if (!origins.has(parsed.origin)) {
    throw new McpOAuthFlowError("OAuth callback origin does not match this Akeru client.");
  }
  return parsed;
}

function validateAuthorizationUrl(
  authorizationUrl: string,
  expectedState: string,
  expectedRedirectUrl: string,
): string {
  let parsed: URL;
  try {
    parsed = new URL(authorizationUrl);
  } catch {
    throw new McpOAuthFlowError("The OAuth server returned an invalid authorization URL.");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.hash ||
    parsed.searchParams.get("state") !== expectedState ||
    parsed.searchParams.get("redirect_uri") !== expectedRedirectUrl
  ) {
    throw new McpOAuthFlowError("The OAuth server returned an unsafe authorization URL.");
  }
  return parsed.toString();
}

function oauthServer(server: McpServer): server is Extract<McpServer, { transport: "url" }> {
  return (
    server.transport === "url" &&
    (server.authentication === "oauth" || server.authentication === "optional-oauth")
  );
}

function safeStartFailure(serverName: string): string {
  return `Could not start ${serverName} authorization. Check the server connection and try again.`;
}

function safeCompletionFailure(serverName: string): string {
  return `${serverName} did not accept the authorization callback. Start the connection again.`;
}

export function formatMcpDiscoveryFailure(
  serverName: string,
  detail:
    | {
        readonly message: string;
        readonly httpStatus?: number;
        readonly code?: string | number;
      }
    | undefined,
): string {
  if (detail?.httpStatus === 401 || detail?.httpStatus === 403) {
    return `${serverName} rejected the authorized MCP connection (HTTP ${detail.httpStatus}). Connect again and approve access.`;
  }
  if (detail?.httpStatus === 429) {
    return `${serverName} rate-limited tool discovery (HTTP 429). Wait a moment and connect again.`;
  }
  if (
    detail?.code === "ETIMEDOUT" ||
    detail?.code === "UND_ERR_CONNECT_TIMEOUT" ||
    detail?.message.toLowerCase().includes("timeout") ||
    detail?.message.toLowerCase().includes("timed out")
  ) {
    return `${serverName} did not respond during tool discovery. Connect again.`;
  }
  if (detail?.httpStatus !== undefined) {
    return `${serverName} tool discovery failed (HTTP ${detail.httpStatus}). Connect again.`;
  }
  return `${serverName} authorization succeeded, but tool discovery failed. Connect again.`;
}

function safeRuntimeFailure(serverName: string): string {
  return `${serverName} credentials expired or were rejected. Connect the plugin again.`;
}

export interface PreparedMcpRuntime {
  readonly servers: readonly McpServer[];
  readonly authorizationHeaders: Readonly<Record<string, string>>;
}

export interface McpOAuthRuntimeOptions {
  readonly driver?: McpOAuthDriver;
  readonly now?: () => number;
  readonly randomUUID?: () => string;
}

export class McpOAuthRuntime {
  private static readonly bySecretsDir = new Map<string, McpOAuthRuntime>();

  static forSecretsDir(secretsDir: string): McpOAuthRuntime {
    const authPath = NodePath.join(secretsDir, SECRET_FILE_NAME);
    const existing = this.bySecretsDir.get(authPath);
    if (existing) return existing;
    const runtime = new McpOAuthRuntime(authPath);
    this.bySecretsDir.set(authPath, runtime);
    return runtime;
  }

  private readonly store: McpOAuthStore;
  private readonly driver: McpOAuthDriver;
  private readonly now: () => number;
  private readonly randomUUID: () => string;

  constructor(authPath: string, options: McpOAuthRuntimeOptions = {}) {
    this.driver = options.driver ?? akeruMcpOAuthDriver;
    this.now = options.now ?? Date.now;
    this.randomUUID = options.randomUUID ?? NodeCrypto.randomUUID;
    this.store = new McpOAuthStore(authPath, this.randomUUID);
  }

  private read(): StoredMcpOAuthData {
    return this.store.read();
  }

  private write(data: StoredMcpOAuthData): void {
    this.store.write(data);
  }

  private storage(mcpServerId: McpServerId): OAuthStorage {
    const key = String(mcpServerId);
    return {
      get: (name) => this.read().connections[key]?.storage[name],
      set: (name, value) => {
        const data = this.read();
        const connection = data.connections[key];
        if (!connection) {
          throw new McpOAuthFlowError("The MCP OAuth connection no longer exists.");
        }
        this.write({
          ...data,
          connections: {
            ...data.connections,
            [key]: {
              ...connection,
              storage: { ...connection.storage, [name]: value },
            },
          },
        });
      },
      delete: (name) => {
        const data = this.read();
        const connection = data.connections[key];
        if (!connection) return;
        const storage = { ...connection.storage };
        delete storage[name];
        this.write({
          ...data,
          connections: {
            ...data.connections,
            [key]: { ...connection, storage },
          },
        });
      },
    };
  }

  private driverInput(
    mcpServerId: McpServerId,
    connection: StoredConnection,
    redirectUrl: string,
    state: string,
  ): McpOAuthDriverInput {
    return {
      mcpServerId,
      serverUrl: connection.serverUrl,
      serverName: connection.serverName,
      redirectUrl,
      state,
      storage: this.storage(mcpServerId),
    };
  }

  private setFailed(mcpServerId: McpServerId, reason: string): void {
    const data = this.read();
    const key = String(mcpServerId);
    const connection = data.connections[key];
    if (!connection) return;
    this.write({
      ...data,
      connections: {
        ...data.connections,
        [key]: {
          ...connection,
          status: "failed",
          error: reason,
          toolCount: undefined,
          updatedAt: this.now(),
        },
      },
    });
  }

  private expirePending(data: StoredMcpOAuthData): StoredMcpOAuthData {
    const now = this.now();
    let changed = false;
    const next = { ...data, pendingByState: { ...data.pendingByState } };
    for (const [state, pending] of Object.entries(data.pendingByState)) {
      if (pending.expiresAt > now) continue;
      changed = true;
      delete next.pendingByState[state];
      const connection = next.connections[pending.mcpServerId];
      if (connection?.status === "connecting") {
        next.connections = {
          ...next.connections,
          [pending.mcpServerId]: {
            ...connection,
            status: "failed",
            error: "Authorization timed out. Connect the plugin again.",
            updatedAt: now,
          },
        };
      }
    }
    if (changed) this.write(next);
    return next;
  }

  statuses(servers: readonly McpServer[]): readonly McpAuthConnectionStatus[] {
    const data = this.expirePending(this.read());
    return servers.map((server): McpAuthConnectionStatus => {
      if (!server.enabled || !oauthServer(server)) {
        return { mcpServerId: server.id, status: "installed" };
      }
      const connection = data.connections[String(server.id)];
      if (!connection || connection.serverUrl !== server.url) {
        return { mcpServerId: server.id, status: "authentication-required" };
      }
      switch (connection.status) {
        case "connecting":
          return { mcpServerId: server.id, status: "connecting" };
        case "connected":
          return {
            mcpServerId: server.id,
            status: "connected",
            toolCount: connection.toolCount ?? 0,
          };
        case "failed":
          return {
            mcpServerId: server.id,
            status: "failed",
            error: connection.error ?? "Connection failed. Try again.",
          };
        case "authentication-required":
          return { mcpServerId: server.id, status: "authentication-required" };
      }
    });
  }

  async start(
    server: McpServer,
    redirectUrl: string,
    allowedOrigins: readonly string[],
  ): Promise<McpAuthStartResult> {
    if (!server.enabled) {
      throw new McpOAuthFlowError(`Enable ${server.name} before connecting it.`);
    }
    if (!oauthServer(server)) {
      throw new McpOAuthFlowError(`${server.name} does not require OAuth.`);
    }
    const parsedRedirect = validateMcpOAuthRedirectUrl(redirectUrl, allowedOrigins);
    const state = this.randomUUID();
    const loginId = this.randomUUID();
    const key = String(server.id);
    const data = this.expirePending(this.read());
    const pendingByState = Object.fromEntries(
      Object.entries(data.pendingByState).filter(([, pending]) => pending.mcpServerId !== key),
    );
    const connection: StoredConnection = {
      serverUrl: server.url,
      serverName: server.name,
      redirectUrl: parsedRedirect.toString(),
      currentLoginId: loginId,
      storage: data.connections[key]?.serverUrl === server.url ? data.connections[key].storage : {},
      status: "connecting",
      updatedAt: this.now(),
    };
    this.write({
      ...data,
      connections: { ...data.connections, [key]: connection },
      pendingByState,
    });

    const input = this.driverInput(server.id, connection, parsedRedirect.toString(), state);
    let started: Awaited<ReturnType<McpOAuthDriver["start"]>>;
    try {
      started = await this.driver.start(input);
    } catch {
      const reason = safeStartFailure(server.name);
      this.setFailed(server.id, reason);
      throw new McpOAuthFlowError(reason);
    }

    if (started.status === "authorized") {
      return this.discoverAndConnect(server.id, connection, parsedRedirect.toString(), state);
    }

    let authorizationUrl: string;
    try {
      authorizationUrl = validateAuthorizationUrl(
        started.authorizationUrl,
        state,
        parsedRedirect.toString(),
      );
    } catch {
      const reason = safeStartFailure(server.name);
      this.setFailed(server.id, reason);
      throw new McpOAuthFlowError(reason);
    }
    const pending: StoredPendingLogin = {
      loginId,
      mcpServerId: key,
      serverUrl: server.url,
      serverName: server.name,
      redirectUrl: parsedRedirect.toString(),
      expiresAt: this.now() + LOGIN_TIMEOUT_MS,
    };
    const latest = this.read();
    const entries = [...Object.entries(latest.pendingByState), [state, pending] as const].slice(
      -MAX_PENDING_LOGINS,
    );
    this.write({ ...latest, pendingByState: Object.fromEntries(entries) });
    return { status: "login-required", loginId, authorizationUrl };
  }

  serverIdForState(state: string): McpServerId | undefined {
    const pending = this.expirePending(this.read()).pendingByState[state];
    return pending ? McpServerId.make(pending.mcpServerId) : undefined;
  }

  async complete(
    input: McpAuthCompleteInput,
    callbackOrigin: string,
  ): Promise<McpAuthLoginProgress> {
    const data = this.expirePending(this.read());
    const pending = data.pendingByState[input.state];
    if (!pending) {
      throw new McpOAuthFlowError("OAuth state is invalid or expired. Start the connection again.");
    }
    if (new URL(pending.redirectUrl).origin !== callbackOrigin) {
      throw new McpOAuthFlowError("OAuth callback origin does not match the connection request.");
    }
    const mcpServerId = McpServerId.make(pending.mcpServerId);
    if ("error" in input) {
      const reason = "Authorization was canceled or denied. Connect the plugin again.";
      this.removePending(input.state);
      this.setFailed(mcpServerId, reason);
      return { status: "failed", error: reason };
    }
    const connection = data.connections[pending.mcpServerId];
    if (!connection || connection.serverUrl !== pending.serverUrl) {
      throw new McpOAuthFlowError("The MCP server changed during authorization. Start again.");
    }
    const driverInput = this.driverInput(mcpServerId, connection, pending.redirectUrl, input.state);
    try {
      await this.driver.complete({
        ...driverInput,
        code: input.code,
        ...(input.iss ? { iss: input.iss } : {}),
      });
    } catch {
      const reason = safeCompletionFailure(connection.serverName);
      this.removePending(input.state);
      this.setFailed(mcpServerId, reason);
      return { status: "failed", error: reason };
    }
    this.removePending(input.state);
    try {
      return await this.discoverAndConnect(
        mcpServerId,
        connection,
        pending.redirectUrl,
        input.state,
      );
    } catch (cause) {
      return {
        status: "failed",
        error:
          cause instanceof McpOAuthFlowError
            ? cause.reason
            : `${connection.serverName} tool discovery failed. Connect again.`,
      };
    }
  }

  poll(loginId: string): McpAuthLoginProgress {
    const data = this.expirePending(this.read());
    const pending = Object.values(data.pendingByState).find((entry) => entry.loginId === loginId);
    if (pending) return { status: "pending", nextPollMs: NEXT_POLL_MS };
    const connection = Object.values(data.connections).find(
      (entry) => entry.currentLoginId === loginId,
    );
    if (connection?.status === "connecting") {
      return { status: "pending", nextPollMs: NEXT_POLL_MS };
    }
    if (connection?.status === "connected") {
      return { status: "connected", toolCount: connection.toolCount ?? 0 };
    }
    return {
      status: "failed",
      error: connection?.error ?? "Authorization expired or already completed. Start again.",
    };
  }

  disconnect(mcpServerId: McpServerId): void {
    const data = this.expirePending(this.read());
    const key = String(mcpServerId);
    const hasPending = Object.values(data.pendingByState).some(
      (pending) => pending.mcpServerId === key,
    );
    if (!data.connections[key] && !hasPending) return;
    const connections = { ...data.connections };
    delete connections[key];
    const pendingByState = Object.fromEntries(
      Object.entries(data.pendingByState).filter(([, pending]) => pending.mcpServerId !== key),
    );
    this.write({ ...data, connections, pendingByState });
  }

  cancel(loginId: string): void {
    const data = this.expirePending(this.read());
    const match = Object.entries(data.pendingByState).find(
      ([, pending]) => pending.loginId === loginId,
    );
    if (!match) return;
    const [state, pending] = match;
    this.removePending(state);
    this.setFailed(
      McpServerId.make(pending.mcpServerId),
      "Authorization was canceled. Connect the plugin again.",
    );
  }

  private removePending(state: string): void {
    const data = this.read();
    if (!data.pendingByState[state]) return;
    const pendingByState = { ...data.pendingByState };
    delete pendingByState[state];
    this.write({ ...data, pendingByState });
  }

  private async discoverAndConnect(
    mcpServerId: McpServerId,
    connection: StoredConnection,
    redirectUrl: string,
    state: string,
  ): Promise<{ readonly status: "connected"; readonly toolCount: number }> {
    const input = this.driverInput(mcpServerId, connection, redirectUrl, state);
    let tools: readonly string[];
    try {
      tools = await this.driver.discoverTools(input);
    } catch (cause) {
      const reason =
        cause instanceof McpOAuthFlowError
          ? cause.reason
          : `${connection.serverName} authorization succeeded, but tool discovery failed. Connect again.`;
      this.setFailed(mcpServerId, reason);
      throw new McpOAuthFlowError(reason);
    }
    if (tools.length === 0) {
      const reason = `${connection.serverName} connected but returned no tools. Connect again or check the account.`;
      this.setFailed(mcpServerId, reason);
      throw new McpOAuthFlowError(reason);
    }
    const data = this.read();
    const latest = data.connections[String(mcpServerId)];
    if (!latest) throw new McpOAuthFlowError("The MCP OAuth connection no longer exists.");
    this.write({
      ...data,
      connections: {
        ...data.connections,
        [String(mcpServerId)]: {
          ...latest,
          status: "connected",
          toolCount: tools.length,
          error: undefined,
          updatedAt: this.now(),
        },
      },
    });
    return { status: "connected", toolCount: tools.length };
  }

  async prepareRuntime(servers: readonly McpServer[]): Promise<PreparedMcpRuntime> {
    const selected: McpServer[] = [];
    const authorizationHeaders: Record<string, string> = {};
    const data = this.expirePending(this.read());
    for (const server of servers) {
      if (
        server.transport !== "url" ||
        server.authentication === undefined ||
        server.authentication === "none"
      ) {
        selected.push(server);
        continue;
      }
      const connection = data.connections[String(server.id)];
      if (!connection || connection.serverUrl !== server.url || connection.status !== "connected") {
        if (server.authentication === "optional-oauth") {
          selected.push(server);
          continue;
        }
        throw new McpOAuthFlowError(`${server.name} must be connected before this bot can use it.`);
      }
      let token: string | undefined;
      try {
        token = await this.driver.accessToken(
          this.driverInput(server.id, connection, connection.redirectUrl, "runtime"),
        );
      } catch {
        token = undefined;
      }
      if (!token) {
        const reason = safeRuntimeFailure(server.name);
        this.setFailed(server.id, reason);
        if (server.authentication === "optional-oauth") {
          selected.push(server);
          continue;
        }
        throw new McpOAuthFlowError(reason);
      }
      selected.push(server);
      authorizationHeaders[String(server.id)] = `Bearer ${token}`;
    }
    return { servers: selected, authorizationHeaders };
  }
}

export function toMcpAuthError(cause: unknown): McpAuthError {
  return new McpAuthError({
    reason:
      cause instanceof McpOAuthFlowError
        ? cause.reason
        : "The MCP OAuth operation failed. Try again.",
  });
}
