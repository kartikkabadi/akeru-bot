import { createFileRoute } from "@tanstack/react-router";

import { McpOAuthCallbackSurface } from "../components/plugins/McpOAuthCallbackSurface";

export const Route = createFileRoute("/plugins_/oauth/callback")({
  component: McpOAuthCallbackSurface,
});
