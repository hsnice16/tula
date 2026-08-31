#!/usr/bin/env bash
# Enforces the promises in SECURITY.md. Documentation drifts; this does not.
set -uo pipefail

fail=0
report() { echo "GUARD FAILED: $1"; fail=1; }

# No code path may place an order or move funds. Matched as a quoted endpoint
# path so prose and the signing test vector (which signs a sample payload
# without calling anything) do not trip it.
if grep -rnE "['\"]/0/private/(AddOrder|AddOrderBatch|CancelOrder|CancelOrderBatch|CancelAll|EditOrder|Withdraw|WithdrawCancel)['\"]" \
     src --include='*.ts' --exclude='*.test.ts'; then
  report "an order or withdrawal endpoint is referenced in src/"
fi

# tula never handles key material. Public addresses only. Identifier forms
# only, so the connect screen can promise in prose that we never ask for a seed.
if grep -rnE "(privateKey|private_key|PRIVATE_KEY|seedPhrase|seed_phrase|SEED_PHRASE|mnemonic)" \
     src --include='*.ts' --exclude='*.test.ts'; then
  report "key material handled in src/"
fi

# The agent layer sees computed views only: no credential, no venue client.
if [ -d src/agent ] && grep -rn "secrets/store" src/agent; then
  report "the agent layer imports the secret store"
fi
if [ -d src/agent ] && grep -rn "connectors/" src/agent; then
  report "the agent layer imports a connector"
fi

# Nothing the user reads should suggest this is a sketch. People are deciding
# whether to point it at their net worth.
if grep -rniE "\\b(demo|dummy|fake|toy|playground|just a test|for now)\\b" src --include='*.ts' --include='*.tsx' --exclude='*.test.ts'; then
  report "language that reads as a toy project is in shipped source"
fi
# The site's own source only: node_modules and .next are dependencies and build
# output, and the changelog's job is to record that the fixture was removed —
# that history is the rule being kept, not broken. It is read from CHANGELOG.md
# at build time and never lives in these files.
if [ -d site/app ] && grep -rniE "\\b(demo|dummy|fake|toy|playground|just a test|for now)\\b" \
     site/app site/components site/lib; then
  report "language that reads as a toy project is on the site"
fi

# One version, two files that both have to state it: package.json is what npm
# publishes, src/version.ts is what `tula --version` and /about print. A user
# checking whether their binary matches a release compares exactly these two.
pkg_version=$(grep -m1 '"version"' package.json | sed 's/.*"version": *"\([^"]*\)".*/\1/')
app_version=$(grep -m1 'APP_VERSION' src/version.ts | sed "s/.*'\([^']*\)'.*/\1/")
if [ "$pkg_version" != "$app_version" ]; then
  report "package.json is $pkg_version and src/version.ts is $app_version"
fi

# install.sh builds its download URL from names release-build.sh chose. Drift
# between them is invisible until a tag is pushed, and produces a release that
# every user's installer 404s on.
built=$(sed -n 's/^  "\([a-z0-9_-]*\):.*/\1/p' scripts/release-build.sh)
[ "$(printf '%s\n' "$built" | grep -c .)" -eq 4 ] ||
  report "release-build.sh no longer builds four targets"
# install.sh is not grepped: it composes the name from uname rather than holding
# it, so the thing that proves it agrees is install-test.sh running the real
# script. Requiring the test to name every built target is what closes that.
for t in $built; do
  grep -q "$t" scripts/homebrew-formula.sh || report "homebrew formula has no $t"
  grep -q "$t" scripts/npm-pack.sh || report "npm packaging has no $t"
  grep -q "$t" scripts/install-test.sh || report "install-test.sh does not cover $t"
done

# Every outbound call has to carry a deadline. A bare fetch is one nothing
# bounds, and an unreachable venue then hangs the shell rather than being named
# — the one failure mode this tool must never have.
if grep -rn '\bfetch(' src --include='*.ts' --include='*.tsx' \
     --exclude='*.test.ts' --exclude='http.ts'; then
  report "a bare fetch() bypasses the timeout in src/core/http.ts"
fi

# src/version.ts declares where tula is published. Three files restate it because
# they cannot import from there — install.sh is a standalone artifact, the site
# is a separate package, package.json is not TypeScript — so drift is caught here
# rather than by a user whose install command fetches nothing.
site_url=$(grep -m1 'SITE_URL' src/version.ts | sed "s/.*'\([^']*\)'.*/\1/")
[ -n "$site_url" ] || report "src/version.ts declares no SITE_URL"
grep -q "SITE=\"$site_url\"" install.sh ||
  report "install.sh does not match SITE_URL in src/version.ts ($site_url)"
grep -q "export const SITE = '$site_url'" site/lib/site.ts ||
  report "site/lib/site.ts does not match SITE_URL in src/version.ts ($site_url)"
grep -q "\"homepage\": \"$site_url\"" package.json ||
  report "package.json homepage does not match SITE_URL in src/version.ts ($site_url)"

# A raw internal anchor skips Next's basePath, so it works in `next dev` and
# 404s on the deployed project site — the one place nobody tests.
if grep -rn '<a href="/' site/app site/components --include='*.tsx' 2>/dev/null; then
  report "an internal link bypasses basePath; use <Link> instead"
fi

repo_url=$(grep -m1 'REPO_URL' src/version.ts | sed "s/.*'\([^']*\)'.*/\1/")
grep -q "REPO=\"${repo_url#https://github.com/}\"" install.sh ||
  report "install.sh downloads from a different repository than src/version.ts names"

[ $fail -eq 0 ] && echo "guard: clean"
exit $fail
