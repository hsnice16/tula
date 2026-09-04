#!/usr/bin/env bash
# Enforces the promises in SECURITY.md. Documentation drifts; this does not.
set -uo pipefail

fail=0
report() { echo "GUARD FAILED: $1"; fail=1; }

# No code path may place an order or move funds — across every venue, not just
# the first one that had a connector. Matched on the endpoint segment rather
# than a whole path, because each venue spells the same act differently.
#
# `label:` and `hint:` lines are excluded: help links and field hints are prose
# shown to the user, and a Kraken doc URL under /exchange/ is not a call site.
# Whether the guard still catches a real one is asserted in guard-test.sh.
WRITE_ENDPOINTS='AddOrderBatch|AddOrder|CancelOrderBatch|CancelOrder|CancelAll|EditOrder'
WRITE_ENDPOINTS="$WRITE_ENDPOINTS|WithdrawCancel|Withdraw|withdraw|withdrawals"
WRITE_ENDPOINTS="$WRITE_ENDPOINTS|orders|order|payouts|transfers|refunds|exchange"
if grep -rnE "['\"][^'\"]*/($WRITE_ENDPOINTS)([/?][^'\"]*)?['\"]" \
     src --include='*.ts' --exclude='*.test.ts' | grep -vE '(label|hint):'; then
  report "an order, withdrawal or transfer endpoint is referenced in src/"
fi

# The same act on-chain is a signing RPC, not a path. eth_call and
# eth_getBalance cannot write; everything that can is named here.
if grep -rnE "(eth_sendTransaction|eth_sendRawTransaction|eth_signTransaction|eth_signTypedData|eth_sign|personal_sign)" \
     src --include='*.ts' --exclude='*.test.ts'; then
  report "a transaction-signing RPC is referenced in src/"
fi

# tula handles key material in exactly one place: the Coinbase connector, whose
# CDP credential *is* an asymmetric private key. Confining it is what lets the
# site say what tula does with a key rather than pretending it never sees one.
# Everywhere else, a public address or an HMAC secret and nothing more.
if grep -rlE "(createPrivateKey|createSign|BEGIN [A-Z ]*PRIVATE KEY|privateKey|private_key|PRIVATE_KEY|seedPhrase|seed_phrase|SEED_PHRASE|mnemonic)" \
     src --include='*.ts' --include='*.tsx' --exclude='*.test.ts' |
     grep -v '^src/connectors/coinbase.ts$'; then
  report "key material is handled outside src/connectors/coinbase.ts"
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
# output. The changelog is excluded because its job is to record that the
# fixture was removed — that history is the rule being kept, not broken — and it
# is read on GitHub, never rendered into these files.
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

# Three files print a `gh attestation verify` command with a release filename in
# it. A reader copies that line verbatim, so a stale version there sends them to
# an archive that does not exist and reports as a failed verification — which is
# the one thing this project must never say by accident.
for f in SECURITY.md README.md site/app/install/page.tsx; do
  # The whole filename, not a version parsed out of it: a pre-release version
  # carries a hyphen, and so does every target suffix after it.
  for named in $(grep -oE 'tula-v[A-Za-z0-9._-]+\.tar\.gz' "$f" | sort -u); do
    case "$named" in
      "tula-v$pkg_version-"*) ;;
      *) report "$f names $named; this release is tula-v$pkg_version" ;;
    esac
  done

  # The tag in the URL is a second copy of the version, and bumping only the
  # filename leaves a download that 404s under a verify line that looks right.
  for tag in $(grep -oE '/releases/download/v[A-Za-z0-9._-]+/' "$f" | sort -u); do
    [ "$tag" = "/releases/download/v$pkg_version/" ] ||
      report "$f downloads from $tag; this release is v$pkg_version"
  done
done

# The release notes point at this file, so its newest version section is what a
# reader is sent to. A bump that did not move the changelog sends them to the
# release before it. Only the newest section is checked; below it is history,
# and before the first release there is none, which is not a failure.
top=$(grep -m1 -oE '^## \[[0-9][^]]*\]' CHANGELOG.md | tr -d '#[] ' || true)
if [ -n "$top" ] && [ "$top" != "$pkg_version" ]; then
  report "CHANGELOG.md's newest section is $top; this release is $pkg_version"
fi

# One fact, one place. release.yml reads the hyphen; the binary must not be told
# separately, or a stable release ships a binary that calls itself pre-release.
grep -q "IS_PRE_RELEASE = APP_VERSION.includes('-')" src/version.ts ||
  report "src/version.ts sets IS_PRE_RELEASE by hand; derive it from APP_VERSION"

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

# components/Link is where every internal route turns Next's own scroll reset
# off, so that ScrollToTop has a scroll left to animate. Importing next/link
# anywhere else takes the jump back without saying so.
if grep -rnE "from ['\"]next/link['\"]" site/app site/components --include='*.tsx' 2>/dev/null |
     grep -v '^site/components/Link.tsx:'; then
  report "an internal link bypasses components/Link; the page would jump to the top"
fi

repo_url=$(grep -m1 'REPO_URL' src/version.ts | sed "s/.*'\([^']*\)'.*/\1/")
# An expired security.txt is worse than none: it is a published invitation to
# report a vulnerability through a channel nobody promises to read any more.
# RFC 9116 caps the lifetime at a year, so this fails while there is still time
# to renew it rather than on the day it lapses.
SECTXT=site/public/.well-known/security.txt
if [ -f "$SECTXT" ]; then
  expires=$(sed -n 's/^Expires: *//p' "$SECTXT")
  [ -n "$expires" ] || report "security.txt has no Expires field; RFC 9116 requires one"
  if [ -n "$expires" ]; then
    # BSD date first, GNU second: this runs on a developer's mac and on CI.
    left=$(( ( $(date -j -f '%Y-%m-%dT%H:%M:%S' "${expires%.*}" +%s 2>/dev/null ||
                 date -d "$expires" +%s) - $(date +%s) ) / 86400 ))
    [ "$left" -gt 30 ] || report "security.txt expires in $left days; renew it"
  fi
  grep -q "^Policy: $repo_url/blob/main/SECURITY.md\$" "$SECTXT" ||
    report "security.txt does not point at $repo_url/blob/main/SECURITY.md"
  # Two files name the channel a reporter is sent to. They drift apart silently,
  # and the one nobody notices is the one nobody can report through.
  contact=$(sed -n 's/^Contact: *//p' "$SECTXT")
  grep -qF "$contact" SECURITY.md ||
    report "security.txt Contact ($contact) is not the channel SECURITY.md names"
fi

grep -q "REPO=\"${repo_url#https://github.com/}\"" install.sh ||
  report "install.sh downloads from a different repository than src/version.ts names"

# Docs drift silently, and a module nobody listed is a module nobody maintains.
# Both directions: every shipped module appears in the AGENTS.md layout, and
# every file that layout names still exists. Tests are excluded — they live
# beside the code they cover, and the convention says so once, not per file.
# -co: a module added in this very commit is still untracked when the hook runs.
tracked() { git ls-files -co --exclude-standard "$@"; }
shipped=$(tracked src scripts install.sh | grep -E '\.(tsx?|sh)$' | grep -v '\.test\.ts$' |
  while read -r f; do basename "$f"; done | sort -u)

for base in $(tracked src | grep -E '\.tsx?$' | grep -v '\.test\.ts$' |
                while read -r f; do basename "$f"; done | sort -u); do
  grep -qF "$base" AGENTS.md ||
    report "$base is in the build but nowhere in AGENTS.md"
done

for named in $(sed -n '/^```text$/,/^```$/p' AGENTS.md |
                 grep -oE '[a-zA-Z][a-zA-Z0-9.-]*\.(tsx?|sh)' | sort -u); do
  printf '%s\n' "$shipped" | grep -qx "$named" ||
    report "AGENTS.md still describes $named, which no longer exists"
done

[ $fail -eq 0 ] && echo "guard: clean"
exit $fail
