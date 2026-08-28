// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import type { LocalSubscriptionCliId, LocalSubscriptionCliStatus } from "@t3tools/contracts";

interface LocalCliDefinition {
  readonly id: LocalSubscriptionCliId;
  readonly label: string;
  readonly commands: readonly string[];
  readonly installStep: string;
}

const LOCAL_CLI_DEFINITIONS: readonly LocalCliDefinition[] = [
  {
    id: "claude",
    label: "Claude Code",
    commands: ["claude"],
    installStep: "Install Claude Code, then connect Claude above.",
  },
  {
    id: "codex",
    label: "Codex",
    commands: ["codex"],
    installStep: "Install Codex, then connect ChatGPT above.",
  },
  {
    id: "cursor",
    label: "Cursor and Kimi",
    commands: ["cursor-agent"],
    installStep: "Install the Cursor agent CLI, then connect Cursor or Kimi above.",
  },
  {
    id: "gemini",
    label: "Gemini CLI",
    commands: ["gemini"],
    installStep: "Install Gemini CLI, then refresh provider detection.",
  },
  {
    id: "grok",
    label: "Grok",
    commands: ["grok"],
    installStep: "Install the Grok CLI, then connect Grok above.",
  },
  {
    id: "opencode",
    label: "OpenCode",
    commands: ["opencode"],
    installStep: "Install OpenCode, then refresh provider detection.",
  },
];

function executableNames(
  command: string,
  platform: NodeJS.Platform,
  pathExtensions: string,
): readonly string[] {
  if (platform !== "win32") return [command];
  const extensions = pathExtensions.split(";").filter(Boolean);
  return [command, ...extensions.map((extension) => `${command}${extension.toLowerCase()}`)];
}

export function resolveLocalCommand(input: {
  readonly commands: readonly string[];
  readonly pathValue: string;
  readonly platform: NodeJS.Platform;
  readonly pathExtensions?: string;
}): { readonly command: string; readonly resolvedPath: string } | undefined {
  const platform = input.platform;
  const directories = input.pathValue.split(NodePath.delimiter).filter(Boolean);
  for (const command of input.commands) {
    for (const directory of directories) {
      for (const name of executableNames(
        command,
        platform,
        input.pathExtensions ?? ".EXE;.CMD;.BAT;.COM",
      )) {
        const candidate = NodePath.join(directory, name);
        try {
          NodeFS.accessSync(
            candidate,
            platform === "win32" ? NodeFS.constants.F_OK : NodeFS.constants.X_OK,
          );
          if (NodeFS.statSync(candidate).isFile()) return { command, resolvedPath: candidate };
        } catch {
          // Continue to the next PATH candidate.
        }
      }
    }
  }
  return undefined;
}

export function discoverLocalSubscriptionClis(
  pathValue: string,
  platform: NodeJS.Platform,
  pathExtensions?: string,
): readonly LocalSubscriptionCliStatus[] {
  return LOCAL_CLI_DEFINITIONS.map((definition) => {
    const detected = resolveLocalCommand({
      commands: definition.commands,
      pathValue,
      platform,
      ...(pathExtensions ? { pathExtensions } : {}),
    });
    if (detected) {
      return {
        id: definition.id,
        label: definition.label,
        state: "detected" as const,
        command: detected.command,
        resolvedPath: detected.resolvedPath,
        nextStep: "Ready. Connect the matching subscription above and select one of its models.",
      };
    }
    return {
      id: definition.id,
      label: definition.label,
      state: "missing" as const,
      command: definition.commands[0]!,
      nextStep: definition.installStep,
    };
  });
}
