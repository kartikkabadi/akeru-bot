// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import type { Sandbox } from "@opencoredev/sandbox-sdk";
import { describe, expect, it, vi } from "vite-plus/test";

import { createAkeruSandboxToolProvider } from "./AkeruSandboxTools.ts";

let nextSandboxId = 0;

function fakeSandbox() {
  const stop = vi.fn(async () => undefined);
  const run = vi.fn(async () => ({
    stdout: "remote",
    stderr: "",
    exitCode: 0,
    success: true,
  }));
  const upload = vi.fn(async (_localPath: string, _remotePath: string) => undefined);
  const download = vi.fn(async (_sandboxPath: string, localPath: string) => {
    await NodeFSP.writeFile(localPath, "download");
  });
  const mkdir = vi.fn(async () => undefined);
  const sandbox = {
    id: `sandbox-${++nextSandboxId}`,
    files: {
      text: vi.fn(async () => "remote file"),
      mkdir,
      upload,
      download,
    },
    run,
    stop,
  } as unknown as Sandbox;
  return { sandbox, stop, run, upload, download, mkdir };
}

const context = {
  signal: new AbortController().signal,
  askUser: async () => undefined,
};

describe("Akeru sandbox tools", () => {
  it("backs Read, Shell, and transfer tools with one remote sandbox", async () => {
    const transferRoot = await NodeFSP.mkdtemp(
      NodePath.join(NodeOS.tmpdir(), "akeru-sandbox-transfer-"),
    );
    await NodeFSP.writeFile(NodePath.join(transferRoot, "upload.txt"), "upload");
    const fake = fakeSandbox();
    const provider = createAkeruSandboxToolProvider({
      sandbox: "vercel",
      transferRoot,
      create: async () => fake.sandbox,
    });
    const tools = new Map((await provider.tools()).map((tool) => [tool.name, tool]));

    await expect(
      tools.get("Read")?.execute({ path: "/workspace/a.txt" }, context),
    ).resolves.toMatchObject({
      content: "remote file",
    });
    await expect(tools.get("Shell")?.execute({ command: "pwd" }, context)).resolves.toMatchObject({
      stdout: "remote",
    });
    await tools
      .get("UploadFile")
      ?.execute({ localPath: "upload.txt", sandboxPath: "/workspace/upload.txt" }, context);
    expect(fake.upload).toHaveBeenCalledWith(
      await NodeFSP.realpath(NodePath.join(transferRoot, "upload.txt")),
      "/workspace/upload.txt",
    );
    await tools
      .get("DownloadFile")
      ?.execute({ sandboxPath: "/workspace/result.txt", localPath: "download.txt" }, context);
    await expect(
      NodeFSP.readFile(NodePath.join(transferRoot, "download.txt"), "utf8"),
    ).resolves.toBe("download");

    await provider.close?.();
    expect(fake.stop).toHaveBeenCalledOnce();
  });

  it("copies Git workspace files into a new remote sandbox without ignored secrets", async () => {
    const workspaceRoot = await NodeFSP.mkdtemp(
      NodePath.join(NodeOS.tmpdir(), "akeru-sandbox-workspace-"),
    );
    const transferRoot = await NodeFSP.mkdtemp(
      NodePath.join(NodeOS.tmpdir(), "akeru-sandbox-transfer-"),
    );
    NodeChildProcess.execFileSync("git", ["-C", workspaceRoot, "init", "--quiet"]);
    await NodeFSP.writeFile(NodePath.join(workspaceRoot, ".gitignore"), ".env\n");
    await NodeFSP.writeFile(NodePath.join(workspaceRoot, "tracked.txt"), "tracked");
    await NodeFSP.writeFile(NodePath.join(workspaceRoot, "vanished.txt"), "temporary");
    await NodeFSP.writeFile(NodePath.join(workspaceRoot, "untracked.txt"), "untracked");
    await NodeFSP.writeFile(NodePath.join(workspaceRoot, ".env"), "SECRET=never-upload");
    await NodeFSP.writeFile(
      NodePath.join(workspaceRoot, ".npmrc"),
      "//registry/:_authToken=secret",
    );
    await NodeFSP.writeFile(NodePath.join(workspaceRoot, ".git-credentials"), "secret");
    await NodeFSP.writeFile(NodePath.join(workspaceRoot, ".envrc"), "secret");
    await NodeFSP.writeFile(NodePath.join(workspaceRoot, "certificate.p12"), "secret");
    await NodeFSP.mkdir(NodePath.join(workspaceRoot, ".docker"));
    await NodeFSP.writeFile(NodePath.join(workspaceRoot, ".docker", "config.json"), "secret");
    NodeChildProcess.execFileSync("git", [
      "-C",
      workspaceRoot,
      "add",
      ".gitignore",
      "tracked.txt",
      "vanished.txt",
      ".npmrc",
      ".git-credentials",
      ".envrc",
      "certificate.p12",
      ".docker/config.json",
    ]);
    await NodeFSP.rm(NodePath.join(workspaceRoot, "vanished.txt"));
    const fake = fakeSandbox();
    const provider = createAkeruSandboxToolProvider({
      sandbox: "vercel",
      workspaceRoot,
      transferRoot,
      create: async () => fake.sandbox,
    });

    await provider.tools();

    const remotePaths = fake.upload.mock.calls.map(([, remotePath]) => remotePath);
    expect(remotePaths).toEqual(
      expect.arrayContaining([".gitignore", "tracked.txt", "untracked.txt"]),
    );
    expect(remotePaths).not.toContain("vanished.txt");
    expect(remotePaths).not.toContain(".env");
    expect(remotePaths).not.toContain(".npmrc");
    expect(remotePaths).not.toContain(".git-credentials");
    expect(remotePaths).not.toContain(".envrc");
    expect(remotePaths).not.toContain("certificate.p12");
    expect(remotePaths).not.toContain(".docker/config.json");
    await provider.close?.();
  });

  it("skips tracked files that escape through a directory symlink", async () => {
    const workspaceRoot = await NodeFSP.mkdtemp(
      NodePath.join(NodeOS.tmpdir(), "akeru-sandbox-workspace-"),
    );
    const outside = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "akeru-sandbox-outside-"));
    const transferRoot = await NodeFSP.mkdtemp(
      NodePath.join(NodeOS.tmpdir(), "akeru-sandbox-transfer-"),
    );
    NodeChildProcess.execFileSync("git", ["-C", workspaceRoot, "init", "--quiet"]);
    await NodeFSP.mkdir(NodePath.join(workspaceRoot, "linked"));
    await NodeFSP.writeFile(NodePath.join(workspaceRoot, "linked", "tracked.txt"), "safe");
    NodeChildProcess.execFileSync("git", ["-C", workspaceRoot, "add", "linked/tracked.txt"]);
    await NodeFSP.rm(NodePath.join(workspaceRoot, "linked"), { recursive: true });
    await NodeFSP.writeFile(NodePath.join(outside, "tracked.txt"), "outside secret");
    await NodeFSP.symlink(outside, NodePath.join(workspaceRoot, "linked"));
    const fake = fakeSandbox();
    const provider = createAkeruSandboxToolProvider({
      sandbox: "vercel",
      workspaceRoot,
      transferRoot,
      create: async () => fake.sandbox,
    });

    await provider.tools();

    expect(fake.upload).not.toHaveBeenCalledWith(
      NodePath.join(outside, "tracked.txt"),
      "linked/tracked.txt",
    );
    await provider.close?.();
  });

  it("stops workspace uploads after the session start is aborted", async () => {
    const workspaceRoot = await NodeFSP.mkdtemp(
      NodePath.join(NodeOS.tmpdir(), "akeru-sandbox-workspace-"),
    );
    const transferRoot = await NodeFSP.mkdtemp(
      NodePath.join(NodeOS.tmpdir(), "akeru-sandbox-transfer-"),
    );
    NodeChildProcess.execFileSync("git", ["-C", workspaceRoot, "init", "--quiet"]);
    await NodeFSP.writeFile(NodePath.join(workspaceRoot, "first.txt"), "first");
    await NodeFSP.writeFile(NodePath.join(workspaceRoot, "second.txt"), "second");
    NodeChildProcess.execFileSync("git", ["-C", workspaceRoot, "add", "first.txt", "second.txt"]);
    const fake = fakeSandbox();
    let markUploadStarted!: () => void;
    let finishUpload!: () => void;
    const uploadStarted = new Promise<void>((resolve) => {
      markUploadStarted = resolve;
    });
    const uploadFinished = new Promise<void>((resolve) => {
      finishUpload = resolve;
    });
    fake.upload.mockImplementationOnce(async () => {
      markUploadStarted();
      await uploadFinished;
    });
    const provider = createAkeruSandboxToolProvider({
      sandbox: "vercel",
      workspaceRoot,
      transferRoot,
      create: async () => fake.sandbox,
    });
    const controller = new AbortController();
    const loading = provider.tools(controller.signal);
    await uploadStarted;

    controller.abort(new Error("session stopped"));
    finishUpload();

    await expect(loading).rejects.toThrow("session stopped");
    expect(fake.upload).toHaveBeenCalledTimes(1);
    await provider.close?.();
  });

  it("reconnects a retained sandbox for the same agent session", async () => {
    const transferRoot = await NodeFSP.mkdtemp(
      NodePath.join(NodeOS.tmpdir(), "akeru-sandbox-transfer-"),
    );
    const first = fakeSandbox();
    const resumed = fakeSandbox();
    const firstProvider = createAkeruSandboxToolProvider({
      sandbox: "vercel",
      sessionId: "retained-session",
      transferRoot,
      create: async () => first.sandbox,
    });
    await firstProvider.tools();
    await firstProvider.close?.();
    const connect = vi.fn(async () => resumed.sandbox);
    const create = vi.fn(async () => resumed.sandbox);
    const resumedProvider = createAkeruSandboxToolProvider({
      sandbox: "vercel",
      sessionId: "retained-session",
      transferRoot,
      create,
      connect,
    });

    await resumedProvider.tools();

    expect(connect).toHaveBeenCalledWith(first.sandbox.id);
    expect(create).not.toHaveBeenCalled();
    await resumedProvider.close?.();
  });

  it("rejects host transfer paths outside the transfer directory", async () => {
    const transferRoot = await NodeFSP.mkdtemp(
      NodePath.join(NodeOS.tmpdir(), "akeru-sandbox-transfer-"),
    );
    const outside = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "akeru-sandbox-outside-"));
    await NodeFSP.writeFile(NodePath.join(outside, "secret.txt"), "secret");
    const fake = fakeSandbox();
    const provider = createAkeruSandboxToolProvider({
      sandbox: "vercel",
      transferRoot,
      create: async () => fake.sandbox,
    });
    const tools = new Map((await provider.tools()).map((tool) => [tool.name, tool]));

    await expect(
      tools
        .get("UploadFile")
        ?.execute(
          { localPath: NodePath.join(outside, "secret.txt"), sandboxPath: "/workspace/secret" },
          context,
        ),
    ).rejects.toThrow("outside the Akeru transfer directory");
    await NodeFSP.symlink(
      NodePath.join(outside, "secret.txt"),
      NodePath.join(transferRoot, "escape"),
    );
    await expect(
      tools
        .get("DownloadFile")
        ?.execute({ sandboxPath: "/workspace/result", localPath: "escape" }, context),
    ).rejects.toThrow("cannot be a symbolic link");
    await provider.close?.();
  });
});
