// @effect-diagnostics nodeBuiltinImport:off - This integration guard reads related source files.
import * as NodeFS from "node:fs";

import { describe, expect, it } from "vite-plus/test";

describe("sidebar footer", () => {
  it("shows one compact plugin link without enabled counts or logo chips", () => {
    const source = NodeFS.readFileSync(new URL("./SidebarChrome.tsx", import.meta.url), "utf8");

    expect(source).toContain('label="Plugins"');
    expect(source).not.toContain("plugins enabled");
    expect(source).not.toContain("PluginLogoImage");
  });

  it("keeps the roster scrollable from touch gestures that start on a bot row", () => {
    const source = NodeFS.readFileSync(
      new URL("../roster/BotRosterSidebar.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("touch-pan-y");
    expect(source).not.toContain("touch-none");
  });

  it("shows bot placeholders until the active environment roster is synced", () => {
    const source = NodeFS.readFileSync(
      new URL("../roster/BotRosterSidebar.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("const rosterLoading = useServerRosterSync()");
    expect(source).toContain('aria-label="Loading bots"');
    expect(source).toContain("aria-busy={rosterLoading}");
    expect(source.indexOf("rosterLoading ?")).toBeLessThan(source.indexOf("No bots yet"));
  });

  it("keeps short plugin dialogs and the footer independently scrollable", () => {
    const sidebarSource = NodeFS.readFileSync(
      new URL("./SidebarChrome.tsx", import.meta.url),
      "utf8",
    );
    const pluginsSource = NodeFS.readFileSync(
      new URL("../plugins/PluginsDialog.tsx", import.meta.url),
      "utf8",
    );

    expect(sidebarSource).toContain("overflow-y-auto overscroll-contain");
    expect(pluginsSource).toContain("PLUGIN_DIRECTORY_HEADER_CLASS_NAME");
    expect(pluginsSource).toContain('<DialogPanel className="space-y-4 px-6 py-5">');
  });
});
