#!/usr/bin/env bash
# Cross-compiles every published target and lays the artifacts out exactly as a
# release serves them. Run by the release workflow, and runnable by hand — a
# release process nobody can execute locally is one nobody can debug.
#
#   bash scripts/release-build.sh [output-dir]
set -euo pipefail

OUT=${1:-dist/release}
VERSION=$(grep -m1 'APP_VERSION' src/version.ts | sed "s/.*'\([^']*\)'.*/\1/")

# The names the installer builds its URLs from. Changing one here without
# changing install.sh produces a release nobody can install.
TARGETS=(
  "darwin-arm64:bun-darwin-arm64"
  "darwin-x64:bun-darwin-x64"
  "linux-x64:bun-linux-x64"
  "linux-arm64:bun-linux-arm64"
)

rm -rf "$OUT"
mkdir -p "$OUT"

# Reproducible archives: two builds of the same commit must produce the same
# checksum, or a checksum that changed for no reason teaches people to ignore
# checksums. macOS ships bsdtar, which spells ownership differently and has no
# --mtime at all, so the timestamp is set on the staged files instead.
if tar --version 2>/dev/null | grep -qi gnu; then
  TAR_FLAGS=(--owner=0 --group=0 --numeric-owner)
else
  TAR_FLAGS=(--uid 0 --gid 0 --uname "" --gname "")
fi

for entry in "${TARGETS[@]}"; do
  name=${entry%%:*}
  target=${entry##*:}
  stage="$OUT/stage/$name"
  mkdir -p "$stage"

  echo "building $name"
  bun build src/index.ts --compile --target="$target" --outfile "$stage/tula"
  chmod 755 "$stage/tula"
  cp LICENSE "$stage/LICENSE"

  # Members are named explicitly rather than by recursing the directory, so
  # their order in the archive is fixed without needing GNU's --sort.
  touch -t 197001010000 "$stage/tula" "$stage/LICENSE"
  tar "${TAR_FLAGS[@]}" -czf "$OUT/tula-v$VERSION-$name.tar.gz" \
    -C "$stage" tula LICENSE
done

rm -rf "$OUT/stage"

# One checksums file for the whole release: the installer downloads it once and
# looks up whichever archive it fetched.
if command -v sha256sum >/dev/null 2>&1; then
  (cd "$OUT" && sha256sum ./*.tar.gz | sed 's| \./| |' >checksums.txt)
else
  (cd "$OUT" && shasum -a 256 ./*.tar.gz | sed 's| \./| |' >checksums.txt)
fi

echo
echo "tula v$VERSION -> $OUT"
ls -1 "$OUT"
