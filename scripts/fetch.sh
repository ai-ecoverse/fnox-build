#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

repo="${FNOX_REPO:-https://github.com/ai-ecoverse/fnox.git}"
src="${FNOX_SRC:-work/fnox}"
ref="$(tr -d '[:space:]' < FNOX_REF)"
if ! [[ "$ref" =~ ^[0-9a-f]{40}$ ]]; then
  echo "FNOX_REF must hold one full commit sha, not '$ref'" >&2
  exit 2
fi

if [ "$(git -C "$src" rev-parse HEAD 2>/dev/null || true)" = "$ref" ]; then
  echo "fnox source at $ref is already in $src"
  exit 0
fi

rm -rf "$src"
mkdir -p "$src"
git -C "$src" init -q
git -C "$src" remote add origin "$repo"
git -C "$src" fetch -q --depth 1 origin "$ref"
git -C "$src" -c advice.detachedHead=false checkout -q FETCH_HEAD
actual="$(git -C "$src" rev-parse HEAD)"
if [ "$actual" != "$ref" ]; then
  echo "fetched $actual, expected $ref" >&2
  exit 1
fi
echo "fnox source at $ref in $src (fnox $(node scripts/fnox-version.mjs "$src/Cargo.toml"))"
