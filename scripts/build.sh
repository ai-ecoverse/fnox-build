#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

host_platform() {
  local os arch
  case "$(uname -s)" in
    Darwin) os=darwin ;;
    Linux) os=linux ;;
    MINGW* | MSYS* | CYGWIN*) os=windows ;;
    *) echo "unsupported host OS $(uname -s)" >&2; exit 2 ;;
  esac
  case "$(uname -m)" in
    arm64 | aarch64) arch=arm64 ;;
    x86_64 | amd64) arch=x64 ;;
    *) echo "unsupported host CPU $(uname -m)" >&2; exit 2 ;;
  esac
  printf '%s-%s\n' "$os" "$arch"
}

platform="${1:-$(host_platform)}"
case "$platform" in
  darwin-arm64) target=aarch64-apple-darwin ;;
  darwin-x64) target=x86_64-apple-darwin ;;
  linux-arm64) target=aarch64-unknown-linux-musl ;;
  linux-x64) target=x86_64-unknown-linux-musl ;;
  windows-arm64) target=aarch64-pc-windows-msvc ;;
  windows-x64) target=x86_64-pc-windows-msvc ;;
  *) echo "usage: scripts/build.sh [darwin|linux|windows]-[arm64|x64]" >&2; exit 2 ;;
esac
ext=""
[ "${platform%%-*}" = "windows" ] && ext=".exe"

src="${FNOX_SRC:-work/fnox}"
out="artifacts/build"
FNOX_SRC="$src" scripts/fetch.sh
mkdir -p "$out"

builder="${FNOX_BUILDER:-}"
if [ -z "$builder" ]; then
  builder=cargo
  case "$target" in
    *-linux-musl) [ "$(uname -s)" = "Linux" ] && builder=cross ;;
  esac
fi

echo "building fnox for $platform ($target) with $builder"
(
  cd "$src"
  rustup target add "$target"
  "$builder" build --release --locked --bin fnox --target "$target"
)
cp "$src/target/$target/release/fnox$ext" "$out/fnox-$platform$ext"
cp "$src/LICENSE" "$out/LICENSE"
ls -l "$out/fnox-$platform$ext"
