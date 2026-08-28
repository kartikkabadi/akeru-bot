// @effect-diagnostics nodeBuiltinImport:off
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { McpServer } from "@t3tools/contracts";

import type { AkeruToolDefinition, AkeruToolProvider } from "./AkeruToolRegistry.ts";

export interface AkeruMcpConnection {
  readonly listTools: () => Promise<
    readonly {
      readonly name: string;
      readonly description?: string;
      readonly inputSchema: Readonly<Record<string, unknown>>;
    }[]
  >;
  readonly callTool: (
    name: string,
    input: Readonly<Record<string, unknown>>,
    signal: AbortSignal,
  ) => Promise<unknown>;
  readonly close: () => Promise<void>;
}

export interface AkeruMcpConnectorInput {
  readonly server: McpServer;
  readonly authorization?: string;
  readonly cwd?: string;
}

export type AkeruMcpConnector = (input: AkeruMcpConnectorInput) => Promise<AkeruMcpConnection>;

async function connectMcp(input: AkeruMcpConnectorInput): Promise<AkeruMcpConnection> {
  const client = new Client({ name: "akeru", version: "1.0.0" });
  try {
    if (input.server.transport === "url") {
      const transport = new StreamableHTTPClientTransport(
        new URL(input.server.url),
        input.authorization
          ? { requestInit: { headers: { Authorization: input.authorization } } }
          : {},
      );
      await client.connect(transport as Parameters<typeof client.connect>[0]);
    } else {
      const transport = new StdioClientTransport({
        command: input.server.command,
        ...(input.server.args ? { args: [...input.server.args] } : {}),
        ...(input.cwd ? { cwd: input.cwd } : {}),
        stderr: "pipe",
      });
      await client.connect(transport);
    }
  } catch (cause) {
    await client.close().catch(() => undefined);
    throw cause;
  }
  return {
    listTools: async () => {
      const response = await client.listTools();
      return response.tools.map((tool) => ({
        name: tool.name,
        ...(tool.description ? { description: tool.description } : {}),
        inputSchema: tool.inputSchema as Readonly<Record<string, unknown>>,
      }));
    },
    callTool: (name, args, signal) =>
      client.callTool({ name, arguments: args }, undefined, { signal }),
    close: () => client.close(),
  };
}

function toolNamespace(server: McpServer): string {
  const normalized = server.name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || String(server.id).replace(/[^a-zA-Z0-9_]+/g, "_");
}

function toolInput(input: unknown): Readonly<Record<string, unknown>> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("MCP tool input must be an object.");
  }
  return input as Readonly<Record<string, unknown>>;
}

export function createAkeruMcpToolProvider(input: {
  readonly servers: readonly McpServer[];
  readonly authorizationHeaders?: Readonly<Record<string, string>>;
  readonly cwd?: string;
  readonly connect?: AkeruMcpConnector;
}): AkeruToolProvider {
  const connections: AkeruMcpConnection[] = [];
  let definitions: readonly AkeruToolDefinition[] | undefined;
  let loading: Promise<readonly AkeruToolDefinition[]> | undefined;
  const discardConnections = async () => {
    const active = connections.splice(0);
    await Promise.allSettled(active.map((connection) => connection.close()));
  };
  return {
    tools: async () => {
      if (definitions) return definitions;
      if (loading) return loading;
      loading = (async () => {
        try {
          const connected = await Promise.all(
            input.servers.map(async (server) => {
              const connection = await (input.connect ?? connectMcp)({
                server,
                ...(input.authorizationHeaders?.[String(server.id)]
                  ? { authorization: input.authorizationHeaders[String(server.id)] }
                  : {}),
                ...(input.cwd ? { cwd: input.cwd } : {}),
              });
              connections.push(connection);
              return { server, connection };
            }),
          );
          const next: AkeruToolDefinition[] = [];
          for (const { server, connection } of connected) {
            const namespace = toolNamespace(server);
            for (const remote of await connection.listTools()) {
              const name = `${namespace}_${remote.name}`;
              next.push({
                name,
                description: remote.description ?? `Run ${remote.name} through ${server.name}.`,
                inputSchema: remote.inputSchema,
                category: "mcp",
                execute: async (args, context) =>
                  connection.callTool(remote.name, toolInput(args), context.signal),
              });
            }
          }
          definitions = next;
          return definitions;
        } catch (cause) {
          await discardConnections();
          throw cause;
        } finally {
          loading = undefined;
        }
      })();
      return loading;
    },
    close: async () => {
      await loading?.catch(() => undefined);
      definitions = undefined;
      const active = connections.splice(0);
      await Promise.all(active.map((connection) => connection.close()));
    },
  };
}
