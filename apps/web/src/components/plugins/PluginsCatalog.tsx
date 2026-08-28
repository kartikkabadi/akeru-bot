import type { McpAuthConnectionStatus, McpServer } from "@t3tools/contracts";
import { CheckIcon, PencilIcon, Trash2Icon } from "lucide-react";
import type { PluginDefinition } from "../../../../../plugins";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { findPluginServer, pluginMcpServerId } from "./pluginRegistry";
import type { PluginFilter, PluginSection } from "./pluginPresentation";

export function PluginLogoImage({
  plugin,
  className,
}: {
  readonly plugin: PluginDefinition;
  readonly className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted p-2",
        className,
      )}
    >
      <img
        alt=""
        className={`size-full object-contain ${plugin.logo.darkSrc ? "dark:hidden" : ""}`}
        src={plugin.logo.src}
      />
      {plugin.logo.darkSrc ? (
        <img
          alt=""
          className="hidden size-full object-contain dark:block"
          src={plugin.logo.darkSrc}
        />
      ) : null}
    </span>
  );
}

interface PluginsCatalogProps {
  readonly sections: readonly PluginSection[];
  readonly servers: readonly McpServer[];
  readonly pendingServerId: string | null;
  readonly pendingActionLabel: string | null;
  readonly activeLoginServerId: string | null;
  readonly connectionByServerId: ReadonlyMap<string, McpAuthConnectionStatus>;
  readonly onToggle: (plugin: PluginDefinition, enabled: boolean) => void;
  readonly onConnect: (plugin: PluginDefinition) => void;
  readonly onCancelConnect: (plugin: PluginDefinition) => void;
  readonly onOpen: (plugin: PluginDefinition) => void;
  readonly onViewAll: (filter: PluginFilter) => void;
}

interface PluginActionProps {
  readonly plugin: PluginDefinition;
  readonly server: McpServer | undefined;
  readonly connection: McpAuthConnectionStatus | undefined;
  readonly pendingActionLabel: string | null;
  readonly activeLogin: boolean;
  readonly onToggle: (enabled: boolean) => void;
  readonly onConnect: () => void;
  readonly onCancelConnect: () => void;
  readonly onOpen: () => void;
}

/**
 * One Add / Connect / Added pill shared by the row and card layouts. A
 * connecting plugin stays actionable: the client that started the login can
 * cancel it, and any other client can restart the flow instead of waiting
 * for the ten-minute server timeout.
 */
function PluginActionButton({
  plugin,
  server,
  connection,
  pendingActionLabel,
  activeLogin,
  onToggle,
  onConnect,
  onCancelConnect,
  onOpen,
  className,
}: PluginActionProps & { readonly className?: string }) {
  const installed = server?.enabled ?? false;
  const needsAuthentication =
    installed &&
    plugin.kind === "mcp-url" &&
    plugin.authentication === "oauth" &&
    connection?.status !== "connected";
  const connecting = connection?.status === "connecting";
  const buttonLabel = !installed
    ? "Add"
    : needsAuthentication
      ? connecting
        ? activeLogin
          ? "Cancel"
          : "Connect"
        : connection?.status === "failed"
          ? "Retry"
          : "Connect"
      : connection?.status === "connected"
        ? "Connected"
        : "Added";
  const onClick = !installed
    ? () => onToggle(true)
    : needsAuthentication
      ? connecting && activeLogin
        ? onCancelConnect
        : onConnect
      : connection?.status === "connected"
        ? onOpen
        : () => onToggle(false);
  const visibleLabel = pendingActionLabel ?? buttonLabel;
  const accessibleLabel =
    connection?.status === "connected"
      ? `Open ${plugin.title} details`
      : installed && !needsAuthentication
        ? `Remove ${plugin.title}`
        : `${buttonLabel} ${plugin.title}`;
  return (
    <span
      className={cn(
        "inline-flex shrink-0",
        pendingActionLabel !== null && "cursor-wait",
        className,
      )}
    >
      <Button
        aria-busy={pendingActionLabel !== null}
        aria-label={accessibleLabel}
        className="h-7 min-w-14 rounded-full px-3 text-xs disabled:opacity-100"
        size="sm"
        variant="secondary"
        disabled={pendingActionLabel !== null}
        onClick={onClick}
      >
        {!pendingActionLabel && installed && !needsAuthentication ? (
          <CheckIcon className="size-3.5" />
        ) : null}
        {visibleLabel}
      </Button>
    </span>
  );
}

function PluginRow({
  plugin,
  onOpen,
  showCategory,
  ...action
}: PluginActionProps & { readonly showCategory: boolean }) {
  return (
    <article
      className="group flex min-w-0 items-center rounded-xl pe-2.5 transition-colors hover:bg-muted/45"
      data-plugin-id={plugin.id}
    >
      <button
        aria-label={`Open ${plugin.title}`}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2.5 text-start outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
        type="button"
        onClick={onOpen}
      >
        <PluginLogoImage plugin={plugin} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-baseline gap-2">
            <h3 className="truncate text-sm font-medium leading-5">{plugin.title}</h3>
            {showCategory ? (
              <span className="shrink-0 text-[11px] text-muted-foreground">{plugin.category}</span>
            ) : null}
          </div>
          <p className="truncate text-xs leading-5 text-muted-foreground">{plugin.description}</p>
        </div>
      </button>
      <PluginActionButton plugin={plugin} onOpen={onOpen} {...action} />
    </article>
  );
}

/** Featured layout: a bordered card with room for two description lines. */
function PluginCard({ plugin, onOpen, ...action }: PluginActionProps) {
  return (
    <article
      className="relative flex min-w-0 flex-col gap-3 rounded-2xl border border-border/60 bg-card/40 p-4 transition-colors hover:bg-muted/40"
      data-plugin-id={plugin.id}
    >
      <button
        aria-label={`Open ${plugin.title}`}
        className="absolute inset-0 cursor-pointer rounded-2xl outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
        type="button"
        onClick={onOpen}
      />
      <div className="flex items-start justify-between gap-3">
        <PluginLogoImage className="size-11 rounded-xl" plugin={plugin} />
        <PluginActionButton className="relative" plugin={plugin} onOpen={onOpen} {...action} />
      </div>
      <div className="min-w-0">
        <h3 className="truncate text-sm font-semibold leading-5">{plugin.title}</h3>
        <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
          {plugin.description}
        </p>
      </div>
    </article>
  );
}

export function PluginsCatalog({
  sections,
  servers,
  pendingServerId,
  pendingActionLabel,
  activeLoginServerId,
  connectionByServerId,
  onToggle,
  onConnect,
  onCancelConnect,
  onOpen,
  onViewAll,
}: PluginsCatalogProps) {
  const resultCount = sections.reduce((count, section) => count + section.plugins.length, 0);
  if (resultCount === 0) {
    return <p className="py-14 text-center text-sm text-muted-foreground">No plugins match.</p>;
  }
  const pendingPlugin = pendingServerId
    ? sections
        .flatMap((section) => section.plugins)
        .find((plugin) => pluginMcpServerId(plugin) === pendingServerId)
    : undefined;
  const pendingStatus =
    pendingActionLabel && pendingPlugin
      ? `${pendingActionLabel.replace("…", "")} ${pendingPlugin.title}`
      : "";
  return (
    <div className="w-full min-w-0 space-y-7">
      <span aria-live="polite" className="sr-only" role="status">
        {pendingStatus}
      </span>
      {sections.map((section) => (
        <section aria-label={section.title} className="min-w-0" key={section.title}>
          <div className="mb-2.5 flex items-baseline justify-between px-2">
            <h2 className="text-sm font-semibold leading-5">{section.title}</h2>
            {section.showViewAll ? (
              <button
                className="cursor-pointer rounded text-xs text-muted-foreground outline-hidden hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                type="button"
                onClick={() => onViewAll(section.filter)}
              >
                View all
              </button>
            ) : null}
          </div>
          <div
            className={cn(
              "grid min-w-0 grid-cols-1",
              section.layout === "cards" ? "gap-3 sm:grid-cols-2" : "gap-x-7 md:grid-cols-2",
            )}
          >
            {section.plugins.map((plugin) => {
              const shared = {
                plugin,
                server: findPluginServer(plugin, servers),
                connection: connectionByServerId.get(String(pluginMcpServerId(plugin))),
                pendingActionLabel:
                  pendingServerId === pluginMcpServerId(plugin) ? pendingActionLabel : null,
                activeLogin: activeLoginServerId === String(pluginMcpServerId(plugin)),
                onToggle: (enabled: boolean) => onToggle(plugin, enabled),
                onConnect: () => onConnect(plugin),
                onCancelConnect: () => onCancelConnect(plugin),
                onOpen: () => onOpen(plugin),
              };
              return section.layout === "cards" ? (
                <PluginCard key={`${section.title}:${plugin.id}`} {...shared} />
              ) : (
                <PluginRow
                  key={`${section.title}:${plugin.id}`}
                  showCategory={section.title === "Search results"}
                  {...shared}
                />
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

function serverDescription(server: McpServer): string {
  return server.transport === "url"
    ? server.url
    : [server.command, ...(server.args ?? [])].join(" ");
}

interface CustomMcpServersProps {
  readonly servers: readonly McpServer[];
  readonly pendingServerId: string | null;
  readonly onToggle: (server: McpServer, enabled: boolean) => void;
  readonly onEdit: (server: McpServer) => void;
  readonly onDelete: (server: McpServer) => void;
}

export function CustomMcpServers({
  servers,
  pendingServerId,
  onToggle,
  onEdit,
  onDelete,
}: CustomMcpServersProps) {
  if (servers.length === 0) return null;
  return (
    <section aria-labelledby="custom-mcp-title">
      <div className="mb-2 flex items-center justify-between px-2">
        <h2 className="text-sm font-semibold leading-5" id="custom-mcp-title">
          Custom MCP servers
        </h2>
        <span className="text-xs text-muted-foreground">{servers.length}</span>
      </div>
      <div className="grid grid-cols-1 gap-x-7 md:grid-cols-2">
        {servers.map((server) => {
          const pending = pendingServerId === server.id;
          return (
            <div
              className="group flex min-w-0 items-center gap-3 rounded-xl px-2.5 py-2.5 transition-colors hover:bg-muted/45"
              key={server.id}
            >
              <span
                aria-hidden="true"
                className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted p-2"
              >
                <img
                  alt=""
                  className="size-full object-contain dark:hidden"
                  src="/plugin-logos/mcp.svg"
                />
                <img
                  alt=""
                  className="hidden size-full object-contain dark:block"
                  src="/plugin-logos/mcp-dark.svg"
                />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{server.name}</p>
                <p className="truncate text-xs leading-5 text-muted-foreground">
                  {serverDescription(server)}
                </p>
              </div>
              <Button
                aria-label={`Edit ${server.name}`}
                className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 max-sm:opacity-100"
                size="icon-sm"
                variant="ghost-muted"
                disabled={pending}
                onClick={() => onEdit(server)}
              >
                <PencilIcon className="size-3.5" />
              </Button>
              <Button
                aria-label={`Delete ${server.name}`}
                className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 max-sm:opacity-100"
                size="icon-sm"
                variant="ghost-muted"
                disabled={pending}
                onClick={() => onDelete(server)}
              >
                <Trash2Icon className="size-3.5" />
              </Button>
              <Button
                aria-label={`${server.enabled ? "Disable" : "Enable"} ${server.name}`}
                className="h-7 min-w-14 rounded-full px-3 text-xs"
                size="sm"
                variant="secondary"
                disabled={pending}
                onClick={() => onToggle(server, !server.enabled)}
              >
                {server.enabled ? <CheckIcon className="size-3.5" /> : null}
                {server.enabled ? "Added" : "Add"}
              </Button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
