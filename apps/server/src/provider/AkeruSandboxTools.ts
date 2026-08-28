// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import { connectSandbox, createSandbox, type Sandbox } from "@opencoredev/sandbox-sdk";
import type { BotSandbox } from "@t3tools/contracts";

export const REMOTE_BOT_SANDBOXES = ["vercel", "akeru-cloud", "upstash"] as const;
export type RemoteBotSandbox = (typeof REMOTE_BOT_SANDBOXES)[number];

export function isRemoteBotSandbox(
  value: BotSandbox | null | undefined,
): value is RemoteBotSandbox {
  return value === "vercel" || value === "akeru-cloud" || value === "upstash";
}
import type { AkeruToolDefinition, AkeruToolProvider } from "./AkeruToolRegistry.ts";

async function loadProvider(sandbox: RemoteBotSandbox) {
  if (sandbox === "vercel") {
    const { vercel } = await import("@opencoredev/sandbox-sdk/vercel");
    return vercel();
  }
  if (sandbox === "upstash") {
    const { upstash } = await import("@opencoredev/sandbox-sdk/upstash");
    return upstash();
  }
  const { e2b } = await import("@opencoredev/sandbox-sdk/e2b");
  return e2b();
}

function objectInput(input: unknown): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("Tool input must be an object.");
  }
  return input as Record<string, unknown>;
}

function stringInput(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${key} must be a non-empty string.`);
  }
  return value;
}

async function hostPath(root: string, requested: string, destination: boolean): Promise<string> {
  const canonicalRoot = await NodeFSP.realpath(root);
  const candidate = NodePath.resolve(canonicalRoot, requested);
  const canonical = destination
    ? NodePath.join(
        await NodeFSP.realpath(NodePath.dirname(candidate)),
        NodePath.basename(candidate),
      )
    : await NodeFSP.realpath(candidate);
  if (canonical !== canonicalRoot && !canonical.startsWith(`${canonicalRoot}${NodePath.sep}`)) {
    throw new Error("Host path is outside the Akeru transfer directory.");
  }
  if (destination) {
    try {
      if ((await NodeFSP.lstat(canonical)).isSymbolicLink()) {
        throw new Error("Host download destination cannot be a symbolic link.");
      }
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
    }
  }
  return canonical;
}

function sandboxTools(sandbox: Sandbox, transferRoot: string): readonly AkeruToolDefinition[] {
  return [
    {
      name: "Read",
      description: "Read a bounded text file from the active remote sandbox.",
      category: "read",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["path"],
        properties: { path: { type: "string" } },
      },
      execute: async (rawInput) => {
        const path = stringInput(objectInput(rawInput), "path");
        const content = await sandbox.files.text(path);
        const bounded = content.slice(0, 50 * 1024);
        return { path, content: bounded, truncated: bounded.length < content.length };
      },
    },
    {
      name: "Shell",
      description: "Run one command inside the active remote sandbox.",
      category: "execute",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["command"],
        properties: {
          command: { type: "string" },
          timeoutMs: { type: "integer", minimum: 1, maximum: 120_000 },
        },
      },
      execute: async (rawInput, context) => {
        const input = objectInput(rawInput);
        const command = stringInput(input, "command");
        const timeout =
          typeof input.timeoutMs === "number" && Number.isInteger(input.timeoutMs)
            ? Math.min(Math.max(input.timeoutMs, 1), 120_000)
            : 120_000;
        return sandbox.run(command, { timeout, signal: context.signal });
      },
    },
    {
      name: "UploadFile",
      description: "Upload one host file into the active remote sandbox.",
      category: "edit",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["localPath", "sandboxPath"],
        properties: {
          localPath: { type: "string" },
          sandboxPath: { type: "string" },
        },
      },
      execute: async (rawInput) => {
        const input = objectInput(rawInput);
        const localPath = await hostPath(transferRoot, stringInput(input, "localPath"), false);
        const sandboxPath = stringInput(input, "sandboxPath");
        await sandbox.files.upload(localPath, sandboxPath);
        return { localPath, sandboxPath };
      },
    },
    {
      name: "DownloadFile",
      description: "Download one remote sandbox file to an explicit host path.",
      category: "edit",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["sandboxPath", "localPath"],
        properties: {
          sandboxPath: { type: "string" },
          localPath: { type: "string" },
        },
      },
      execute: async (rawInput) => {
        const input = objectInput(rawInput);
        const sandboxPath = stringInput(input, "sandboxPath");
        const localPath = await hostPath(transferRoot, stringInput(input, "localPath"), true);
        const temporaryPath = NodePath.join(
          NodePath.dirname(localPath),
          `.akeru-download-${NodeCrypto.randomUUID()}`,
        );
        try {
          await sandbox.files.download(sandboxPath, temporaryPath);
          await NodeFSP.rename(temporaryPath, localPath);
        } finally {
          await NodeFSP.rm(temporaryPath, { force: true });
        }
        return { sandboxPath, localPath };
      },
    },
  ];
}

const retainedSandboxIds = new Map<string, string>();
const MAX_WORKSPACE_FILES = 10_000;
const MAX_WORKSPACE_BYTES = 100 * 1024 * 1024;
const MAX_WORKSPACE_FILE_BYTES = 20 * 1024 * 1024;

async function gitWorkspaceFiles(root: string, signal?: AbortSignal): Promise<readonly string[]> {
  if (signal?.aborted) throw signal.reason ?? new Error("Remote sandbox workspace sync stopped.");
  return new Promise((resolve, reject) => {
    NodeChildProcess.execFile(
      "git",
      ["-C", root, "ls-files", "-co", "--exclude-standard", "-z"],
      { encoding: "buffer", maxBuffer: 10 * 1024 * 1024, timeout: 30_000, signal },
      (cause, stdout) => {
        if (cause) {
          if (signal?.aborted) {
            reject(signal.reason ?? new Error("Remote sandbox workspace sync stopped."));
            return;
          }
          reject(new Error("Remote sandbox workspace sync needs a Git workspace.", { cause }));
          return;
        }
        const files = stdout.toString("utf8").split("\0").filter(Boolean);
        if (files.length > MAX_WORKSPACE_FILES) {
          reject(new Error(`Remote sandbox workspace exceeds ${MAX_WORKSPACE_FILES} files.`));
          return;
        }
        resolve(files);
      },
    );
  });
}

function sensitiveWorkspacePath(relativePath: string): boolean {
  const normalized = relativePath.split(NodePath.sep).join("/").toLowerCase();
  const segments = normalized.split("/");
  const name = segments.at(-1) ?? "";
  return (
    segments.some(
      (segment) =>
        segment === ".git" || segment === ".ssh" || segment === ".aws" || segment === ".docker",
    ) ||
    (name.startsWith(".env") && name !== ".env.example" && name !== ".env.sample") ||
    name === ".envrc" ||
    name === ".npmrc" ||
    name === ".pypirc" ||
    name === ".netrc" ||
    name === ".git-credentials" ||
    name === "credentials" ||
    name === "credentials.json" ||
    name === "id_rsa" ||
    name === "id_ed25519" ||
    name.endsWith(".pem") ||
    name.endsWith(".key") ||
    name.endsWith(".p12") ||
    name.endsWith(".pfx")
  );
}

function throwIfWorkspaceSyncStopped(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw signal.reason ?? new Error("Remote sandbox workspace sync stopped.");
  }
}

async function syncGitWorkspace(
  sandbox: Sandbox,
  root: string,
  signal?: AbortSignal,
): Promise<void> {
  throwIfWorkspaceSyncStopped(signal);
  const canonicalRoot = await NodeFSP.realpath(root);
  const files = await gitWorkspaceFiles(canonicalRoot, signal);
  const uploads: Array<{ readonly localPath: string; readonly remotePath: string }> = [];
  const directories = new Set<string>();
  let totalBytes = 0;
  for (const relativePath of files) {
    if (sensitiveWorkspacePath(relativePath)) continue;
    throwIfWorkspaceSyncStopped(signal);
    const requestedPath = NodePath.resolve(canonicalRoot, relativePath);
    const relative = NodePath.relative(canonicalRoot, requestedPath);
    if (relative.startsWith("..") || NodePath.isAbsolute(relative)) continue;
    let requestedStat: Awaited<ReturnType<typeof NodeFSP.lstat>>;
    let localPath: string;
    let stat: Awaited<ReturnType<typeof NodeFSP.stat>>;
    try {
      requestedStat = await NodeFSP.lstat(requestedPath);
      if (!requestedStat.isFile() || requestedStat.isSymbolicLink()) continue;
      localPath = await NodeFSP.realpath(requestedPath);
      if (localPath !== canonicalRoot && !localPath.startsWith(`${canonicalRoot}${NodePath.sep}`)) {
        continue;
      }
      stat = await NodeFSP.stat(localPath);
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw cause;
    }
    if (stat.size > MAX_WORKSPACE_FILE_BYTES) {
      throw new Error(`Remote sandbox workspace file '${relativePath}' exceeds 20 MB.`);
    }
    totalBytes += stat.size;
    if (totalBytes > MAX_WORKSPACE_BYTES) {
      throw new Error("Remote sandbox workspace exceeds 100 MB.");
    }
    const remotePath = relative.split(NodePath.sep).join("/");
    let parent = NodePath.posix.dirname(remotePath);
    while (parent !== ".") {
      directories.add(parent);
      parent = NodePath.posix.dirname(parent);
    }
    uploads.push({ localPath, remotePath });
  }
  for (const directory of [...directories].sort(
    (a, b) => a.split("/").length - b.split("/").length,
  )) {
    throwIfWorkspaceSyncStopped(signal);
    await sandbox.files.mkdir(directory);
  }
  for (const upload of uploads) {
    throwIfWorkspaceSyncStopped(signal);
    await sandbox.files.upload(upload.localPath, upload.remotePath);
  }
}

export function createAkeruSandboxToolProvider(input: {
  readonly sandbox: RemoteBotSandbox;
  readonly sessionId?: string;
  readonly cwd?: string;
  readonly workspaceRoot?: string;
  readonly transferRoot: string;
  readonly create?: () => Promise<Sandbox>;
  readonly connect?: (id: string) => Promise<Sandbox>;
}): AkeruToolProvider {
  let active: Sandbox | undefined;
  let retainOnClose = false;
  const retainedKey = input.sessionId ? `${input.sandbox}:${input.sessionId}` : undefined;
  return {
    tools: async (signal) => {
      if (!active) {
        const retainedId = retainedKey ? retainedSandboxIds.get(retainedKey) : undefined;
        let created = false;
        if (retainedId) {
          try {
            active = input.connect
              ? await input.connect(retainedId)
              : await connectSandbox({
                  provider: await loadProvider(input.sandbox),
                  id: retainedId,
                  cwd: input.cwd ?? "/workspace",
                });
            retainOnClose = true;
          } catch {
            if (retainedKey) retainedSandboxIds.delete(retainedKey);
          }
        }
        if (!active) {
          active = await (input.create
            ? input.create()
            : createSandbox({
                provider: await loadProvider(input.sandbox),
                cwd: input.cwd ?? "/workspace",
              }));
          created = true;
        }
        throwIfWorkspaceSyncStopped(signal);
        if (created && input.workspaceRoot) {
          await syncGitWorkspace(active, input.workspaceRoot, signal);
        }
        retainOnClose = true;
        if (retainedKey) retainedSandboxIds.set(retainedKey, active.id);
      }
      return sandboxTools(active, input.transferRoot);
    },
    close: async () => {
      const sandbox = active;
      active = undefined;
      if (sandbox && retainedKey && retainOnClose) retainedSandboxIds.set(retainedKey, sandbox.id);
      await sandbox?.stop();
    },
  };
}
