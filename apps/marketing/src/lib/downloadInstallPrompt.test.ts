import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { describe, expect, it } from "vite-plus/test";
import {
  MAC_CURL_INSTALL_COMMAND,
  MAC_DOWNLOAD_DIALOG_BODY,
  MAC_DOWNLOAD_DIALOG_TITLE,
  installPromptPlatformForDownload,
} from "./downloadInstallPrompt";

describe("installPromptPlatformForDownload", () => {
  it("shows the install prompt only after resolving a macOS download", () => {
    expect(installPromptPlatformForDownload("mac", true)).toBe("mac");
    expect(installPromptPlatformForDownload("mac", false)).toBeNull();
    expect(installPromptPlatformForDownload("win", true)).toBeNull();
    expect(installPromptPlatformForDownload("linux", true)).toBeNull();
  });

  it("sends macOS users to the release-pinned one-line installer", () => {
    expect(MAC_CURL_INSTALL_COMMAND).toBe(
      't=$(curl -fsSL https://api.github.com/repos/opencoredev/akeru-bot/releases/latest | sed -n \'s/.*"tag_name":[[:space:]]*"\\(v[0-9][^"]*\\)".*/\\1/p\' | head -1); [ -n "$t" ] && curl -fsSL -o /tmp/akeru-install.sh "https://raw.githubusercontent.com/opencoredev/akeru-bot/$t/scripts/install-macos.sh" && bash /tmp/akeru-install.sh --tag "$t"; rm -f /tmp/akeru-install.sh',
    );
    expect(MAC_CURL_INSTALL_COMMAND).toContain("releases/latest");
    expect(MAC_CURL_INSTALL_COMMAND).toContain("/$t/scripts/install-macos.sh");
    expect(MAC_CURL_INSTALL_COMMAND).toContain('--tag "$t"');
    expect(MAC_CURL_INSTALL_COMMAND).toContain("rm -f /tmp/akeru-install.sh");
    expect(MAC_CURL_INSTALL_COMMAND).not.toContain("/releases/latest/download");
    expect(MAC_CURL_INSTALL_COMMAND).not.toContain("| bash");
    expect(MAC_DOWNLOAD_DIALOG_TITLE).toMatch(/one command/);
    expect(MAC_DOWNLOAD_DIALOG_BODY).toMatch(/one-liner/);
    expect(MAC_DOWNLOAD_DIALOG_BODY).toMatch(/latest stable release/);
    expect(MAC_DOWNLOAD_DIALOG_BODY).toMatch(/SHA256SUMS/);
  });

  it("keeps the install docs on the same fail-closed recipe", () => {
    const docs = NodeFS.readFileSync(
      NodePath.resolve(import.meta.dirname, "../../../../docs/user/install.md"),
      "utf8",
    );
    expect(docs).toContain(MAC_CURL_INSTALL_COMMAND);
    expect(docs).not.toContain("MAC_GATEKEEPER_COMMAND");
  });
});
