#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

upstream="${FNOX_UPSTREAM_REPO:-https://github.com/jdx/fnox.git}"
homescoop="${HOMESCOOP_REPO:-https://github.com/ai-ecoverse/homescoop.git}"
src="${FNOX_SRC:-work/fnox}"
patches="${FNOX_PATCHES:-work/homescoop}"

read -r tag tag_sha < FNOX_TAG
ref="$(tr -d '[:space:]' < HOMESCOOP_REF)"
if ! [[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || ! [[ "${tag_sha:-}" =~ ^[0-9a-f]{40}$ ]]; then
  echo "FNOX_TAG must hold '<tag> <commit sha>', such as 'v1.39.0 cc06c75…'" >&2
  exit 2
fi
if ! [[ "$ref" =~ ^[0-9a-f]{40}$ ]]; then
  echo "HOMESCOOP_REF must hold one full homescoop commit sha, not '$ref'" >&2
  exit 2
fi

stamp="$tag $tag_sha $ref"
if [ -f "$src/.fnox-build-source" ] && [ "$(cat "$src/.fnox-build-source")" = "$stamp" ]; then
  echo "fnox source for $stamp is already in $src"
  exit 0
fi

rm -rf "$patches"
mkdir -p "$patches"
git -C "$patches" init -q
git -C "$patches" config core.autocrlf false
git -C "$patches" remote add origin "$homescoop"
MSYS_NO_PATHCONV=1 git -C "$patches" sparse-checkout set --no-cone /packages/wasi-fnox/ /crates/wasix-command/
git -C "$patches" fetch -q --depth 1 --filter=blob:none origin "$ref"
git -C "$patches" -c advice.detachedHead=false checkout -q FETCH_HEAD
if [ "$(git -C "$patches" rev-parse HEAD)" != "$ref" ]; then
  echo "fetched homescoop $(git -C "$patches" rev-parse HEAD), expected $ref" >&2
  exit 1
fi
recipe_version="$(sed -n 's/^version: *"\{0,1\}\([0-9][0-9.]*\)"\{0,1\} *$/\1/p' "$patches/packages/wasi-fnox/recipe.yaml")"
if [ "v$recipe_version" != "$tag" ]; then
  echo "homescoop $ref patches fnox $recipe_version, but FNOX_TAG is $tag; move them together" >&2
  exit 1
fi

mkdir -p "$src"
find "$src" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
git -C "$src" init -q
git -C "$src" config core.autocrlf false
git -C "$src" remote add origin "$upstream"
git -C "$src" fetch -q --depth 1 origin "refs/tags/$tag"
git -C "$src" -c advice.detachedHead=false checkout -q FETCH_HEAD
actual="$(git -C "$src" rev-parse HEAD)"
if [ "$actual" != "$tag_sha" ]; then
  echo "jdx/fnox $tag is $actual, expected $tag_sha" >&2
  exit 1
fi

bash "$patches/packages/wasi-fnox/apply.sh" "$src" "$patches"
cargo_version="$(node scripts/fnox-version.mjs "$src/Cargo.toml")"
if [ "v$cargo_version" != "$tag" ]; then
  echo "the patched Cargo.toml says fnox $cargo_version, but FNOX_TAG is $tag" >&2
  exit 1
fi
printf '%s\n' "$stamp" > "$src/.fnox-build-source"
echo "fnox source in $src: jdx/fnox $tag ($tag_sha) with the patches of homescoop $ref"
