import { McpServerId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import { createAkeruMcpToolProvider } from "./AkeruMcpTools.ts";

const server = {
  id: McpServerId.make("exa-server"),
  name: "Exa Search",
  transport: "url" as const,
  url: "https://mcp.example.com/mcp",
  enabled: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("Akeru MCP tools", () => {
  it("namespaces, invokes, authorizes, and closes connected MCP tools", async () => {
    const callTool = vi.fn(async () => ({ content: [{ type: "text", text: "result" }] }));
    const close = vi.fn(async () => undefined);
    const connect = vi.fn(async () => ({
      listTools: async () => [
        {
          name: "search",
          description: "Search the web.",
          inputSchema: {
            type: "object",
            required: ["query"],
            properties: { query: { type: "string" } },
          },
        },
      ],
      callTool,
      close,
    }));
    const provider = createAkeruMcpToolProvider({
      servers: [server],
      authorizationHeaders: { "exa-server": "Bearer plugin-token" },
      connect,
      cwd: "/workspace",
    });

    const tools = await provider.tools();
    expect(tools.map(({ name }) => name)).toEqual(["exa_search_search"]);
    expect(connect).toHaveBeenCalledWith({
      server,
      authorization: "Bearer plugin-token",
      cwd: "/workspace",
    });
    await expect(
      tools[0]?.execute(
        { query: "Akeru" },
        { signal: new AbortController().signal, askUser: async () => undefined },
      ),
    ).resolves.toEqual({ content: [{ type: "text", text: "result" }] });
    expect(callTool).toHaveBeenCalledWith("search", { query: "Akeru" }, expect.any(AbortSignal));

    await provider.close?.();
    expect(close).toHaveBeenCalledOnce();
  });

  it("shares one connection attempt across concurrent tool loads", async () => {
    const connect = vi.fn(async () => ({
      listTools: async () => [],
      callTool: async () => undefined,
      close: async () => undefined,
    }));
    const provider = createAkeruMcpToolProvider({ servers: [server], connect });

    await Promise.all([provider.tools(), provider.tools(), provider.tools()]);

    expect(connect).toHaveBeenCalledOnce();
    await provider.close?.();
  });

  it("closes partial connections when another MCP server fails", async () => {
    const close = vi.fn(async () => undefined);
    const secondServer = { ...server, id: McpServerId.make("broken-server"), name: "Broken" };
    const provider = createAkeruMcpToolProvider({
      servers: [server, secondServer],
      connect: async ({ server: candidate }) => {
        if (candidate.id === secondServer.id) throw new Error("connection failed");
        return {
          listTools: async () => [],
          callTool: async () => undefined,
          close,
        };
      },
    });

    await expect(provider.tools()).rejects.toThrow("connection failed");
    expect(close).toHaveBeenCalledOnce();
  });

  it("rejects non-object MCP arguments", async () => {
    const provider = createAkeruMcpToolProvider({
      servers: [server],
      connect: async () => ({
        listTools: async () => [{ name: "search", inputSchema: { type: "object" } }],
        callTool: async () => undefined,
        close: async () => undefined,
      }),
    });
    const [tool] = await provider.tools();
    await expect(
      tool?.execute("invalid", {
        signal: new AbortController().signal,
        askUser: async () => undefined,
      }),
    ).rejects.toThrow("must be an object");
    await provider.close?.();
  });
});
