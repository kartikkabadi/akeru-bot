// @effect-diagnostics nodeBuiltinImport:off globalFetch:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { describe, expect, it, vi } from "vite-plus/test";

import {
  createAkeruToolRegistry,
  createReadTool,
  createShellTool,
  createWebFetchTool,
  decideAkeruToolPermission,
  validateAkeruPublicUrl,
} from "./AkeruToolRegistry.ts";

const context = () => ({
  signal: new AbortController().signal,
  askUser: async () => "answered",
});

describe("Akeru tool registry", () => {
  it("applies explicit runtime and plan-mode permission categories", () => {
    expect(
      decideAkeruToolPermission({
        runtimeMode: "approval-required",
        interactionMode: "default",
        category: "read",
      }),
    ).toBe("allow");
    expect(
      decideAkeruToolPermission({
        runtimeMode: "auto-accept-edits",
        interactionMode: "default",
        category: "edit",
      }),
    ).toBe("allow");
    expect(
      decideAkeruToolPermission({
        runtimeMode: "full-access",
        interactionMode: "plan",
        category: "execute",
      }),
    ).toBe("deny");
    expect(
      decideAkeruToolPermission({
        runtimeMode: "approval-required",
        interactionMode: "default",
        category: "execute",
      }),
    ).toBe("ask");
    expect(
      decideAkeruToolPermission({
        runtimeMode: "full-access",
        interactionMode: "plan",
        category: "execute",
        sessionAllowed: true,
      }),
    ).toBe("deny");
  });

  it("reads bounded workspace files and rejects symlink escapes", async () => {
    const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "akeru-tools-root-"));
    const outside = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "akeru-tools-outside-"));
    await NodeFSP.writeFile(NodePath.join(root, "inside.txt"), "one\ntwo\nthree");
    await NodeFSP.writeFile(NodePath.join(outside, "secret.txt"), "secret");
    await NodeFSP.symlink(NodePath.join(outside, "secret.txt"), NodePath.join(root, "escape.txt"));
    const tool = createReadTool(root);

    await expect(
      tool.execute({ path: "inside.txt", offset: 2, limit: 1 }, context()),
    ).resolves.toMatchObject({
      content: "two",
      offset: 2,
      truncated: true,
    });
    await expect(tool.execute({ path: "escape.txt" }, context())).rejects.toThrow(
      "outside the active workspace",
    );
  });

  it("runs shell commands in the fixed workspace", async () => {
    const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "akeru-tools-shell-"));
    const result = await createShellTool(root, "linux").execute(
      { command: "printf akeru" },
      context(),
    );
    expect(result).toMatchObject({ exitCode: 0, stdout: "akeru", timedOut: false });
  });

  it("rejects private and credential-bearing WebFetch URLs", async () => {
    await expect(validateAkeruPublicUrl("http://127.0.0.1/private")).rejects.toThrow(
      "local network",
    );
    await expect(validateAkeruPublicUrl("https://user:pass@example.com/")).rejects.toThrow(
      "cannot contain credentials",
    );
  });

  it("rejects WebFetch before DNS or transport work when already aborted", async () => {
    const controller = new AbortController();
    controller.abort(new Error("interrupted"));
    const fetchImpl = vi.fn(async () => new Response("never"));

    await expect(
      createWebFetchTool(fetchImpl as unknown as typeof fetch).execute(
        { url: "https://example.com/" },
        { ...context(), signal: controller.signal },
      ),
    ).rejects.toThrow("interrupted");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("stops reading WebFetch bodies at the response limit", async () => {
    const oversized = new Uint8Array(200 * 1024).fill(97);
    const fetchImpl = vi.fn(
      async () => new Response(oversized, { headers: { "content-type": "text/plain" } }),
    );
    const result = (await createWebFetchTool(fetchImpl as unknown as typeof fetch).execute(
      { url: "https://example.com/large.txt" },
      context(),
    )) as { content: string; truncated: boolean };

    expect(result.content).toHaveLength(100 * 1024);
    expect(result.truncated).toBe(true);
  });

  it("closes initialized providers when registry construction fails", async () => {
    const close = vi.fn(async () => undefined);

    await expect(
      createAkeruToolRegistry({
        platform: "linux",
        providers: [
          { tools: async () => [], close },
          {
            tools: async () => {
              throw new Error("provider failed");
            },
          },
        ],
      }),
    ).rejects.toThrow("provider failed");
    expect(close).toHaveBeenCalledOnce();
  });

  it("exposes only tools with active backends", async () => {
    const registry = await createAkeruToolRegistry({
      platform: "linux",
      providers: [
        {
          tools: async () => [
            {
              name: "WebSearch",
              description: "Search through the configured plugin.",
              inputSchema: { type: "object" },
              category: "external",
              execute: async () => ({ results: [] }),
            },
          ],
        },
      ],
    });

    expect([...registry.tools.keys()]).toEqual(["WebFetch", "AskUser", "WebSearch"]);
    await registry.close();
  });
});
