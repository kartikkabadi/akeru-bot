import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, McpAuthConnectionStatus } from "@t3tools/contracts";
import { useEffect, useMemo, useState } from "react";
import type { PluginDefinition } from "../../../../../plugins";
import { ensureLocalApi } from "../../localApi";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { toastManager } from "../ui/toast";
import { buildMcpOAuthRedirectUrl, storeMcpOAuthReturnLocation } from "./mcpOAuthCallback";
import { pluginMcpServerId } from "./pluginRegistry";

interface ActiveMcpLogin {
  readonly loginId: string;
  readonly plugin: PluginDefinition;
}

function reportFailure(title: string, result: AtomCommandResult<unknown, unknown>): boolean {
  if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return false;
  const error = squashAtomCommandFailure(result);
  toastManager.add({
    type: "error",
    title,
    description: error instanceof Error ? error.message : "The command failed.",
  });
  return true;
}

/** Owns the browser OAuth lifecycle and its temporary connection presentation state. */
export function useMcpPluginAuth(input: {
  readonly environmentId: EnvironmentId;
  readonly environmentHttpBaseUrl: string | null;
  readonly beginPendingAction: (mcpServerId: string, label?: string | null) => void;
  readonly finishPendingAction: () => void;
}) {
  const start = useAtomCommand(serverEnvironment.startMcpAuth, { reportFailure: false });
  const poll = useAtomCommand(serverEnvironment.pollMcpAuth, { reportFailure: false });
  const cancel = useAtomCommand(serverEnvironment.cancelMcpAuth, { reportFailure: false });
  const disconnect = useAtomCommand(serverEnvironment.disconnectMcpAuth, { reportFailure: false });
  const query = useEnvironmentQuery(
    serverEnvironment.mcpAuth({ environmentId: input.environmentId, input: {} }),
  );
  const [overrides, setOverrides] = useState<ReadonlyMap<string, McpAuthConnectionStatus>>(
    new Map(),
  );
  const [activeLogin, setActiveLogin] = useState<ActiveMcpLogin | null>(null);

  const connectionByServerId = useMemo(() => {
    const connections = new Map<string, McpAuthConnectionStatus>(
      query.data?.connections.map((connection) => [String(connection.mcpServerId), connection]) ??
        [],
    );
    for (const [serverId, connection] of overrides) connections.set(serverId, connection);
    return connections;
  }, [overrides, query.data]);

  useEffect(() => {
    const serverConnections = query.data?.connections;
    if (!serverConnections) return;
    setOverrides((current) => {
      const next = new Map(current);
      let changed = false;
      for (const connection of serverConnections) {
        if (next.delete(String(connection.mcpServerId))) changed = true;
      }
      return changed ? next : current;
    });
  }, [query.data]);

  const setOverride = (connection: McpAuthConnectionStatus) => {
    setOverrides((current) => {
      const next = new Map(current);
      next.set(String(connection.mcpServerId), connection);
      return next;
    });
  };

  const clearOverride = (mcpServerId: string) => {
    setOverrides((current) => {
      if (!current.has(mcpServerId)) return current;
      const next = new Map(current);
      next.delete(mcpServerId);
      return next;
    });
  };

  const connectPlugin = async (plugin: PluginDefinition) => {
    if (plugin.kind !== "mcp-url" || plugin.authentication !== "oauth") return;
    const pageUrl = new URL(window.location.href);
    const callbackOrigin =
      pageUrl.protocol === "http:" || pageUrl.protocol === "https:"
        ? pageUrl.origin
        : input.environmentHttpBaseUrl;
    if (!callbackOrigin) {
      toastManager.add({
        type: "error",
        title: `Could not connect ${plugin.title}`,
        description: "This environment has no browser callback address.",
      });
      return;
    }
    const mcpServerId = pluginMcpServerId(plugin);
    clearOverride(String(mcpServerId));
    input.beginPendingAction(mcpServerId, "Connecting…");
    const result = await start({
      environmentId: input.environmentId,
      input: {
        mcpServerId,
        redirectUrl: buildMcpOAuthRedirectUrl(callbackOrigin, input.environmentId),
      },
    });
    input.finishPendingAction();
    if (result._tag === "Failure") {
      reportFailure(`Could not connect ${plugin.title}`, result);
      query.refresh();
      return;
    }
    if (result.value.status === "connected") {
      setOverride({ mcpServerId, status: "connected", toolCount: result.value.toolCount });
      toastManager.add({
        type: "success",
        title: `${plugin.title} connected`,
        description: `${result.value.toolCount} tools discovered.`,
      });
      query.refresh();
      return;
    }
    setOverride({ mcpServerId, status: "connecting" });
    setActiveLogin({ loginId: result.value.loginId, plugin });
    query.refresh();
    if (window.desktopBridge) {
      await ensureLocalApi()
        .shell.openExternal(result.value.authorizationUrl)
        .catch(() =>
          toastManager.add({ type: "error", title: "Could not open authorization page" }),
        );
      return;
    }
    storeMcpOAuthReturnLocation(new URL(window.location.href));
    window.location.assign(result.value.authorizationUrl);
  };

  const cancelConnect = async () => {
    if (!activeLogin) return;
    const { loginId, plugin } = activeLogin;
    setActiveLogin(null);
    const result = await cancel({ environmentId: input.environmentId, input: { loginId } });
    if (result._tag === "Success") {
      setOverride({
        mcpServerId: pluginMcpServerId(plugin),
        status: "failed",
        error: "Authorization was canceled. Connect the plugin again.",
      });
    }
    query.refresh();
    reportFailure(`Could not cancel the ${plugin.title} connection`, result);
  };

  const disconnectPlugin = async (plugin: PluginDefinition) => {
    const mcpServerId = pluginMcpServerId(plugin);
    input.beginPendingAction(mcpServerId, "Disconnecting…");
    const result = await disconnect({
      environmentId: input.environmentId,
      input: { mcpServerId },
    });
    input.finishPendingAction();
    if (result._tag === "Success") clearOverride(String(mcpServerId));
    query.refresh();
    reportFailure(`Could not disconnect ${plugin.title}`, result);
  };

  useEffect(() => {
    if (!activeLogin) return;
    let cancelled = false;
    let timer: number | undefined;
    const pollLogin = async () => {
      const result = await poll({
        environmentId: input.environmentId,
        input: { loginId: activeLogin.loginId },
      });
      if (cancelled || isAtomCommandInterrupted(result)) return;
      if (result._tag === "Failure") {
        setActiveLogin(null);
        query.refresh();
        reportFailure(`Could not connect ${activeLogin.plugin.title}`, result);
        return;
      }
      if (result.value.status === "connected") {
        setOverride({
          mcpServerId: pluginMcpServerId(activeLogin.plugin),
          status: "connected",
          toolCount: result.value.toolCount,
        });
        setActiveLogin(null);
        query.refresh();
        toastManager.add({
          type: "success",
          title: `${activeLogin.plugin.title} connected`,
          description: `${result.value.toolCount} tools discovered.`,
        });
        return;
      }
      if (result.value.status === "failed") {
        setOverride({
          mcpServerId: pluginMcpServerId(activeLogin.plugin),
          status: "failed",
          error: result.value.error,
        });
        setActiveLogin(null);
        query.refresh();
        toastManager.add({
          type: "error",
          title: `Could not connect ${activeLogin.plugin.title}`,
          description: result.value.error,
        });
        return;
      }
      timer = window.setTimeout(pollLogin, Math.max(1_000, result.value.nextPollMs));
    };
    timer = window.setTimeout(pollLogin, 1_000);
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [activeLogin, input.environmentId, poll]);

  return {
    activeLoginPluginId: activeLogin?.plugin.id ?? null,
    activeLoginServerId: activeLogin ? String(pluginMcpServerId(activeLogin.plugin)) : null,
    connectionByServerId,
    clearConnectionOverride: clearOverride,
    connectPlugin,
    cancelConnect,
    disconnectPlugin,
  } as const;
}
