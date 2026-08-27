import { DEFAULT_SERVER_SETTINGS } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  canSaveSandboxProviderConnection,
  disconnectSandboxProvider,
  isSandboxProviderConnected,
  saveSandboxProviderConnection,
  selectableSandboxProviders,
} from "./SandboxSettingsPanel.logic";

describe("sandbox settings", () => {
  it("offers only this computer until a cloud provider is connected", () => {
    expect(selectableSandboxProviders(DEFAULT_SERVER_SETTINGS.sandbox)).toEqual(["local"]);
    expect(isSandboxProviderConnected(DEFAULT_SERVER_SETTINGS.sandbox, "e2b")).toBe(false);
  });

  it("connects E2B and makes it available as a default", () => {
    const sandbox = saveSandboxProviderConnection({
      settings: DEFAULT_SERVER_SETTINGS.sandbox,
      provider: "e2b",
      draft: { E2B_API_KEY: " e2b-secret " },
    });

    expect(sandbox.providers.e2b.environment).toEqual([
      { name: "E2B_API_KEY", value: "e2b-secret", sensitive: true },
    ]);
    expect(isSandboxProviderConnected(sandbox, "e2b")).toBe(true);
    expect(selectableSandboxProviders(sandbox)).toEqual(["local", "e2b"]);
  });

  it("requires Vercel token, team, and project", () => {
    expect(
      canSaveSandboxProviderConnection({
        settings: DEFAULT_SERVER_SETTINGS.sandbox,
        provider: "vercel",
        draft: { VERCEL_TOKEN: "token", VERCEL_TEAM_ID: "team", VERCEL_PROJECT_ID: "" },
      }),
    ).toBe(false);
    expect(
      canSaveSandboxProviderConnection({
        settings: DEFAULT_SERVER_SETTINGS.sandbox,
        provider: "vercel",
        draft: {
          VERCEL_TOKEN: "token",
          VERCEL_TEAM_ID: "team",
          VERCEL_PROJECT_ID: "project",
        },
      }),
    ).toBe(true);
  });

  it("keeps an existing redacted key when credentials are edited", () => {
    const settings = {
      ...DEFAULT_SERVER_SETTINGS.sandbox,
      providers: {
        ...DEFAULT_SERVER_SETTINGS.sandbox.providers,
        vercel: {
          environment: [
            {
              name: "VERCEL_TOKEN",
              value: "",
              sensitive: true,
              valueRedacted: true,
            },
            { name: "VERCEL_TEAM_ID", value: "team-old", sensitive: false },
            { name: "VERCEL_PROJECT_ID", value: "project-old", sensitive: false },
          ],
        },
      },
    };

    const next = saveSandboxProviderConnection({
      settings,
      provider: "vercel",
      draft: { VERCEL_TOKEN: "", VERCEL_TEAM_ID: "team-new", VERCEL_PROJECT_ID: "project-new" },
    });

    expect(next.providers.vercel.environment[0]).toEqual(
      expect.objectContaining({ name: "VERCEL_TOKEN", valueRedacted: true }),
    );
    expect(isSandboxProviderConnected(next, "vercel")).toBe(true);
  });

  it("falls back to Local when the default cloud provider disconnects", () => {
    const connected = saveSandboxProviderConnection({
      settings: DEFAULT_SERVER_SETTINGS.sandbox,
      provider: "upstash",
      draft: { UPSTASH_BOX_API_KEY: "secret" },
    });
    const next = disconnectSandboxProvider({ ...connected, defaultProvider: "upstash" }, "upstash");

    expect(next.defaultProvider).toBe("local");
    expect(next.providers.upstash.environment).toEqual([]);
  });
});
