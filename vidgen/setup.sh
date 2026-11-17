#!/usr/bin/env bash
# One-step install for vidgen. Safe to re-run: every step checks before it acts.
#
#   1. uv (installed to ~/.local/bin when missing)
#   2. uv sync: the Python env
#   3. Node 20+ check, then npm ci && npm run build in renderer/
#   4. an ffmpeg with libx264 and loudnorm; when none is found, a pinned static build is
#      downloaded into ~/.cache/vidgen/bin (no sudo), checked against its sha256
#   5. uv tool install --editable . so `vidgen` is on PATH for other repos
#   6. vidgen doctor
#
# It downloads no TTS or alignment models; those run as servers you point vidgen.toml at.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN_DIR="${VIDGEN_BIN_DIR:-$HOME/.cache/vidgen/bin}"
UV_VERSION="0.13.9"

# Static ffmpeg: a dated BtbN autobuild (month-end builds are kept), release branch 8.1.
# Never use latest: the pin and its sha256 change together, by hand.
FFMPEG_TAG="autobuild-2026-10-31-12-59"
FFMPEG_BUILD="ffmpeg-n8.1.3-27-g8dca1586f4"
FFMPEG_SHA256_X86_64="41e9c565594c390622cf968d82fa4135d9e9a11d06c1515644288cbc844e3380"
FFMPEG_SHA256_AARCH64="a08c0ee6e1c4e02139344b303002dcc7c37cf125d639f1fbd15dabee40fcb525"

say() { printf 'setup: %s\n' "$*"; }
die() { printf 'setup: error: %s\n' "$*" >&2; exit 1; }

# --- 1. uv -------------------------------------------------------------------------------
export PATH="$HOME/.local/bin:$PATH"
if command -v uv >/dev/null 2>&1; then
  say "uv: $(command -v uv) ($(uv --version))"
else
  command -v curl >/dev/null 2>&1 || die "curl is needed to install uv"
  say "installing uv $UV_VERSION into ~/.local/bin"
  curl -LsSf "https://astral.sh/uv/$UV_VERSION/install.sh" | env UV_NO_MODIFY_PATH=1 sh
  command -v uv >/dev/null 2>&1 || die "uv install failed"
fi

# --- 2. Python env -----------------------------------------------------------------------
say "uv sync"
(cd "$HERE" && uv sync)

# --- 3. Node and the renderer ------------------------------------------------------------
command -v node >/dev/null 2>&1 || die "node not found; install Node 20+ (https://nodejs.org)"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 20 ] || die "node $(node --version) is too old; vidgen needs Node 20+"
say "node $(node --version): npm ci && npm run build in renderer/"
(cd "$HERE/renderer" && npm ci --no-audit --no-fund && npm run build)

# --- 4. ffmpeg ---------------------------------------------------------------------------
usable_ffmpeg() {
  [ -x "$1" ] || return 1
  "$1" -hide_banner -encoders 2>/dev/null | grep -q ' libx264 ' || return 1
  "$1" -hide_banner -filters 2>/dev/null | grep -q ' loudnorm ' || return 1
}

FFMPEG=""
for candidate in "$BIN_DIR/ffmpeg" "$(command -v ffmpeg || true)"; do
  if [ -n "$candidate" ] && usable_ffmpeg "$candidate"; then
    FFMPEG="$candidate"
    break
  fi
done

if [ -n "$FFMPEG" ]; then
  say "ffmpeg: $FFMPEG"
else
  case "$(uname -s)-$(uname -m)" in
    Linux-x86_64) arch="linux64"; sum="$FFMPEG_SHA256_X86_64" ;;
    Linux-aarch64 | Linux-arm64) arch="linuxarm64"; sum="$FFMPEG_SHA256_AARCH64" ;;
    *) die "no ffmpeg with libx264 found, and no pinned static build for $(uname -s) $(uname -m); install ffmpeg and re-run" ;;
  esac
  command -v curl >/dev/null 2>&1 || die "curl is needed to download ffmpeg"
  name="$FFMPEG_BUILD-$arch-gpl-8.1"
  url="https://github.com/BtbN/FFmpeg-Builds/releases/download/$FFMPEG_TAG/$name.tar.xz"
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  say "no ffmpeg with libx264 found; downloading $name ($FFMPEG_TAG)"
  curl -fL --retry 3 -o "$tmp/ffmpeg.tar.xz" "$url"
  echo "$sum  $tmp/ffmpeg.tar.xz" | sha256sum -c --quiet - || die "sha256 mismatch for $url"
  tar -xJf "$tmp/ffmpeg.tar.xz" -C "$tmp"
  mkdir -p "$BIN_DIR"
  install -m 0755 "$tmp/$name/bin/ffmpeg" "$tmp/$name/bin/ffprobe" "$BIN_DIR/"
  usable_ffmpeg "$BIN_DIR/ffmpeg" || die "the downloaded ffmpeg doesn't run"
  say "ffmpeg: $BIN_DIR/ffmpeg"
fi

# --- 5. the vidgen command ---------------------------------------------------------------
say "uv tool install --editable $HERE"
uv tool install --force --editable "$HERE"

# --- 6. doctor ---------------------------------------------------------------------------
say "vidgen doctor"
if (cd "$HERE" && uv run vidgen doctor); then
  say "done"
else
  say "done; doctor reported failures above (an endpoint that isn't running yet is expected)"
fi
