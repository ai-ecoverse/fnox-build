#!/bin/sh
set -eu

if [ "$#" -ne 3 ]; then
  echo "usage: scripts/install-smoke.sh <asset> <SHA256SUMS> <version>" >&2
  exit 2
fi
asset="$1"
sums="$2"
version="$3"
url="https://github.com/ai-ecoverse/fnox-build/releases/latest/download/install.sh"

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

oneliner() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$url" | sh
  else
    wget -qO- "$url" | sh
  fi
}

want="$(awk -v name="$asset" '$2 == name {print $1}' "$sums")"
if [ -z "$want" ]; then
  echo "$sums has no entry for $asset" >&2
  exit 1
fi

attempt=1
while :; do
  oneliner || true
  got="$(sha256 "$HOME/.local/bin/fnox" 2>/dev/null || true)"
  if [ "$got" = "$want" ]; then
    break
  fi
  if [ "$attempt" -ge 5 ]; then
    echo "releases/latest does not install $asset of $version" >&2
    exit 1
  fi
  attempt=$((attempt + 1))
  sleep 30
done
"$HOME/.local/bin/fnox" --version

pinned="$(mktemp -d)"
if command -v curl >/dev/null 2>&1; then
  curl -fsSL "$url" | VERSION="$version" INSTALL_DIR="$pinned" sh
else
  wget -qO- "$url" | VERSION="$version" INSTALL_DIR="$pinned" sh
fi
test "$(sha256 "$pinned/fnox")" = "$want"
rm -rf "$pinned"
echo "releases/latest installs $asset of $version"
