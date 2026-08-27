import type { Workspace } from "@mastra/core/workspace";
import type { BotId, BotSandbox, BotSandboxBrowserSharing } from "@t3tools/contracts";

export function botRuntimeResourceScope(input: {
  readonly sharing: BotSandboxBrowserSharing;
  readonly botId?: BotId;
  readonly threadId: string;
}): string {
  if (input.sharing === "shared") return "shared";
  return input.botId ? `bot-${input.botId}` : `thread-${input.threadId}`;
}

export function botWorkspaceResourceKey(input: {
  readonly resourceScope: string;
  readonly cwd?: string;
  readonly sandbox?: BotSandbox | null;
}): string {
  const sandbox = input.sandbox ?? "local";
  return sandbox === "local"
    ? `${sandbox}:${input.cwd ?? "no-workspace"}:${input.resourceScope}`
    : `${sandbox}:${input.resourceScope}`;
}

export interface BotWorkspaceLease {
  readonly workspace: Workspace;
  readonly release: () => Promise<void>;
}

interface BotWorkspacePoolEntry {
  readonly workspace: Promise<Workspace>;
  references: number;
  closing?: Promise<void>;
}

/** Keeps one workspace alive while matching thread sessions use it. */
export class BotWorkspacePool {
  private readonly entries = new Map<string, BotWorkspacePoolEntry>();

  async acquire(key: string, create: () => Promise<Workspace>): Promise<BotWorkspaceLease> {
    const current = this.entries.get(key);
    if (current?.closing) {
      await current.closing;
      return this.acquire(key, create);
    }

    const entry = current ?? { workspace: create(), references: 0 };
    if (!current) this.entries.set(key, entry);
    entry.references += 1;

    let workspace: Workspace;
    try {
      workspace = await entry.workspace;
    } catch (error) {
      entry.references -= 1;
      if (entry.references === 0 && this.entries.get(key) === entry) {
        this.entries.delete(key);
      }
      throw error;
    }

    let released = false;
    return {
      workspace,
      release: async () => {
        if (released) return;
        released = true;
        entry.references -= 1;
        if (entry.references > 0 || this.entries.get(key) !== entry) return;

        entry.closing = workspace.destroy().finally(() => {
          if (this.entries.get(key) === entry) this.entries.delete(key);
        });
        await entry.closing;
      },
    };
  }

  async destroyAll(): Promise<void> {
    const entries = [...this.entries.entries()];
    await Promise.all(
      entries.map(async ([key, entry]) => {
        if (!entry.closing) {
          entry.closing = entry.workspace
            .then((workspace) => workspace.destroy())
            .finally(() => {
              if (this.entries.get(key) === entry) this.entries.delete(key);
            });
        }
        await entry.closing;
      }),
    );
  }
}
