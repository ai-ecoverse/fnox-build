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

native_path() {
  if command -v cygpath >/dev/null 2>&1; then
    cygpath -w "$1"
  else
    printf '%s\n' "$1"
  fi
}

remap_flags() {
  local cargo_home="${CARGO_HOME:-$HOME/.cargo}" from to seen=""
  mkdir -p "$cargo_home"
  for pair in \
    "$(cd "$cargo_home" && pwd)=/cargo" "$(cd "$cargo_home" && pwd -P)=/cargo" \
    "$(cd "$src" && pwd)=/fnox" "$(cd "$src" && pwd -P)=/fnox"; do
    from="$(native_path "${pair%=*}")"
    to="${pair##*=}"
    case "$seen" in *"|$from|"*) continue ;; esac
    seen="$seen|$from|"
    printf -- '--remap-path-prefix=%s=%s\n' "$from" "$to"
  done
}

export CPPFLAGS="${CPPFLAGS:+$CPPFLAGS }-DOPENSSL_NO_AUTOLOAD_CONFIG"
if [ "${platform%%-*}" != "windows" ]; then
  export OPENSSL_CONFIG_DIR=/var/empty
fi
if [ "${platform%%-*}" = "darwin" ]; then
  MACOSX_DEPLOYMENT_TARGET="$(rustc --print deployment-target --target "$target" | sed 's/^[A-Z_]*=//')"
  export MACOSX_DEPLOYMENT_TARGET
fi
if [ "${platform%%-*}" = "windows" ]; then
  trim=""
  mkdir -p "${CARGO_HOME:-$HOME/.cargo}"
  for dir in "${CARGO_HOME:-$HOME/.cargo}" "$src"; do
    dir="$(cd "$dir" && pwd)"
    trim="$trim /d1trimfile:$(cygpath -w "$dir")"
    short="$(cygpath -s -w "$dir")"
    [ "$short" != "$(cygpath -w "$dir")" ] && trim="$trim /d1trimfile:$short"
  done
  target_var="$(printf '%s' "$target" | tr '-' '_')"
  export "CFLAGS_$target_var=${trim# }"
  export "CXXFLAGS_$target_var=${trim# }"
fi
export CROSS_BUILD_ENV_PASSTHROUGH="FNOX_NO_PIE CPPFLAGS OPENSSL_CONFIG_DIR"

echo "building fnox for $platform ($target) with $builder"
if [ "$builder" = "cargo" ]; then
  CARGO_ENCODED_RUSTFLAGS=""
  while IFS= read -r flag; do
    CARGO_ENCODED_RUSTFLAGS="${CARGO_ENCODED_RUSTFLAGS:+$CARGO_ENCODED_RUSTFLAGS$'\x1f'}$flag"
  done < <(remap_flags)
  export CARGO_ENCODED_RUSTFLAGS
fi
(
  cd "$src"
  rustup target add "$target"
  "$builder" build --release --locked --bin fnox --target "$target"
)
node scripts/leak-check.mjs "$src/target/$target/release/fnox$ext" || {
  if [ "${FNOX_ALLOW_HOST_PATHS:-0}" = "1" ]; then
    echo "::warning::the fnox binary contains host paths (FNOX_ALLOW_HOST_PATHS=1)"
  else
    echo "::error::the fnox binary contains host paths; build from a neutral FNOX_SRC, or set FNOX_ALLOW_HOST_PATHS=1 for a local build"
    exit 1
  fi
}
cp "$src/target/$target/release/fnox$ext" "$out/fnox-$platform$ext"
cp "$src/LICENSE" "$out/LICENSE"
ls -l "$out/fnox-$platform$ext"
