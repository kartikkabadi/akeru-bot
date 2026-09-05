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

  it("sends macOS users to the blessed one-line installer", () => {
    expect(MAC_CURL_INSTALL_COMMAND).toBe(
      "curl -fsSL https://raw.githubusercontent.com/opencoredev/akeru-bot/main/scripts/install-macos.sh | bash",
    );
    expect(MAC_CURL_INSTALL_COMMAND).toContain(
      "https://raw.githubusercontent.com/opencoredev/akeru-bot/main/scripts/install-macos.sh",
    );
    expect(MAC_CURL_INSTALL_COMMAND).toContain("install-macos.sh");
    expect(MAC_CURL_INSTALL_COMMAND).toContain("| bash");
    expect(MAC_CURL_INSTALL_COMMAND).not.toContain("/releases/latest/download");
    expect(MAC_DOWNLOAD_DIALOG_TITLE).toMatch(/one command/);
    expect(MAC_DOWNLOAD_DIALOG_BODY).toMatch(/one-liner/);
    expect(MAC_DOWNLOAD_DIALOG_BODY).toMatch(/pip.*shell/i);
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
