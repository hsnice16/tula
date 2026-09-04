#!/usr/bin/env bash
# Prepares a release and stops before the tag. Bumps the two files that both
# have to state the version, closes the changelog's Unreleased section into a
# dated one, and runs the whole gate — so the one irreversible step, pushing the
# tag, is taken by hand against a tree that has already been checked.
#
#   bash scripts/release-cut.sh <version>     # 0.2.0, or 0.2.0-rc.1
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

VERSION=${1:?usage: release-cut.sh <version>}
die() { echo "release-cut: $1" >&2; exit 1; }

# The hyphen is load-bearing: release.yml reads it to choose --prerelease over
# --latest and the npm dist-tag, and the binary derives its own label from it.
# A version outside this shape is one nothing downstream can interpret.
case "$VERSION" in
  v*) die "give the version without the leading v: ${VERSION#v}" ;;
esac
printf '%s' "$VERSION" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$' ||
  die "$VERSION is not a version release.yml can read (0.2.0, or 0.2.0-rc.1)"

current=$(grep -m1 'APP_VERSION' src/version.ts | sed "s/.*'\([^']*\)'.*/\1/")
[ "$VERSION" != "$current" ] || die "src/version.ts already says $VERSION"

# A release commit holds the release edits and nothing else, so that the tag
# names a tree somebody can read in one diff.
[ -z "$(git status --porcelain)" ] ||
  die "the tree is dirty; commit or stash first"

if git rev-parse -q --verify "refs/tags/v$VERSION" >/dev/null; then
  die "tag v$VERSION already exists"
fi

branch=$(git rev-parse --abbrev-ref HEAD)
[ "$branch" = main ] || echo "release-cut: warning: on $branch, not main" >&2

# Every anchor this rewrites is checked before anything is written: a half-cut
# changelog is worse to recover from than a refusal.
grep -q '^## \[Unreleased\]$' CHANGELOG.md ||
  die "CHANGELOG.md has no '## [Unreleased]' section to release"
grep -q '^\[Unreleased\]: ' CHANGELOG.md ||
  die "CHANGELOG.md has no '[Unreleased]:' link reference at the bottom"
if grep -q "^## \[$VERSION\]" CHANGELOG.md; then
  die "CHANGELOG.md already has a section for $VERSION"
fi

# An empty Unreleased section produces release notes describing nothing, under a
# number that cannot then be reused.
body=$(awk '/^## \[Unreleased\]$/ {on=1; next} on && /^## / {exit} on {print}' CHANGELOG.md |
  tr -d '[:space:]')
[ -n "$body" ] || die "the Unreleased section is empty; there is nothing to release"

REPO_URL=$(grep -m1 'REPO_URL' src/version.ts | sed "s/.*'\([^']*\)'.*/\1/")
DATE=$(date -u +%Y-%m-%d)

# The version section this one follows, read before the rewrite adds another.
prev=$(grep -m1 -oE '^## \[[0-9][^]]*\]' CHANGELOG.md | tr -d '#[] ' || true)
if [ -n "$prev" ]; then
  link="$REPO_URL/compare/v$prev...v$VERSION"
else
  link="$REPO_URL/releases/tag/v$VERSION"
fi

# BSD sed wants an argument to -i and GNU sed must not have one, so neither is
# used: every edit is a rewrite through a temporary file.
rewrite() {
  file=$1; shift
  tmp=$(mktemp)
  "$@" "$file" >"$tmp"
  mv "$tmp" "$file"
}

rewrite src/version.ts sed \
  "s/^export const APP_VERSION = '.*'\$/export const APP_VERSION = '$VERSION'/"
rewrite package.json sed \
  "s/^  \"version\": \".*\",\$/  \"version\": \"$VERSION\",/"

# A sed that matched nothing is silent, and the failure would surface as a tag
# disagreeing with the binary halfway through a release.
[ "$(grep -m1 'APP_VERSION' src/version.ts | sed "s/.*'\([^']*\)'.*/\1/")" = "$VERSION" ] ||
  die "src/version.ts did not take the bump; its APP_VERSION line has changed shape"
[ "$(grep -m1 '"version"' package.json | sed 's/.*"version": *"\([^"]*\)".*/\1/')" = "$VERSION" ] ||
  die "package.json did not take the bump; its version line has changed shape"

cut_changelog() {
  awk -v version="$VERSION" -v date="$DATE" -v repo="$REPO_URL" -v link="$link" '
    /^## \[Unreleased\]$/ && !cut { print; print ""; print "## [" version "] - " date; cut = 1; next }
    /^\[Unreleased\]: / { print "[Unreleased]: " repo "/compare/v" version "...HEAD"
                          print "[" version "]: " link; next }
    { print }
  ' "$1"
}
rewrite CHANGELOG.md cut_changelog

echo "release-cut: $current -> $VERSION, changelog dated $DATE. Running the gate."
echo

if ! bun run check; then
  echo >&2
  echo "release-cut: the gate failed. The bump and the changelog edit are still" >&2
  echo "in the tree; undo them with  git checkout -- ." >&2
  exit 1
fi

cat <<NEXT

release-cut: v$VERSION is prepared and the gate is green. Nothing is published —
pushing the tag is what publishes.

  git add CHANGELOG.md package.json src/version.ts
  git commit -m "tula v$VERSION"
  git push origin $branch

Then, once CI is green on that commit:

  git tag -a v$VERSION -m "tula v$VERSION"
  git push origin v$VERSION

A dry run first costs nothing: run the Release workflow from the Actions tab
with publish off. It builds, signs, attests and uploads, and publishes nothing.
NEXT
