import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useEffect, useState } from "react";

import { useEnvironments } from "../../state/environments";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { AuthSurfaceShell } from "../auth/AuthSurfaceShell";
import { Button } from "../ui/button";
import {
  isPendingMcpOAuthEnvironment,
  isTerminalMcpOAuthProgress,
  readMcpOAuthCallback,
  readMcpOAuthReturnLocation,
} from "./mcpOAuthCallback";

type CallbackState =
  | { readonly status: "completing" }
  | { readonly status: "connected" }
  | { readonly status: "failed"; readonly message: string };

/**
 * Hard ceiling for the whole completion attempt. The server bounds token
 * exchange and tool discovery, but a dropped socket or a server restart
 * can leave the command pending forever. Fail loudly instead of showing
 * an eternal "connecting" page.
 */
export const MCP_OAUTH_COMPLETE_TIMEOUT_MS = 45_000;

export function McpOAuthCallbackSurface() {
  useEnvironments();
  const [callback] = useState(() => readMcpOAuthCallback(new URL(window.location.href)));
  // Strip the code from the address bar after render. Doing it during the
  // state initializer updated the router mid-render and broke the surface.
  useEffect(() => {
    window.history.replaceState({}, "", "/plugins/oauth/callback");
  }, []);
  const [state, setState] = useState<CallbackState>(
    callback
      ? { status: "completing" }
      : {
          status: "failed",
          message: "The authorization response is incomplete. Start the connection again.",
        },
  );
  const complete = useAtomCommand(serverEnvironment.completeMcpAuth, {
    reportFailure: false,
  });

  useEffect(() => {
    if (!callback) return;
    let active = true;
    const watchdog = window.setTimeout(() => {
      if (!active) return;
      active = false;
      setState((current) =>
        current.status === "completing"
          ? {
              status: "failed",
              message:
                "The connection is taking too long. Return to Akeru and start the connection again.",
            }
          : current,
      );
    }, MCP_OAUTH_COMPLETE_TIMEOUT_MS);
    void (async () => {
      for (let attempt = 0; attempt < 150; attempt += 1) {
        const result = await complete({
          environmentId: callback.environmentId,
          input: callback.input,
        });
        if (!active) return;
        if (result._tag === "Failure") {
          if (isAtomCommandInterrupted(result)) return;
          const failure = squashAtomCommandFailure(result);
          if (isPendingMcpOAuthEnvironment(failure) && attempt < 149) {
            await new Promise((resolve) => window.setTimeout(resolve, 100));
            continue;
          }
          setState({
            status: "failed",
            message:
              failure instanceof Error
                ? failure.message
                : "Akeru could not complete this plugin connection.",
          });
          return;
        }
        if (isTerminalMcpOAuthProgress(result.value)) {
          const returnLocation = readMcpOAuthReturnLocation(window.location.origin);
          if (returnLocation) {
            window.location.replace(returnLocation);
            return;
          }
        }
        if (result.value.status === "connected") {
          setState({ status: "connected" });
          return;
        }
        setState({
          status: "failed",
          message:
            result.value.status === "failed"
              ? result.value.error
              : "Authorization is still pending. Return to Akeru and try again.",
        });
        return;
      }
    })();
    return () => {
      active = false;
      window.clearTimeout(watchdog);
    };
  }, [callback, complete]);

  const title =
    state.status === "completing"
      ? "Connecting plugin"
      : state.status === "connected"
        ? "Plugin connected"
        : "Plugin connection failed";
  const description =
    state.status === "completing"
      ? "Akeru is exchanging the authorization code and discovering tools."
      : state.status === "connected"
        ? "Akeru discovered the plugin tools. The next agent turn can use them."
        : state.message;

  return (
    <AuthSurfaceShell>
      <p className="text-xs font-medium text-muted-foreground">Plugin authorization</p>
      <h1 className="mt-2 text-xl font-medium tracking-tight">{title}</h1>
      <p aria-live="polite" className="mt-2 text-sm leading-6 text-muted-foreground">
        {description}
      </p>
      <Button
        className="mt-5"
        size="sm"
        type="button"
        variant={state.status === "completing" ? "outline" : "default"}
        onClick={() => window.location.assign("/")}
      >
        Return to Akeru
      </Button>
    </AuthSurfaceShell>
  );
}
