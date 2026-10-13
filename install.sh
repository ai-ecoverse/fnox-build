#!/bin/sh
set -eu

repo="ai-ecoverse/fnox-build"
bin="fnox"
version="${VERSION:-}"
dir="${INSTALL_DIR:-}"
base="${SLICC_INSTALL_BASE_URL:-https://github.com/$repo/releases}"
tmp=""
part=""

usage() {
  cat <<EOF
Install SLICC's patched build of fnox (jdx/fnox plus homescoop's patches) from
the GitHub releases of $repo.

usage: install.sh [--version X] [--dir D]

  --version X   install release X, such as 1.39.0-slicc.3 (default: the latest)
  --dir D       install into D (default: \$HOME/.local/bin)
  -h, --help    print this help

The environment variables VERSION and INSTALL_DIR do the same.
EOF
}

say() {
  printf 'install.sh: %s\n' "$*" >&2
}

die() {
  say "$*"
  exit 1
}

cleanup() {
  if [ -n "$part" ]; then
    rm -f "$part"
  fi
  if [ -n "$tmp" ]; then
    rm -rf "$tmp"
  fi
}

need_value() {
  if [ "$2" -lt 2 ]; then
    say "$1 needs a value"
    usage >&2
    exit 2
  fi
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    -h | --help)
      usage
      exit 0
      ;;
    --version)
      need_value "$1" "$#"
      version="$2"
      shift 2
      ;;
    --version=*)
      version="${1#--version=}"
      shift
      ;;
    --dir)
      need_value "$1" "$#"
      dir="$2"
      shift 2
      ;;
    --dir=*)
      dir="${1#--dir=}"
      shift
      ;;
    *)
      say "unknown argument: $1"
      usage >&2
      exit 2
      ;;
  esac
done

if [ -z "$dir" ]; then
  dir="${HOME:?HOME is not set; pass --dir}/.local/bin"
fi

os="$(uname -s)"
case "$os" in
  Darwin) os="darwin" ;;
  Linux) os="linux" ;;
  *)
    say "there is no $bin build for $os here."
    say "Install it with npm instead: npm install -g @ai-ecoverse/fnox"
    say "On Windows, download fnox-windows-<arch>.exe from https://github.com/$repo/releases/latest"
    exit 1
    ;;
esac

arch="$(uname -m)"
case "$arch" in
  x86_64 | amd64) arch="amd64" ;;
  arm64 | aarch64) arch="arm64" ;;
  *)
    say "there is no $bin build for $arch CPUs."
    say "Install it with npm instead: npm install -g @ai-ecoverse/fnox"
    exit 1
    ;;
esac
if [ "$os" = "darwin" ] && [ "$arch" = "amd64" ] && [ "$(sysctl -n hw.optional.arm64 2>/dev/null || true)" = "1" ]; then
  arch="arm64"
fi
asset="$bin-$os-$arch"

case "$version" in
  "" | latest)
    url="$base/latest/download"
    label="the latest release"
    ;;
  *)
    version="v${version#v}"
    case "$version" in
      *[!0-9A-Za-z.+-]*) die "not a release version: $version" ;;
    esac
    url="$base/download/$version"
    label="$version"
    ;;
esac

if command -v curl >/dev/null 2>&1; then
  fetch() {
    curl -fsSL --retry 3 -o "$2" "$1"
  }
elif command -v wget >/dev/null 2>&1; then
  fetch() {
    wget -q -O "$2" "$1"
  }
else
  die "this needs curl or wget"
fi

if command -v sha256sum >/dev/null 2>&1; then
  sha256() {
    sha256sum "$1" | awk '{print $1}'
  }
elif command -v shasum >/dev/null 2>&1; then
  sha256() {
    shasum -a 256 "$1" | awk '{print $1}'
  }
else
  die "this needs sha256sum or shasum"
fi

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

mkdir -p "$dir" || die "cannot create $dir"
dir="$(cd "$dir" && pwd)"
tmp="$(mktemp -d "${TMPDIR:-/tmp}/fnox-install.XXXXXX")"
part="$(mktemp "$dir/.$bin.XXXXXX")" || die "cannot write to $dir"

say "downloading $asset from $label of $repo"
fetch "$url/SHA256SUMS" "$tmp/SHA256SUMS" || die "cannot download $url/SHA256SUMS"
want="$(awk -v name="$asset" '$2 == name || $2 == "*" name {print $1; exit}' "$tmp/SHA256SUMS")"
if [ -z "$want" ]; then
  die "SHA256SUMS has no entry for $asset; nothing was installed"
fi
fetch "$url/$asset" "$part" || die "cannot download $url/$asset"
got="$(sha256 "$part")"
if [ "$got" != "$want" ]; then
  die "the checksum of $asset is $got, but SHA256SUMS says $want; nothing was installed"
fi

chmod 755 "$part"
mv -f "$part" "$dir/$bin"
part=""

installed="$("$dir/$bin" --version)" || die "installed $dir/$bin, but it does not run"
printf '%s\n' "$installed"
say "installed SLICC's patched fnox to $dir/$bin"

case ":${PATH:-}:" in
  *":$dir:"*)
    found="$(command -v "$bin" 2>/dev/null || true)"
    if [ -n "$found" ] && [ "$found" != "$dir/$bin" ]; then
      say "note: $found comes first on your PATH and shadows $dir/$bin"
    fi
    ;;
  *)
    say "$dir is not on your PATH; add it with: export PATH=\"$dir:\$PATH\""
    ;;
esac
