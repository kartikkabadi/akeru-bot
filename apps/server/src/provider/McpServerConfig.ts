import type { McpServer } from "@t3tools/contracts";
import type * as EffectAcpSchema from "effect-acp/schema";

export function toAcpMcpServers(
  servers: readonly McpServer[],
  authorizationHeaders: Readonly<Record<string, string>> = {},
): ReadonlyArray<EffectAcpSchema.McpServer> {
  return servers.map((server) => {
    if (server.transport === "url") {
      const authorization = authorizationHeaders[String(server.id)];
      return {
        type: "http" as const,
        name: server.name,
        url: server.url,
        headers: authorization ? [{ name: "Authorization", value: authorization }] : [],
      };
    }
    return {
      name: server.name,
      command: server.command,
      args: [...(server.args ?? [])],
      env: [],
    };
  });
}

export function toClaudeMcpServers(
  servers: readonly McpServer[],
  authorizationHeaders: Readonly<Record<string, string>> = {},
) {
  return Object.fromEntries(
    servers.map((server) => [
      String(server.id),
      server.transport === "url"
        ? {
            type: "http" as const,
            url: server.url,
            headers: authorizationHeaders[String(server.id)]
              ? { Authorization: authorizationHeaders[String(server.id)] }
              : {},
          }
        : {
            type: "stdio" as const,
            command: server.command,
            args: [...(server.args ?? [])],
          },
    ]),
  );
}
