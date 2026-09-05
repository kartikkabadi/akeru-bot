export const MAC_CURL_INSTALL_COMMAND =
  't=$(curl -fsSL https://api.github.com/repos/opencoredev/akeru-bot/releases/latest | sed -n \'s/.*"tag_name":[[:space:]]*"\\(v[0-9][^"]*\\)".*/\\1/p\' | head -1); [ -n "$t" ] && curl -fsSL -o /tmp/akeru-install.sh "https://raw.githubusercontent.com/opencoredev/akeru-bot/$t/scripts/install-macos.sh" && bash /tmp/akeru-install.sh --tag "$t"; rm -f /tmp/akeru-install.sh';

export const MAC_DOWNLOAD_DIALOG_TITLE = "Install with one command, not the browser";

export const MAC_DOWNLOAD_DIALOG_BODY =
  "Safari and Chrome quarantine unsigned Mac apps, so Gatekeeper says Akeru Bot is damaged. Paste this one-liner in Terminal. It resolves the latest stable release, downloads that release's installer, checks the DMG against SHA256SUMS, then installs.";

export const WIN_POWERSHELL_INSTALL_COMMAND =
  '$t = (Invoke-RestMethod https://api.github.com/repos/opencoredev/akeru-bot/releases/latest).tag_name; if ($t) { Invoke-WebRequest "https://raw.githubusercontent.com/opencoredev/akeru-bot/$t/scripts/install-windows.ps1" -OutFile "$env:TEMP\\akeru-install.ps1"; & "$env:TEMP\\akeru-install.ps1" -Tag $t; Remove-Item "$env:TEMP\\akeru-install.ps1" }';

export const WIN_DOWNLOAD_DIALOG_TITLE = "Install with one command in PowerShell";

export const WIN_DOWNLOAD_DIALOG_BODY =
  "Paste this one-liner in PowerShell. It resolves the latest stable release, downloads that release's installer, checks the exe against SHA256SUMS, then runs it.";

export const LINUX_CURL_INSTALL_COMMAND =
  't=$(curl -fsSL https://api.github.com/repos/opencoredev/akeru-bot/releases/latest | sed -n \'s/.*"tag_name":[[:space:]]*"\\(v[0-9][^"]*\\)".*/\\1/p\' | head -1); [ -n "$t" ] && curl -fsSL -o /tmp/akeru-install-linux.sh "https://raw.githubusercontent.com/opencoredev/akeru-bot/$t/scripts/install-linux.sh" && bash /tmp/akeru-install-linux.sh --tag "$t"; rm -f /tmp/akeru-install-linux.sh';

export const LINUX_DOWNLOAD_DIALOG_TITLE = "Install with one command in Terminal";

export const LINUX_DOWNLOAD_DIALOG_BODY =
  "Paste this one-liner in Terminal. It resolves the latest stable release, downloads that release's installer, checks the AppImage against SHA256SUMS, then installs.";

export function installPromptPlatformForDownload(
  platform: string | undefined,
  resolvedAsset: boolean,
): "mac" | "win" | "linux" | null {
  if (!resolvedAsset) return null;
  return platform === "mac" || platform === "win" || platform === "linux" ? platform : null;
}
