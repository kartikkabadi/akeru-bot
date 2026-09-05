export const MAC_CURL_INSTALL_COMMAND =
  't=$(curl -fsSL https://api.github.com/repos/opencoredev/akeru-bot/releases/latest | sed -n \'s/.*"tag_name":[[:space:]]*"\\(v[0-9][^"]*\\)".*/\\1/p\' | head -1); [ -n "$t" ] && curl -fsSL -o /tmp/akeru-install.sh "https://raw.githubusercontent.com/opencoredev/akeru-bot/$t/scripts/install-macos.sh" && bash /tmp/akeru-install.sh --tag "$t"; rm -f /tmp/akeru-install.sh';

export const MAC_DOWNLOAD_DIALOG_TITLE = "Install with one command, not the browser";

export const MAC_DOWNLOAD_DIALOG_BODY =
  "Safari and Chrome quarantine unsigned Mac apps, so Gatekeeper says Akeru Bot is damaged. Paste this one-liner in Terminal. It resolves the latest stable release, downloads that release's installer, checks the DMG against SHA256SUMS, then installs.";

export function installPromptPlatformForDownload(
  platform: string | undefined,
  resolvedAsset: boolean,
): "mac" | null {
  return resolvedAsset && platform === "mac" ? "mac" : null;
}
