#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
src="${FNOX_SRC:-$root/work/fnox}"
index="$(mktemp "${TMPDIR:-/tmp}/fnox-source-index.XXXXXX")"
trap 'rm -f "$index"' EXIT
rm -f "$index"
GIT_INDEX_FILE="$index" git -C "$src" add -A -- . ':!.fnox-build-source'
GIT_INDEX_FILE="$index" git -C "$src" write-tree
