#!/usr/bin/env bash
#
# One-line Linux installer for Akeru Bot (x86_64).
#
#   t=$(curl -fsSL https://api.github.com/repos/opencoredev/akeru-bot/releases/latest | sed -n 's/.*"tag_name":[[:space:]]*"\(v[0-9][^"]*\)".*/\1/p' | head -1); [ -n "$t" ] && curl -fsSL -o /tmp/akeru-install-linux.sh "https://raw.githubusercontent.com/opencoredev/akeru-bot/$t/scripts/install-linux.sh" && bash /tmp/akeru-install-linux.sh --tag "$t"; rm -f /tmp/akeru-install-linux.sh
#   bash install-linux.sh --tag v1.2.3
#
# Downloads the GitHub AppImage for the latest stable tag (or --tag), checks
# SHA256SUMS, then installs to ~/.local/bin with backup + rollback.

set -euo pipefail

tag=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --tag)
      if [ "$#" -lt 2 ]; then
        echo "install-linux.sh: --tag requires a value (vX.Y.Z)" >&2
        exit 1
      fi
      tag="$2"
      shift 2
      ;;
    --tag=*)
      tag="${1#--tag=}"
      shift
      ;;
    -h|--help)
      echo "usage: install-linux.sh [--tag vX.Y.Z]"
      echo "installs Akeru-Bot-<version>-x64.AppImage to ~/.local/bin/akeru-bot"
      exit 0
      ;;
    *)
      echo "install-linux.sh: unknown argument: $1" >&2
      echo "usage: install-linux.sh [--tag vX.Y.Z]" >&2
      exit 1
      ;;
  esac
done

[ "$(uname -s)" = Linux ]
case "$(uname -m)" in
  x86_64|amd64) ;;
  *)
    echo "install-linux.sh: unsupported architecture: $(uname -m) (need x86_64 or amd64)" >&2
    exit 1
    ;;
esac

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

if [ -z "$tag" ]; then
  tag="$(curl -fsSL https://api.github.com/repos/opencoredev/akeru-bot/releases/latest | sed -n 's/.*"tag_name":[[:space:]]*"\(v[0-9][^"]*\)".*/\1/p' | head -1)"
fi
[[ "$tag" =~ ^v[0-9]+[.][0-9]+[.][0-9]+$ ]]

version="${tag#v}"
echo "Installing Akeru Bot $tag for Linux (x86_64)..."

appimage="Akeru-Bot-${version}-x64.AppImage"
base="https://github.com/opencoredev/akeru-bot/releases/download/${tag}"
curl -fsSL -o "$tmp/SHA256SUMS" "$base/SHA256SUMS"
curl -fL -o "$tmp/$appimage" "$base/$appimage"

echo "Verifying checksum..."
line="$(grep -E "^[a-fA-F0-9]{64}[[:space:]]+\*?${appimage}\$" "$tmp/SHA256SUMS")" || exit 1
( cd "$tmp" && printf "%s\n" "$line" | sha256sum -c - )

echo "Installing..."
dest="$HOME/.local/bin/akeru-bot"
mkdir -p "$HOME/.local/bin"
if [ -e "$dest" ] && [ ! -f "$dest" ]; then
  echo "install-linux.sh: refusing to overwrite non-regular file: $dest" >&2
  exit 1
fi
backup=""
if [ -f "$dest" ]; then
  backup="$dest.backup"
  cp -p "$dest" "$backup"
fi
restore() {
  if [ -n "$backup" ]; then
    cp -p "$backup" "$dest" || true
  else
    rm -f "$dest"
  fi
}
if ! cp -p "$tmp/$appimage" "$dest"; then
  restore
  exit 1
fi
if ! chmod +x "$dest"; then
  restore
  exit 1
fi
if [ -n "$backup" ]; then
  rm -f "$backup"
fi
echo "Installed Akeru Bot $tag."
