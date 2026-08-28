import * as Schema from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";

import { EnvironmentAuthorizationError } from "./auth.ts";
import { NonNegativeInt, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { McpServerId } from "./mcpServer.ts";

export const McpAuthConnectionStatus = Schema.Union([
  Schema.Struct({
    mcpServerId: McpServerId,
    status: Schema.Literal("installed"),
  }),
  Schema.Struct({
    mcpServerId: McpServerId,
    status: Schema.Literal("authentication-required"),
  }),
  Schema.Struct({
    mcpServerId: McpServerId,
    status: Schema.Literal("connecting"),
  }),
  Schema.Struct({
    mcpServerId: McpServerId,
    status: Schema.Literal("connected"),
    toolCount: NonNegativeInt,
  }),
  Schema.Struct({
    mcpServerId: McpServerId,
    status: Schema.Literal("failed"),
    error: TrimmedNonEmptyString,
  }),
]);
export type McpAuthConnectionStatus = typeof McpAuthConnectionStatus.Type;

export const McpAuthStatuses = Schema.Struct({
  connections: Schema.Array(McpAuthConnectionStatus),
});
export type McpAuthStatuses = typeof McpAuthStatuses.Type;

export const McpAuthStartInput = Schema.Struct({
  mcpServerId: McpServerId,
  redirectUrl: TrimmedNonEmptyString,
});
export type McpAuthStartInput = typeof McpAuthStartInput.Type;

export const McpAuthStartResult = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("connected"),
    toolCount: NonNegativeInt,
  }),
  Schema.Struct({
    status: Schema.Literal("login-required"),
    loginId: TrimmedNonEmptyString,
    authorizationUrl: TrimmedNonEmptyString,
  }),
]);
export type McpAuthStartResult = typeof McpAuthStartResult.Type;

export const McpAuthCompleteInput = Schema.Union([
  Schema.Struct({
    code: TrimmedNonEmptyString,
    state: TrimmedNonEmptyString,
    iss: Schema.optional(TrimmedNonEmptyString),
  }),
  Schema.Struct({
    error: TrimmedNonEmptyString,
    errorDescription: Schema.optional(TrimmedNonEmptyString),
    state: TrimmedNonEmptyString,
  }),
]);
export type McpAuthCompleteInput = typeof McpAuthCompleteInput.Type;

export const McpAuthLoginInput = Schema.Struct({
  loginId: TrimmedNonEmptyString,
});
export type McpAuthLoginInput = typeof McpAuthLoginInput.Type;

export const McpAuthDisconnectInput = Schema.Struct({
  mcpServerId: McpServerId,
});
export type McpAuthDisconnectInput = typeof McpAuthDisconnectInput.Type;

export const McpAuthLoginProgress = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("connected"),
    toolCount: NonNegativeInt,
  }),
  Schema.Struct({ status: Schema.Literal("pending"), nextPollMs: Schema.Number }),
  Schema.Struct({ status: Schema.Literal("failed"), error: TrimmedNonEmptyString }),
]);
export type McpAuthLoginProgress = typeof McpAuthLoginProgress.Type;

export class McpAuthError extends Schema.TaggedErrorClass<McpAuthError>()("McpAuthError", {
  reason: TrimmedNonEmptyString,
}) {
  override get message(): string {
    return this.reason;
  }
}

export const MCP_AUTH_WS_METHODS = {
  mcpAuthList: "mcpAuth.list",
  mcpAuthStart: "mcpAuth.start",
  mcpAuthPoll: "mcpAuth.poll",
  mcpAuthComplete: "mcpAuth.complete",
  mcpAuthCancel: "mcpAuth.cancel",
  mcpAuthDisconnect: "mcpAuth.disconnect",
} as const;

const McpAuthRpcError = Schema.Union([McpAuthError, EnvironmentAuthorizationError]);

export const WsMcpAuthListRpc = Rpc.make(MCP_AUTH_WS_METHODS.mcpAuthList, {
  payload: Schema.Struct({}),
  success: McpAuthStatuses,
  error: McpAuthRpcError,
});

export const WsMcpAuthStartRpc = Rpc.make(MCP_AUTH_WS_METHODS.mcpAuthStart, {
  payload: McpAuthStartInput,
  success: McpAuthStartResult,
  error: McpAuthRpcError,
});

export const WsMcpAuthPollRpc = Rpc.make(MCP_AUTH_WS_METHODS.mcpAuthPoll, {
  payload: McpAuthLoginInput,
  success: McpAuthLoginProgress,
  error: McpAuthRpcError,
});

export const WsMcpAuthCompleteRpc = Rpc.make(MCP_AUTH_WS_METHODS.mcpAuthComplete, {
  payload: McpAuthCompleteInput,
  success: McpAuthLoginProgress,
  error: McpAuthRpcError,
});

export const WsMcpAuthCancelRpc = Rpc.make(MCP_AUTH_WS_METHODS.mcpAuthCancel, {
  payload: McpAuthLoginInput,
  success: Schema.Struct({}),
  error: McpAuthRpcError,
});

export const WsMcpAuthDisconnectRpc = Rpc.make(MCP_AUTH_WS_METHODS.mcpAuthDisconnect, {
  payload: McpAuthDisconnectInput,
  success: Schema.Struct({}),
  error: McpAuthRpcError,
});
