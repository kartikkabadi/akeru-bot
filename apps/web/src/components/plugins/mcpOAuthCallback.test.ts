import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildMcpOAuthRedirectUrl,
  isPendingMcpOAuthEnvironment,
  isTerminalMcpOAuthProgress,
  readMcpOAuthCallback,
} from "./mcpOAuthCallback";

describe("MCP OAuth callback", () => {
  it("builds an environment-owned callback URL", () => {
    expect(
      buildMcpOAuthRedirectUrl("https://app.t3.codes", EnvironmentId.make("environment-test")),
    ).toBe("https://app.t3.codes/plugins/oauth/callback?environment=environment-test");
  });

  it("decodes successful and denied callbacks", () => {
    expect(
      readMcpOAuthCallback(
        new URL(
          "https://app.t3.codes/plugins/oauth/callback?environment=environment-test&code=code-1&state=state-1&iss=https%3A%2F%2Fmcp.context.dev",
        ),
      ),
    ).toEqual({
      environmentId: EnvironmentId.make("environment-test"),
      input: {
        code: "code-1",
        state: "state-1",
        iss: "https://mcp.context.dev",
      },
    });
    expect(
      readMcpOAuthCallback(
        new URL(
          "https://app.t3.codes/plugins/oauth/callback?environment=environment-test&error=access_denied&state=state-1",
        ),
      ),
    ).toEqual({
      environmentId: EnvironmentId.make("environment-test"),
      input: { error: "access_denied", state: "state-1" },
    });
  });

  it("treats an unregistered callback environment as startup work", () => {
    expect(
      isPendingMcpOAuthEnvironment(
        new Error("Environment 440a8513-411c-4dc3-a43e-6c6ba4dadf32 is not registered."),
      ),
    ).toBe(true);
    expect(isPendingMcpOAuthEnvironment(new Error("Authorization failed."))).toBe(false);
  });

  it("returns to the plugin list after terminal callback results", () => {
    expect(isTerminalMcpOAuthProgress({ status: "connected", toolCount: 2 })).toBe(true);
    expect(
      isTerminalMcpOAuthProgress({
        status: "failed",
        error: "Tool discovery failed.",
      }),
    ).toBe(true);
    expect(isTerminalMcpOAuthProgress({ status: "pending", nextPollMs: 1_000 })).toBe(false);
  });

  it("rejects incomplete or ambiguous callbacks", () => {
    expect(
      readMcpOAuthCallback(
        new URL(
          "https://app.t3.codes/plugins/oauth/callback?environment=environment-test&state=state-1",
        ),
      ),
    ).toBeNull();
    expect(
      readMcpOAuthCallback(
        new URL(
          "https://app.t3.codes/plugins/oauth/callback?environment=environment-test&code=code-1&error=denied&state=state-1",
        ),
      ),
    ).toBeNull();
  });
});
