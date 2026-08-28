import { McpServerId, type McpServer } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";
import { loadCatalog } from "../../../../../plugins";
import { PluginDetailsContent } from "./PluginDetails";
import {
  EMPTY_MCP_SERVER_DRAFT,
  PLUGIN_DIALOG_CLASS_NAME,
  PLUGIN_DIRECTORY_HEADER_CLASS_NAME,
  PLUGIN_DIRECTORY_PANEL_CLASS_NAME,
  validateMcpServerDraft,
} from "./PluginsDialog";
import { CustomMcpServers, PluginsCatalog } from "./PluginsCatalog";
import { buildPluginSections } from "./pluginPresentation";
import { planPluginToggle, pluginMcpServerId } from "./pluginRegistry";

const catalog = loadCatalog();
const firecrawl = catalog.find((plugin) => plugin.id === "firecrawl");
if (!firecrawl) throw new TypeError("Firecrawl is missing from the plugin catalog.");
const executor = catalog.find((plugin) => plugin.id === "executor");
if (!executor) throw new TypeError("Executor is missing from the plugin catalog.");
const exa = catalog.find((plugin) => plugin.id === "exa");
if (!exa) throw new TypeError("Exa is missing from the plugin catalog.");

const rawServer: McpServer = {
  id: McpServerId.make("raw-filesystem"),
  name: "Raw filesystem",
  transport: "stdio",
  command: "bunx",
  args: ["@modelcontextprotocol/server-filesystem", "."],
  enabled: true,
  createdAt: "2026-08-27T00:00:00.000Z",
  updatedAt: "2026-08-27T00:00:00.000Z",
};

describe("Plugins dialog content", () => {
  it("keeps the marketplace and plugin details at one fixed size", () => {
    expect(PLUGIN_DIALOG_CLASS_NAME).toContain("h-[min(48rem,90dvh)]");
    expect(PLUGIN_DIALOG_CLASS_NAME).not.toContain("has-");
  });

  it("keeps the directory header and sections inside the fixed dialog", () => {
    expect(PLUGIN_DIRECTORY_HEADER_CLASS_NAME).not.toContain("border-b");
    expect(PLUGIN_DIRECTORY_HEADER_CLASS_NAME).toContain("shrink-0");
    expect(PLUGIN_DIRECTORY_PANEL_CLASS_NAME).toContain("pt-5!");
    expect(PLUGIN_DIRECTORY_PANEL_CLASS_NAME).toContain("min-w-0");
    expect(PLUGIN_DIRECTORY_PANEL_CLASS_NAME).toContain("w-full");
    expect(PLUGIN_DIRECTORY_PANEL_CLASS_NAME).toContain("overflow-x-hidden");
  });

  it("renders a categorized directory with compact add and configure controls", () => {
    const markup = renderToStaticMarkup(
      <PluginsCatalog
        sections={buildPluginSections({ plugins: catalog, query: "", filter: "All" })}
        servers={[]}
        pendingServerId={null}
        pendingActionLabel={null}
        activeLoginServerId={null}
        connectionByServerId={new Map()}
        onToggle={() => undefined}
        onConnect={() => undefined}
        onCancelConnect={() => undefined}
        onOpen={() => undefined}
        onViewAll={() => undefined}
      />,
    );
    expect(markup).toContain("Featured");
    expect(markup).toContain("Data Extraction");
    expect(markup).toContain("Search");
    expect(markup).toContain("Productivity");
    expect(markup).toContain("Executor");
    expect(markup).toContain("Add Firecrawl");
    expect(markup).toContain("Open Firecrawl");
    expect(markup).toContain("cursor-pointer");
    expect(markup).not.toContain("Configure Firecrawl");
    expect(markup).toContain("/plugin-logos/context.png");
    expect(markup).toContain("/plugin-logos/firecrawl.svg");
    expect(markup).toContain("/plugin-logos/exa.svg");
    expect(markup).toContain("/plugin-logos/executor.png");
    expect(markup).toContain("/plugin-logos/parallel.svg");
    expect(markup).toContain("/plugin-logos/tinyfish.svg");
    for (const plugin of catalog) expect(markup).toContain(`data-plugin-id="${plugin.id}"`);
  });

  it("shows explicit progress and connected state on every duplicate catalog entry", () => {
    const serverId = pluginMcpServerId(executor);
    const installedServer: McpServer = {
      id: serverId,
      name: "Executor",
      transport: "url",
      url: executor.url ?? "",
      authentication: "oauth",
      enabled: true,
      createdAt: "2026-08-27T00:00:00.000Z",
      updatedAt: "2026-08-27T00:00:00.000Z",
    };
    const sections = buildPluginSections({ plugins: [executor], query: "", filter: "All" });
    const render = (
      pendingActionLabel: string | null,
      connection: "connecting" | "connected" | undefined,
    ) =>
      renderToStaticMarkup(
        <PluginsCatalog
          sections={sections}
          servers={[installedServer]}
          pendingServerId={pendingActionLabel ? serverId : null}
          pendingActionLabel={pendingActionLabel}
          activeLoginServerId={null}
          connectionByServerId={
            connection
              ? new Map([
                  [
                    String(serverId),
                    connection === "connected"
                      ? { mcpServerId: serverId, status: "connected" as const, toolCount: 2 }
                      : { mcpServerId: serverId, status: connection },
                  ],
                ])
              : new Map()
          }
          onToggle={() => undefined}
          onConnect={() => undefined}
          onCancelConnect={() => undefined}
          onOpen={() => undefined}
          onViewAll={() => undefined}
        />,
      );

    const pending = render("Connecting…", "connecting");
    expect(pending.match(/data-plugin-id="executor"/g)).toHaveLength(2);
    expect(pending.match(/aria-label="Connect Executor"/g)).toHaveLength(2);
    expect(pending.match(/aria-busy="true"/g)).toHaveLength(2);
    expect(pending.match(/>Connecting…<\/button>/g)).toHaveLength(2);
    expect(pending.match(/role="status"/g)).toHaveLength(1);

    const connected = render(null, "connected");
    expect(connected.match(/aria-label="Open Executor details"/g)).toHaveLength(2);
    expect(connected).not.toContain('aria-label="Connected Executor"');
    expect(connected).not.toContain('aria-label="Connect Executor"');

    const loading = render(null, undefined);
    expect(loading.match(/aria-label="Connect Executor"/g)).toHaveLength(2);
    expect(loading).not.toContain('aria-label="Added Executor"');
  });

  it("keeps a connecting plugin actionable instead of a dead disabled button", () => {
    const serverId = pluginMcpServerId(firecrawl);
    const installedServer: McpServer = {
      id: serverId,
      name: "Firecrawl",
      transport: "url",
      url: firecrawl.url ?? "",
      authentication: "oauth",
      enabled: true,
      createdAt: "2026-08-27T00:00:00.000Z",
      updatedAt: "2026-08-27T00:00:00.000Z",
    };
    const sections = buildPluginSections({ plugins: [firecrawl], query: "", filter: "All" });
    const render = (activeLoginServerId: string | null) =>
      renderToStaticMarkup(
        <PluginsCatalog
          sections={sections}
          servers={[installedServer]}
          pendingServerId={null}
          pendingActionLabel={null}
          activeLoginServerId={activeLoginServerId}
          connectionByServerId={
            new Map([[String(serverId), { mcpServerId: serverId, status: "connecting" as const }]])
          }
          onToggle={() => undefined}
          onConnect={() => undefined}
          onCancelConnect={() => undefined}
          onOpen={() => undefined}
          onViewAll={() => undefined}
        />,
      );

    // A stale login from another client or an abandoned tab restarts the flow.
    const stale = render(null);
    expect(stale).toContain("Connect Firecrawl");
    expect(stale).not.toContain('disabled=""');

    // The client that started the login can cancel it.
    const active = render(String(serverId));
    expect(active).toContain("Cancel Firecrawl");
  });

  it("offers disconnect for a connected plugin and remove before that", () => {
    const serverId = pluginMcpServerId(firecrawl);
    const connected = renderToStaticMarkup(
      <PluginDetailsContent
        plugin={firecrawl}
        installed
        connection={{ mcpServerId: serverId, status: "connected", toolCount: 4 }}
        pending={false}
        onToggle={() => undefined}
        onDisconnect={() => undefined}
        onCopySource={() => undefined}
        onViewSource={() => undefined}
        onOpenSkill={() => undefined}
      />,
    );
    expect(connected).toContain("Connected · 4 tools");
    expect(connected).toContain('aria-label="Firecrawl connected"');
    expect(connected).toContain("Disconnect Firecrawl");

    const failed = renderToStaticMarkup(
      <PluginDetailsContent
        plugin={firecrawl}
        installed
        connection={{
          mcpServerId: serverId,
          status: "failed",
          error: "Authorization timed out. Connect the plugin again.",
        }}
        pending={false}
        onToggle={() => undefined}
        onCopySource={() => undefined}
        onViewSource={() => undefined}
        onOpenSkill={() => undefined}
      />,
    );
    expect(failed).toContain("Authorization timed out. Connect the plugin again.");
    expect(failed).toContain("Remove Firecrawl");
    expect(failed).toContain("Retry Firecrawl");

    const loading = renderToStaticMarkup(
      <PluginDetailsContent
        plugin={firecrawl}
        installed
        pending
        pendingActionLabel="Connecting…"
        onToggle={() => undefined}
        onConnect={() => undefined}
        onCopySource={() => undefined}
        onViewSource={() => undefined}
        onOpenSkill={() => undefined}
      />,
    );
    expect(loading).toContain('aria-label="Connect Firecrawl"');
    expect(loading).toContain('aria-busy="true"');
    expect(loading).toContain('role="status"');
    expect(loading).toContain("Connecting Firecrawl");
    expect(loading).not.toContain('aria-label="Connecting Firecrawl"');
    expect(loading).not.toContain('aria-label="Added Firecrawl"');

    const added = renderToStaticMarkup(
      <PluginDetailsContent
        plugin={exa}
        installed
        pending={false}
        onToggle={() => undefined}
        onCopySource={() => undefined}
        onViewSource={() => undefined}
        onOpenSkill={() => undefined}
      />,
    );
    expect(added).toContain('aria-label="Remove Exa"');
    expect(added).not.toContain('aria-label="Added Exa"');
  });

  it("shows plugin information instead of transport configuration", () => {
    const markup = renderToStaticMarkup(
      <PluginDetailsContent
        plugin={firecrawl}
        installed={false}
        pending={false}
        onToggle={() => undefined}
        onCopySource={() => undefined}
        onViewSource={() => undefined}
        onOpenSkill={() => undefined}
      />,
    );
    expect(markup).toContain("Documentation");
    expect(markup).toContain("Copy link");
    expect(markup).toContain("Connector");
    expect(markup).toContain("1 available");
    expect(markup).toContain("MCP connector");
    expect(markup).toContain("pt-6!");
    expect(markup).not.toContain("Transport");
    expect(markup).not.toContain("Arguments, one per line");
  });

  it("shows official skills as separate installs", () => {
    const markup = renderToStaticMarkup(
      <PluginDetailsContent
        plugin={firecrawl}
        installed={false}
        pending={false}
        onToggle={() => undefined}
        onCopySource={() => undefined}
        onViewSource={() => undefined}
        onOpenSkill={() => undefined}
      />,
    );
    expect(markup).toContain("Skills");
    expect(markup).toContain("Installed separately");
    expect(markup).toContain("Firecrawl CLI");
  });

  it("plans the Firecrawl switch through the MCP registry", () => {
    expect(planPluginToggle(firecrawl, [], true)).toEqual({
      action: "create",
      mcpServerId: pluginMcpServerId(firecrawl),
      configuration: {
        name: "Firecrawl",
        transport: "url",
        url: "https://mcp.firecrawl.dev/v2/mcp-oauth",
        authentication: "oauth",
      },
    });
  });

  it("keeps existing custom MCP controls and validates editor input", () => {
    const markup = renderToStaticMarkup(
      <CustomMcpServers
        servers={[rawServer]}
        pendingServerId={null}
        onToggle={() => undefined}
        onEdit={() => undefined}
        onDelete={() => undefined}
      />,
    );
    expect(markup).toContain("Raw filesystem");
    expect(markup).toContain("Disable Raw filesystem");
    expect(markup).toContain("Edit Raw filesystem");
    expect(markup).toContain("Delete Raw filesystem");
    expect(validateMcpServerDraft(EMPTY_MCP_SERVER_DRAFT)).toBe("Name is required.");
    expect(
      validateMcpServerDraft({
        ...EMPTY_MCP_SERVER_DRAFT,
        name: "Remote tools",
        transport: "url",
        url: "https://mcp.example.com",
      }),
    ).toBeNull();
  });
});
