#!/usr/bin/env bash
# Stages the npm tree for a release: one wrapper package plus one package per
# platform, each carrying the same native binary every other channel serves.
#
#   bash scripts/npm-pack.sh <release-dir> [staging-dir]
#
# Staged rather than published from the repository root, because the wrapper
# needs optionalDependencies on packages that do not exist until this release —
# putting them in the root manifest would break `bun install` for every
# contributor between now and the first publish.
set -euo pipefail

RELEASE=${1:?usage: npm-pack.sh <release-dir> [staging-dir]}
STAGING=${2:-dist/npm}
VERSION=$(grep -m1 'APP_VERSION' src/version.ts | sed "s/.*'\([^']*\)'.*/\1/")
REPO_URL=$(grep -m1 'REPO_URL' src/version.ts | sed "s/.*'\([^']*\)'.*/\1/")
DESCRIPTION=$(grep -m1 'APP_DESCRIPTION' src/version.ts | sed "s/.*'\([^']*\)'.*/\1/")
SITE_URL=$(grep -m1 'SITE_URL' src/version.ts | sed "s/.*'\([^']*\)'.*/\1/")

# npm's own names for what our artifacts call darwin-arm64 and so on. The
# postinstall resolves `${process.platform}-${process.arch}`, so these have to
# be the pair npm itself reports, not ours.
TARGETS=(
  "darwin-arm64:darwin:arm64"
  "darwin-x64:darwin:x64"
  "linux-x64:linux:x64"
  "linux-arm64:linux:arm64"
)

rm -rf "$STAGING"
mkdir -p "$STAGING"

for entry in "${TARGETS[@]}"; do
  name=${entry%%:*}
  rest=${entry#*:}
  os=${rest%%:*}
  cpu=${rest##*:}
  pkg="$STAGING/cli-$name"
  mkdir -p "$pkg/bin"

  tar -xzf "$RELEASE/tula-v$VERSION-$name.tar.gz" -C "$pkg/bin" tula
  chmod 755 "$pkg/bin/tula"
  cp LICENSE "$pkg/LICENSE"

  # `os` and `cpu` are what make the other three optional dependencies resolve
  # to nothing on this machine: npm refuses to install a package whose platform
  # does not match, and an optional failure is not an install failure.
  cat >"$pkg/package.json" <<JSON
{
  "name": "@tula/cli-$name",
  "version": "$VERSION",
  "description": "$DESCRIPTION (prebuilt $name binary)",
  "license": "MIT",
  "os": ["$os"],
  "cpu": ["$cpu"],
  "files": ["bin/tula", "LICENSE"],
  "repository": { "type": "git", "url": "git+$REPO_URL.git" },
  "homepage": "$SITE_URL"
}
JSON
done

# ------------------------------------------------------------------ wrapper ---

WRAPPER="$STAGING/cli"
mkdir -p "$WRAPPER/bin" "$WRAPPER/scripts"
cp LICENSE README.md "$WRAPPER/"

OPTIONAL=$(
  for entry in "${TARGETS[@]}"; do
    printf '    "@tula/cli-%s": "%s",\n' "${entry%%:*}" "$VERSION"
  done | sed '$ s/,$//'
)

cat >"$WRAPPER/package.json" <<JSON
{
  "name": "@tula/cli",
  "version": "$VERSION",
  "description": "$DESCRIPTION",
  "license": "MIT",
  "type": "module",
  "bin": { "tula": "bin/tula" },
  "engines": { "node": ">=22" },
  "files": ["bin/tula", "scripts/postinstall.mjs", "LICENSE", "README.md"],
  "scripts": { "postinstall": "node scripts/postinstall.mjs" },
  "optionalDependencies": {
$OPTIONAL
  },
  "repository": { "type": "git", "url": "git+$REPO_URL.git" },
  "homepage": "$SITE_URL",
  "keywords": ["trading", "crypto", "defi", "portfolio", "risk", "tui", "cli"]
}
JSON

# npm creates the bin shim from this path before postinstall runs, so the file
# has to exist first. Postinstall overwrites it in place with the real binary,
# which keeps the shim valid and means running tula never starts Node.
cat >"$WRAPPER/bin/tula" <<PLACEHOLDER
#!/bin/sh
echo "tula did not finish installing: the native binary was never copied here." >&2
echo "  Reinstall with:  npm install -g @tula/cli" >&2
echo "  Or install directly:  curl --proto '=https' --tlsv1.2 -LsSf $SITE_URL/install.sh | sh" >&2
exit 1
PLACEHOLDER
chmod 755 "$WRAPPER/bin/tula"

cat >"$WRAPPER/scripts/postinstall.mjs" <<'POSTINSTALL'
/**
 * Replaces the placeholder launcher with the native binary for this platform.
 *
 * Copied over the existing path rather than symlinked: npm has already created
 * its bin shim pointing at `bin/tula`, and overwriting the target keeps that
 * shim valid on every package manager, including the ones that copy rather than
 * link. The installed binary is the compiled executable, so running tula never
 * starts Node — Node is needed to install it, not to run it.
 */
import { chmodSync, copyFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const here = dirname(fileURLToPath(import.meta.url))
const target = `${process.platform}-${process.arch}`

try {
  const source = require.resolve(`@tula/cli-${target}/bin/tula`)
  const launcher = join(here, '..', 'bin', 'tula')
  copyFileSync(source, launcher)
  chmodSync(launcher, 0o755)
} catch {
  // Left as the placeholder, which says the same thing when run. Exiting
  // non-zero here would fail the whole install of a dependency tree that may
  // not even use tula on this machine.
  console.error(
    `tula has no prebuilt binary for ${target}.\n` +
      '  Supported: darwin-arm64, darwin-x64, linux-x64, linux-arm64.\n' +
      '  Build from source instead: https://github.com/hsnice16/tula',
  )
}
POSTINSTALL

echo "npm packages for v$VERSION -> $STAGING"
ls -1 "$STAGING"
