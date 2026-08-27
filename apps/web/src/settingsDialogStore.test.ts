import { beforeEach, describe, expect, it } from "vite-plus/test";

import {
  clearSettingsTarget,
  closeSettings,
  openSettings,
  settingsSectionFromPathname,
  useSettingsDialogStore,
} from "./settingsDialogStore";

beforeEach(() => {
  closeSettings();
});

describe("settings dialog store", () => {
  it("opens on General when no section is named", () => {
    openSettings();
    expect(useSettingsDialogStore.getState().section).toBe("general");
  });

  it("opens a section with a row target", () => {
    openSettings("general", "local-execution");
    expect(useSettingsDialogStore.getState()).toMatchObject({
      section: "general",
      targetId: "local-execution",
    });
    clearSettingsTarget();
    expect(useSettingsDialogStore.getState().targetId).toBeNull();
    expect(useSettingsDialogStore.getState().section).toBe("general");
  });

  it("closes back to no section or row target", () => {
    openSettings("providers", "providers");
    closeSettings();
    expect(useSettingsDialogStore.getState().section).toBeNull();
    expect(useSettingsDialogStore.getState().targetId).toBeNull();
  });
});

describe("legacy settings deep links", () => {
  it("maps a known settings path onto its section", () => {
    expect(settingsSectionFromPathname("/settings/connections")).toBe("connections");
    expect(settingsSectionFromPathname("/settings/source-control")).toBe("source-control");
  });

  it("maps keybinding links onto the configurable shortcut panel", () => {
    expect(settingsSectionFromPathname("/settings/keybindings")).toBe("keybindings");
  });

  it("falls back to General for the bare path and for removed sections", () => {
    expect(settingsSectionFromPathname("/settings")).toBe("general");
    expect(settingsSectionFromPathname("/settings/")).toBe("general");
    expect(settingsSectionFromPathname("/settings/archived")).toBe("general");
  });
});
