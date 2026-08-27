import { LocalFilesystem, LocalSandbox, Workspace } from "@mastra/core/workspace";
import { DEFAULT_SERVER_SETTINGS } from "@t3tools/contracts";
import { assert, describe, expect, it, vi } from "vite-plus/test";

import {
  createBotWorkspace,
  isRemoteBotSandbox,
  sandboxProviderOptions,
  sandboxSessionIdentity,
} from "./botWorkspace.ts";

describe("createBotWorkspace", () => {
  it("treats each BYOK cloud provider as remote", () => {
    expect(isRemoteBotSandbox("local")).toBe(false);
    expect(isRemoteBotSandbox(null)).toBe(false);
    expect(isRemoteBotSandbox("e2b")).toBe(true);
    expect(isRemoteBotSandbox("daytona")).toBe(true);
    expect(isRemoteBotSandbox("vercel")).toBe(true);
    expect(isRemoteBotSandbox("upstash")).toBe(true);
  });

  it("builds a local Mastra workspace from the thread cwd", async () => {
    const workspace = await createBotWorkspace({
      threadId: "thread-local",
      cwd: process.cwd(),
      settings: DEFAULT_SERVER_SETTINGS.sandbox,
    });
    assert.isDefined(workspace);
    expect(workspace?.sandbox).toBeInstanceOf(LocalSandbox);
    expect(workspace?.filesystem).toBeInstanceOf(LocalFilesystem);
    await workspace?.destroy();
  });

  it("uses the Settings default remote sandbox with its materialized environment", async () => {
    const remote = new Workspace({
      filesystem: new LocalFilesystem({ basePath: process.cwd() }),
      sandbox: new LocalSandbox({ workingDirectory: process.cwd() }),
    });
    const makeRemoteWorkspace = vi.fn(async () => remote);
    const environment = [
      { name: "VERCEL_TOKEN", value: "token", sensitive: true },
      { name: "VERCEL_TEAM_ID", value: "team", sensitive: false },
      { name: "VERCEL_PROJECT_ID", value: "project", sensitive: false },
    ];
    const workspace = await createBotWorkspace({
      threadId: "thread-vercel",
      cwd: process.cwd(),
      settings: {
        ...DEFAULT_SERVER_SETTINGS.sandbox,
        defaultProvider: "vercel",
        providers: {
          ...DEFAULT_SERVER_SETTINGS.sandbox.providers,
          vercel: { environment },
        },
      },
      makeRemoteWorkspace,
    });
    expect(makeRemoteWorkspace).toHaveBeenCalledOnce();
    expect(makeRemoteWorkspace).toHaveBeenCalledWith({
      threadId: "thread-vercel",
      sandbox: "vercel",
      environment,
    });
    expect(workspace).toBe(remote);
    await workspace?.destroy();
  });

  it("identifies only the selected sandbox and its credentials", () => {
    const e2bSettings = {
      ...DEFAULT_SERVER_SETTINGS.sandbox,
      defaultProvider: "e2b" as const,
      providers: {
        ...DEFAULT_SERVER_SETTINGS.sandbox.providers,
        e2b: {
          environment: [{ name: "E2B_API_KEY", value: "first-key", sensitive: true }],
        },
      },
    };
    const unrelatedProviderChanged = {
      ...e2bSettings,
      providers: {
        ...e2bSettings.providers,
        daytona: {
          environment: [{ name: "DAYTONA_API_KEY", value: "daytona-key", sensitive: true }],
        },
      },
    };
    const selectedCredentialChanged = {
      ...e2bSettings,
      providers: {
        ...e2bSettings.providers,
        e2b: {
          environment: [{ name: "E2B_API_KEY", value: "second-key", sensitive: true }],
        },
      },
    };

    expect(sandboxSessionIdentity(unrelatedProviderChanged)).toEqual(
      sandboxSessionIdentity(e2bSettings),
    );
    expect(sandboxSessionIdentity(selectedCredentialChanged)).not.toEqual(
      sandboxSessionIdentity(e2bSettings),
    );
  });

  it("maps each provider's saved credentials to sandbox-sdk options", () => {
    expect(
      sandboxProviderOptions("e2b", [{ name: "E2B_API_KEY", value: "e2b-key", sensitive: true }]),
    ).toEqual({ apiKey: "e2b-key" });
    expect(
      sandboxProviderOptions("daytona", [
        { name: "DAYTONA_API_KEY", value: "daytona-key", sensitive: true },
      ]),
    ).toEqual({ apiKey: "daytona-key" });
    expect(
      sandboxProviderOptions("vercel", [
        { name: "VERCEL_TOKEN", value: "token", sensitive: true },
        { name: "VERCEL_TEAM_ID", value: "team", sensitive: false },
        { name: "VERCEL_PROJECT_ID", value: "project", sensitive: false },
      ]),
    ).toEqual({ token: "token", teamId: "team", projectId: "project" });
    expect(
      sandboxProviderOptions("upstash", [
        { name: "UPSTASH_BOX_API_KEY", value: "upstash-key", sensitive: true },
      ]),
    ).toEqual({ apiKey: "upstash-key" });
  });
});
