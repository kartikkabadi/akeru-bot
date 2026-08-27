import { describe, expect, it } from "vite-plus/test";

import { parseSettingsDeepLink } from "./settingsDeepLink";

describe("settings deep links", () => {
  it("maps the local execution link to its General settings target", () => {
    expect(parseSettingsDeepLink("grokbot://app/v1/settings?id=local-execution")).toEqual({
      section: "general",
      sectionLabel: "General",
      targetId: "local-execution",
      targetLabel: "Local execution",
      tooltip: "Open Settings > General > Local execution",
    });
  });

  it("maps current setting rows and sections to their dialog panes", () => {
    expect(parseSettingsDeepLink("grokbot://app/v1/settings?id=word-wrap")).toMatchObject({
      section: "appearance",
      targetId: "word-wrap",
      targetLabel: "Word wrap",
    });
    expect(parseSettingsDeepLink("grokbot://app/v1/settings?id=connections")).toMatchObject({
      section: "connections",
      targetId: null,
      tooltip: "Open Settings > Connections",
    });
    expect(parseSettingsDeepLink("grokbot://app/v1/settings?id=diagnostics")).toMatchObject({
      section: "diagnostics",
      targetId: null,
      tooltip: "Open Settings > Diagnostics",
    });
  });

  it("falls back to General for missing and unknown ids", () => {
    expect(parseSettingsDeepLink("grokbot://app/v1/settings")).toMatchObject({
      section: "general",
      targetId: null,
      tooltip: "Open Settings > General",
    });
    expect(parseSettingsDeepLink("grokbot://app/v1/settings?id=not-a-setting")).toMatchObject({
      section: "general",
      targetId: null,
      tooltip: "Open Settings > General",
    });
  });

  it.each([
    "https://app/v1/settings?id=local-execution",
    "grokbot://other/v1/settings?id=local-execution",
    "grokbot://app/v2/settings?id=local-execution",
    "grokbot://app/v1/settings?id=local-execution#details",
    "grokbot://app/v1/settings?id=local-execution&next=https://example.com",
    "grokbot://app/v1/settings?id=general&id=providers",
    "not a url",
  ])("rejects non-app settings destinations: %s", (href) => {
    expect(parseSettingsDeepLink(href)).toBeNull();
  });
});
