import { LocalFilesystem, LocalSandbox, Workspace } from "@mastra/core/workspace";
import { BotId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  botRuntimeResourceScope,
  BotWorkspacePool,
  botWorkspaceResourceKey,
} from "./botWorkspacePool.ts";

function localWorkspace() {
  return new Workspace({
    filesystem: new LocalFilesystem({ basePath: process.cwd() }),
    sandbox: new LocalSandbox({ workingDirectory: process.cwd() }),
  });
}

describe("bot runtime resource scope", () => {
  it("defaults every bot to one shared scope", () => {
    expect(
      botRuntimeResourceScope({
        sharing: "shared",
        botId: BotId.make("bot-one"),
        threadId: "thread-one",
      }),
    ).toBe("shared");
    expect(
      botRuntimeResourceScope({
        sharing: "shared",
        botId: BotId.make("bot-two"),
        threadId: "thread-two",
      }),
    ).toBe("shared");
  });

  it("uses one scope per bot in separate mode and falls back to the thread", () => {
    expect(
      botRuntimeResourceScope({
        sharing: "separate",
        botId: BotId.make("bot-one"),
        threadId: "thread-one",
      }),
    ).toBe("bot-bot-one");
    expect(botRuntimeResourceScope({ sharing: "separate", threadId: "thread-without-bot" })).toBe(
      "thread-thread-without-bot",
    );
  });

  it("isolates providers and local working directories", () => {
    expect(botWorkspaceResourceKey({ resourceScope: "shared", sandbox: "vercel" })).not.toBe(
      botWorkspaceResourceKey({ resourceScope: "shared", sandbox: "upstash" }),
    );
    expect(
      botWorkspaceResourceKey({ resourceScope: "shared", sandbox: "local", cwd: "/first" }),
    ).not.toBe(
      botWorkspaceResourceKey({ resourceScope: "shared", sandbox: "local", cwd: "/second" }),
    );
  });
});

describe("BotWorkspacePool", () => {
  it("reuses a resource until its final release", async () => {
    const pool = new BotWorkspacePool();
    const workspace = localWorkspace();
    const destroy = vi.spyOn(workspace, "destroy");
    const create = vi.fn(async () => workspace);

    const first = await pool.acquire("vercel:shared", create);
    const second = await pool.acquire("vercel:shared", create);

    expect(first.workspace).toBe(second.workspace);
    expect(create).toHaveBeenCalledOnce();
    await first.release();
    expect(destroy).not.toHaveBeenCalled();
    await second.release();
    expect(destroy).toHaveBeenCalledOnce();
    await second.release();
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("keeps separate bot resources isolated", async () => {
    const pool = new BotWorkspacePool();
    const first = await pool.acquire("vercel:bot-one", async () => localWorkspace());
    const second = await pool.acquire("vercel:bot-two", async () => localWorkspace());

    expect(first.workspace).not.toBe(second.workspace);
    await first.release();
    await second.release();
    await pool.destroyAll();
  });

  it("allows a failed resource creation to retry", async () => {
    const pool = new BotWorkspacePool();
    const create = vi
      .fn<() => Promise<Workspace>>()
      .mockRejectedValueOnce(new Error("sandbox unavailable"))
      .mockResolvedValueOnce(localWorkspace());

    await expect(pool.acquire("vercel:shared", create)).rejects.toThrow("sandbox unavailable");
    const lease = await pool.acquire("vercel:shared", create);
    expect(create).toHaveBeenCalledTimes(2);
    await lease.release();
    await pool.destroyAll();
  });
});
