// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { NonNegativeInt } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

const StoredConnectionSchema = Schema.Struct({
  serverUrl: Schema.String,
  serverName: Schema.String,
  redirectUrl: Schema.String,
  currentLoginId: Schema.optional(Schema.String),
  storage: Schema.Record(Schema.String, Schema.String),
  status: Schema.Literals(["authentication-required", "connecting", "connected", "failed"]),
  toolCount: Schema.optional(NonNegativeInt),
  error: Schema.optional(Schema.String),
  updatedAt: Schema.Number,
});

const StoredPendingLoginSchema = Schema.Struct({
  loginId: Schema.String,
  mcpServerId: Schema.String,
  serverUrl: Schema.String,
  serverName: Schema.String,
  redirectUrl: Schema.String,
  expiresAt: Schema.Number,
});

const StoredMcpOAuthDataSchema = Schema.Struct({
  version: Schema.Literal(1),
  connections: Schema.Record(Schema.String, StoredConnectionSchema),
  pendingByState: Schema.Record(Schema.String, StoredPendingLoginSchema),
});

export type StoredMcpOAuthData = typeof StoredMcpOAuthDataSchema.Type;
export type StoredConnection = typeof StoredConnectionSchema.Type;
export type StoredPendingLogin = typeof StoredPendingLoginSchema.Type;

const decodeStoredData = Schema.decodeUnknownSync(StoredMcpOAuthDataSchema);

function emptyData(): StoredMcpOAuthData {
  return { version: 1, connections: {}, pendingByState: {} };
}

export class McpOAuthStoreError extends Error {
  readonly _tag = "McpOAuthStoreError";
}

/** Owns validated, atomic persistence for one environment's MCP OAuth state. */
export class McpOAuthStore {
  private data: StoredMcpOAuthData;
  private readonly authPath: string;
  private readonly randomUUID: () => string;

  constructor(authPath: string, randomUUID: () => string) {
    this.authPath = authPath;
    this.randomUUID = randomUUID;
    this.data = this.load();
  }

  read(): StoredMcpOAuthData {
    return this.data;
  }

  write(data: StoredMcpOAuthData): void {
    const directory = NodePath.dirname(this.authPath);
    NodeFS.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.authPath}.${this.randomUUID()}.tmp`;
    try {
      NodeFS.writeFileSync(temporaryPath, JSON.stringify(data, null, 2), {
        encoding: "utf8",
        mode: 0o600,
      });
      NodeFS.renameSync(temporaryPath, this.authPath);
      NodeFS.chmodSync(this.authPath, 0o600);
      this.data = data;
    } finally {
      NodeFS.rmSync(temporaryPath, { force: true });
    }
  }

  private load(): StoredMcpOAuthData {
    if (!NodeFS.existsSync(this.authPath)) return emptyData();
    try {
      return decodeStoredData(JSON.parse(NodeFS.readFileSync(this.authPath, "utf8")));
    } catch (cause) {
      throw new McpOAuthStoreError(
        `MCP OAuth state at '${this.authPath}' is invalid. Move the file aside and reconnect plugins.`,
        { cause },
      );
    }
  }
}
