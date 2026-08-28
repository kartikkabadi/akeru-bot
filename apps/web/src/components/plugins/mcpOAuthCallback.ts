import {
  EnvironmentId,
  type McpAuthCompleteInput,
  type McpAuthLoginProgress,
  type EnvironmentId as EnvironmentIdType,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

const isEnvironmentId = Schema.is(EnvironmentId);
const RETURN_LOCATION_KEY = "akeru:mcp-oauth-return";

export interface McpOAuthCallback {
  readonly environmentId: EnvironmentIdType;
  readonly input: McpAuthCompleteInput;
}

export function buildMcpOAuthRedirectUrl(
  appOrigin: string,
  environmentId: EnvironmentIdType,
): string {
  const url = new URL("/plugins/oauth/callback", appOrigin);
  url.searchParams.set("environment", environmentId);
  return url.toString();
}

export function storeMcpOAuthReturnLocation(url: URL): void {
  if (url.protocol !== "http:" && url.protocol !== "https:") return;
  window.sessionStorage.setItem(RETURN_LOCATION_KEY, url.toString());
}

export function readMcpOAuthReturnLocation(origin: string): string | null {
  const stored = window.sessionStorage.getItem(RETURN_LOCATION_KEY);
  if (!stored) return null;
  try {
    const url = new URL(stored);
    return url.origin === origin ? url.toString() : null;
  } catch {
    return null;
  }
}

export function takeMcpOAuthReturnLocation(origin: string): string | null {
  const stored = readMcpOAuthReturnLocation(origin);
  window.sessionStorage.removeItem(RETURN_LOCATION_KEY);
  return stored;
}

export function isPendingMcpOAuthEnvironment(cause: unknown): boolean {
  return cause instanceof Error && /^Environment .+ is not registered\.$/.test(cause.message);
}

export function isTerminalMcpOAuthProgress(progress: McpAuthLoginProgress): boolean {
  return progress.status === "connected" || progress.status === "failed";
}

export function readMcpOAuthCallback(url: URL): McpOAuthCallback | null {
  const environmentId = url.searchParams.get("environment");
  const state = url.searchParams.get("state")?.trim();
  const code = url.searchParams.get("code")?.trim();
  const error = url.searchParams.get("error")?.trim();
  if (!isEnvironmentId(environmentId) || !state || (!code && !error) || (code && error)) {
    return null;
  }
  if (code) {
    const iss = url.searchParams.get("iss")?.trim();
    return {
      environmentId,
      input: { code, state, ...(iss ? { iss } : {}) },
    };
  }
  if (!error) return null;
  const errorDescription = url.searchParams.get("error_description")?.trim();
  return {
    environmentId,
    input: {
      error,
      state,
      ...(errorDescription ? { errorDescription } : {}),
    },
  };
}
