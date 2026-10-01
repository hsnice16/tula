#!/usr/bin/env bash
# Bun at the version CI pins, checked against the release's own SHASUMS256.txt
# before it runs, rather than an install script piped to a shell: AGENTS.md pins
# every dependency exactly, and the tool that installs them is no exception.
set -euo pipefail
BUN_VERSION=1.2.16

if ! command -v bun >/dev/null 2>&1 || [ "$(bun --version)" != "$BUN_VERSION" ]; then
  case "$(uname -s)-$(uname -m)" in
    Linux-x86_64) asset=bun-linux-x64 ;;
    Linux-aarch64 | Linux-arm64) asset=bun-linux-aarch64 ;;
    Darwin-arm64) asset=bun-darwin-aarch64 ;;
    Darwin-x86_64) asset=bun-darwin-x64 ;;
    *)
      echo "No Bun $BUN_VERSION build for $(uname -s) $(uname -m)." >&2
      exit 1
      ;;
  esac
  base="https://github.com/oven-sh/bun/releases/download/bun-v$BUN_VERSION"
  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' EXIT
  curl -fsSL "$base/$asset.zip" -o "$tmp/$asset.zip"
  curl -fsSL "$base/SHASUMS256.txt" -o "$tmp/SHASUMS256.txt"
  expected=$(awk -v f="$asset.zip" '$2 == f { print $1 }' "$tmp/SHASUMS256.txt")
  if command -v sha256sum >/dev/null 2>&1; then
    actual=$(sha256sum "$tmp/$asset.zip" | awk '{ print $1 }')
  else
    actual=$(shasum -a 256 "$tmp/$asset.zip" | awk '{ print $1 }')
  fi
  if [ -z "$expected" ] || [ "$expected" != "$actual" ]; then
    echo "$asset.zip does not match the checksum Bun published for $BUN_VERSION. Nothing was installed." >&2
    exit 1
  fi
  unzip -q "$tmp/$asset.zip" -d "$tmp"
  mkdir -p "$HOME/.bun/bin"
  install -m 755 "$tmp/$asset/bun" "$HOME/.bun/bin/bun"
  export PATH="$HOME/.bun/bin:$PATH"
fi

bun install --frozen-lockfile
bun run prepare-hooks
