import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { resolveRosterLoadingState } from "./useServerRoster";

const environmentId = EnvironmentId.make("environment-local");

describe("resolveRosterLoadingState", () => {
  it("loads until the environment catalog is ready", () => {
    expect(
      resolveRosterLoadingState({
        environmentCatalogReady: false,
        environmentId: null,
        snapshotLoaded: false,
        syncedEnvironmentId: null,
      }),
    ).toBe(true);
  });

  it("loads until the active environment snapshot reaches the roster store", () => {
    expect(
      resolveRosterLoadingState({
        environmentCatalogReady: true,
        environmentId,
        snapshotLoaded: false,
        syncedEnvironmentId: null,
      }),
    ).toBe(true);
    expect(
      resolveRosterLoadingState({
        environmentCatalogReady: true,
        environmentId,
        snapshotLoaded: true,
        syncedEnvironmentId: null,
      }),
    ).toBe(true);
  });

  it("stops loading after sync or when no environment exists", () => {
    expect(
      resolveRosterLoadingState({
        environmentCatalogReady: true,
        environmentId,
        snapshotLoaded: true,
        syncedEnvironmentId: environmentId,
      }),
    ).toBe(false);
    expect(
      resolveRosterLoadingState({
        environmentCatalogReady: true,
        environmentId: null,
        snapshotLoaded: false,
        syncedEnvironmentId: null,
      }),
    ).toBe(false);
  });
});
