import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { McpAuthCompleteInput, McpAuthStartInput, McpAuthStartResult } from "./mcpAuth.ts";

const decodeStartInput = Schema.decodeUnknownSync(McpAuthStartInput);
const decodeStartResult = Schema.decodeUnknownSync(McpAuthStartResult);
const decodeCompleteInput = Schema.decodeUnknownSync(McpAuthCompleteInput);

describe("MCP auth contracts", () => {
  it("carries only server identity and browser callback data", () => {
    expect(
      decodeStartInput({
        mcpServerId: "builtin-context",
        redirectUrl: "https://app.example.test/mcp-oauth/callback",
      }),
    ).toEqual({
      mcpServerId: "builtin-context",
      redirectUrl: "https://app.example.test/mcp-oauth/callback",
    });
    expect(decodeCompleteInput({ code: "authorization-code", state: "oauth-state" })).toEqual({
      code: "authorization-code",
      state: "oauth-state",
    });
  });

  it("returns an actionable authorization URL when login is required", () => {
    expect(
      decodeStartResult({
        status: "login-required",
        loginId: "login-1",
        authorizationUrl: "https://provider.example.test/authorize",
      }),
    ).toEqual({
      status: "login-required",
      loginId: "login-1",
      authorizationUrl: "https://provider.example.test/authorize",
    });
  });
});
