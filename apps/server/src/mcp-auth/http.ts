import { McpAuthCompleteInput } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import * as ServerConfig from "../config.ts";
import * as AgentController from "../provider/Services/AgentController.ts";
import { stopAgentSessions } from "../provider/stopAgentSessions.ts";
import { McpOAuthRuntime } from "./McpOAuth.ts";

const CALLBACK_PATH = "/plugins/oauth/callback";
const decodeCallback = Schema.decodeUnknownEffect(McpAuthCompleteInput);

function resultHtml(connected: boolean): string {
  const title = connected ? "Plugin connected" : "Plugin connection failed";
  const detail = connected
    ? "Akeru Bot discovered the plugin tools. You can close this tab."
    : "Return to Akeru Bot and try the connection again.";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>
    :root {
      color-scheme: light dark;
      font-family: "Geist Variable", ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #ffffff;
      color: #262626;
    }
    body { min-height: 100vh; margin: 0; display: flex; flex-direction: column; background: #ffffff; }
    .brand { display: flex; align-items: baseline; height: 52px; padding: 0 14px; flex-shrink: 0; }
    .wordmark { font-family: Georgia, "Times New Roman", serif; font-size: 20px; line-height: 1; letter-spacing: -0.02em; }
    main { flex: 1; display: flex; align-items: center; justify-content: center; padding: 48px 24px; }
    section { width: min(100%, 448px); text-align: center; }
    h1 { margin: 0; font-size: 20px; font-weight: 500; letter-spacing: -0.02em; }
    p { margin: 8px 0 0; color: #737373; font-size: 14px; line-height: 1.6; }
    @media (prefers-color-scheme: dark) {
      :root { background: #050505; color: #f5f5f5; }
      body { background: #050505; }
      p { color: #a3a3a3; }
    }
  </style>
</head>
<body>
  <header class="brand">
    <span class="wordmark">akeru</span>
  </header>
  <main><section><h1>${title}</h1><p>${detail}</p></section></main>
</body>
</html>`;
}

export const mcpOAuthCallbackRouteLayer = HttpRouter.add(
  "GET",
  CALLBACK_PATH,
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const parsed = HttpServerRequest.toURL(request);
    if (Option.isNone(parsed)) {
      return HttpServerResponse.text(resultHtml(false), {
        status: 400,
        contentType: "text/html; charset=utf-8",
      });
    }
    const url = parsed.value;
    const cleanResult = url.searchParams.get("result");
    if (cleanResult === "connected" || cleanResult === "failed") {
      return HttpServerResponse.html(resultHtml(cleanResult === "connected"));
    }

    const state = url.searchParams.get("state");
    const code = url.searchParams.get("code");
    const error = url.searchParams.get("error");
    if (!state || (!code && !error) || (code && error)) {
      return HttpServerResponse.redirect(`${CALLBACK_PATH}?result=failed`, { status: 303 });
    }
    const input = yield* decodeCallback(
      code
        ? {
            code,
            state,
            ...(url.searchParams.get("iss") ? { iss: url.searchParams.get("iss") } : {}),
          }
        : {
            error,
            state,
            ...(url.searchParams.get("error_description")
              ? { errorDescription: url.searchParams.get("error_description") }
              : {}),
          },
    ).pipe(Effect.option);
    if (Option.isNone(input)) {
      return HttpServerResponse.redirect(`${CALLBACK_PATH}?result=failed`, { status: 303 });
    }

    const config = yield* ServerConfig.ServerConfig;
    const mcpOAuth = McpOAuthRuntime.forSecretsDir(config.secretsDir);
    const mcpServerId = mcpOAuth.serverIdForState(input.value.state);
    const callbackOrigin = url.origin;
    const result = yield* Effect.tryPromise({
      try: () => mcpOAuth.complete(input.value, callbackOrigin),
      catch: () => undefined,
    }).pipe(Effect.option);
    const connected = Option.isSome(result) && result.value?.status === "connected";
    if (connected && mcpServerId) {
      const agentController = yield* AgentController.AgentController;
      yield* stopAgentSessions(agentController, {
        logMessage: "MCP OAuth session invalidation failed",
        include: (session) => session.mcpServerIds?.includes(mcpServerId) === true,
      });
    }
    return HttpServerResponse.redirect(
      `${CALLBACK_PATH}?result=${connected ? "connected" : "failed"}`,
      { status: 303 },
    );
  }),
);
