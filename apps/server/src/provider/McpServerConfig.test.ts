import { McpServerId, type McpServer } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { toAcpMcpServers, toClaudeMcpServers } from "./McpServerConfig.ts";

const servers: readonly McpServer[] = [
  {
    id: McpServerId.make("search"),
    name: "Search",
    transport: "url",
    url: "https://mcp.example.com",
    enabled: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: McpServerId.make("local"),
    name: "Local",
    transport: "stdio",
    command: "bunx",
    args: ["local-mcp"],
    enabled: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
];

describe("provider MCP configuration", () => {
  it("converts filtered servers for ACP adapters", () => {
    expect(toAcpMcpServers(servers)).toEqual([
      { type: "http", name: "Search", url: "https://mcp.example.com", headers: [] },
      { name: "Local", command: "bunx", args: ["local-mcp"], env: [] },
    ]);
  });

  it("converts filtered servers for Claude", () => {
    expect(toClaudeMcpServers(servers)).toEqual({
      search: { type: "http", url: "https://mcp.example.com", headers: {} },
      local: { type: "stdio", command: "bunx", args: ["local-mcp"] },
    });
  });

  it("attaches transient OAuth bearer headers to hosted MCP transports", () => {
    const authorizationHeaders = { search: "Bearer context-access" };

    expect(toAcpMcpServers(servers, authorizationHeaders)[0]).toEqual({
      type: "http",
      name: "Search",
      url: "https://mcp.example.com",
      headers: [{ name: "Authorization", value: "Bearer context-access" }],
    });
    expect(toClaudeMcpServers(servers, authorizationHeaders).search).toEqual({
      type: "http",
      url: "https://mcp.example.com",
      headers: { Authorization: "Bearer context-access" },
    });
  });
});
