export const MAC_CURL_INSTALL_COMMAND =
  "curl -fsSL https://raw.githubusercontent.com/opencoredev/akeru-bot/main/scripts/install-macos.sh | bash";

export const MAC_DOWNLOAD_DIALOG_TITLE = "Install with one command, not the browser";

export const MAC_DOWNLOAD_DIALOG_BODY =
  "Safari and Chrome quarantine unsigned Mac apps, so Gatekeeper says Akeru Bot is damaged. Paste this one-liner in Terminal. It pipes the installer to shell, and the installer downloads the GitHub DMG and checks SHA256SUMS before installing.";

export function installPromptPlatformForDownload(
  platform: string | undefined,
  resolvedAsset: boolean,
): "mac" | null {
  return resolvedAsset && platform === "mac" ? "mac" : null;
}
