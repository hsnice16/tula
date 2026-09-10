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
#
# A walk over the transitive imports, not a grep of what src/agent itself
# spells. SECURITY.md states this as an architectural guarantee, and two greps
# left four ways through it: a re-export, an import that reaches the store via a
# module in src/cli that holds one, a specifier assembled at runtime, and —
# because each grep was guarded on the directory existing — renaming src/agent,
# which made both checks vanish and report nothing at all.

# `src/agent/../core/risk.js` -> `src/core/risk.ts`. Normalised here rather than
# by realpath, which resolves against the filesystem and takes different flags
# on BSD and GNU. A bare package specifier is not in this tree, so it is not
# walked: the boundary is about our own modules reaching our own credentials.
resolve_spec() {
  local from=$1 spec=$2 p q candidate
  case "$spec" in .*) ;; *) return 1 ;; esac
  p="$(dirname "$from")/$spec"
  while :; do
    q=$(printf '%s' "$p" | sed -e 's|/\./|/|g' -e 's|^\./||' -e 's|[^/][^/]*/\.\./||')
    [ "$q" = "$p" ] && break
    p=$q
  done
  # Specifiers carry the `.js` extension ESM resolution wants; the file is `.ts`.
  for candidate in "${p%.js}.ts" "${p%.js}.tsx" "$p"; do
    if [ -f "$candidate" ]; then printf '%s' "$candidate"; return 0; fi
  done
  return 1
}

walk_imports() {
  local file=$1 chain=$2 spec target
  grep -qxF "$file" "$SEEN" 2>/dev/null && return 0
  printf '%s\n' "$file" >>"$SEEN"

  case "$file" in
    src/secrets/* | src/connectors/*)
      report "the agent layer reaches $file — $chain"
      return 0
      ;;
  esac

  # A specifier the walk cannot read is a specifier the walk cannot follow, and
  # inside this closure that is the hole rather than a gap in the check.
  if grep -nE "(^|[^A-Za-z0-9_\$.])(import|require)[[:space:]]*\([[:space:]]*[^'\"[:space:])]" "$file"; then
    report "$file builds an import specifier at runtime, which the agent-boundary walk cannot follow"
  fi

  for spec in $(grep -oE "(from|import|require)[[:space:]]*\(?[[:space:]]*['\"][^'\"]+['\"]" "$file" |
    sed -E "s/.*['\"]([^'\"]+)['\"]/\1/" | sort -u); do
    target=$(resolve_spec "$file" "$spec") || continue
    walk_imports "$target" "$chain -> $target"
  done
}

if [ ! -d src/agent ]; then
  report "src/agent does not exist, so nothing enforces the agent boundary SECURITY.md promises"
else
  SEEN=$(mktemp)
  entries=0
  for f in src/agent/*.ts src/agent/*.tsx; do
    [ -f "$f" ] || continue
    entries=$((entries + 1))
    walk_imports "$f" "$f"
  done
  [ "$entries" -gt 0 ] ||
    report "src/agent holds no modules, so the agent-boundary walk starts from nothing"
  rm -f "$SEEN"
fi

# A credential must not reach a log, an error, a file or another process.
#
# `tasks/foundations/02-secrets-boundary.md` accepted a `redact()` helper for
# this and nobody wrote one. It would not have been the check anyway: a function
# that only works where somebody remembers to call it is a habit with a type
# signature. The property that actually holds is that no credential is ever
# handed to something that writes one, and these two rules are that property
# rather than a note about it.
#
# What they catch and what they do not, stated because a grep that looks
# thorough and is not is worse than none.
#
# Rule 1: in every module that names `ConnectorCredentials` — the type every
# credential value in this tree arrives as, so the list is derived from the code
# and cannot be left behind by a new module — no credential-named expression may
# sit inside a log, a thrown error, a serialization, a file write, a child
# process or an environment assignment. Quoted text is dropped before matching,
# so an error whose *prose* says "credentials" is not a leak, while
# `creds['apiKey']` is: bracket access is normalized to a field name first,
# because that is how every connector here reads one. Only the text from the
# sink onwards is matched, so a guard clause testing a key before throwing is
# not read as throwing it. What it misses: a credential copied into a variable
# named something else first, a call split over several lines, a whole object
# handed to something that serializes it further down, prose inside a template
# literal, and anything a dependency does with a value it was passed. A grep
# cannot follow a value, and the store is excluded outright because writing
# credentials to disk is what it is for.
#
# Rule 2 is what the property actually rests on, and it is the one with no
# holes: the module holding every credential at once has no way out of the
# process to leak one through.
export CRED_SINK='console\.[a-z]+\(|process\.(stdout|stderr)\.write\(|JSON\.stringify\(|throw |writeFile|appendFile|spawn|execFile|exec\(|env\.|env\['
export CRED_NAME='creds|credential|credentials|apiKey|apiSecret|signingKey|passphrase|privateKey|secretKey|apiPassphrase|keySecret'
for f in $(grep -rl 'ConnectorCredentials' src --include='*.ts' --include='*.tsx' --exclude='*.test.ts'); do
  # Its own persistence, and rule 2 below is what stands over it instead.
  [ "$f" = src/secrets/store.ts ] && continue
  # Whatever this file calls the value, read off its own type annotations: the
  # object handed straight to a log is the leak that needs no field name at all,
  # and `console.log(c)` is as much of one as `console.log(creds)`.
  declared=$(grep -oE '[A-Za-z_$][A-Za-z0-9_$]*[[:space:]]*:[[:space:]]*ConnectorCredentials' "$f" |
    sed -E 's/[[:space:]]*:.*//' | sort -u | paste -sd'|' -)
  export CRED_HERE="(^|[^A-Za-z0-9_\$])($CRED_NAME${declared:+|$declared})([^A-Za-z0-9_\$]|$)"
  # ENVIRON rather than -v: awk expands escape sequences in a -v value, which
  # turns every `\(` in the pattern above into an unbalanced group.
  leaked=$(awk -v file="$f" '
    BEGIN { sink = ENVIRON["CRED_SINK"]; cred = ENVIRON["CRED_HERE"] }
    {
      line = $0
      gsub(/\[\047/, ".", line); gsub(/\047\]/, "", line)
      gsub(/\["/, ".", line);    gsub(/"\]/, "", line)
      gsub(/\047[^\047]*\047/, "", line)
      gsub(/"[^"]*"/, "", line)
      where = match(line, sink)
      if (where == 0) next
      if (match(substr(line, where), cred)) printf "%s:%d:%s\n", file, NR, $0
    }
  ' "$f")
  if [ -n "$leaked" ]; then
    printf '%s\n' "$leaked"
    report "a credential reaches a log, an error, a file or another process in $f"
  fi
done

if grep -rnE "(console\.[a-z]+|process\.(stdout|stderr)|child_process|[^a-zA-Z]fetch\(|[^a-zA-Z]exec\()" \
     src/secrets --include='*.ts' --exclude='*.test.ts'; then
  report "src/secrets can log, spawn or reach the network; the store that holds every credential may do none of them"
fi

# Nothing the user reads should suggest this is a sketch. People are deciding
# whether to point it at their net worth.
#
# Bounded by letters rather than by \b: `_` is a word character, so \b sat
# between `TULA` and `DEMO` and matched nothing — and `TULA_DEMO` is exactly how
# the demo fixture this check stands as the evidence against was spelled.
SKETCH="(^|[^A-Za-z])(demo|dummy|fake|toy|playground|just a test|for now)([^A-Za-z]|$)"
if grep -rniE "$SKETCH" src --include='*.ts' --include='*.tsx' --exclude='*.test.ts'; then
  report "language that reads as a toy project is in shipped source"
fi
# The site's own source only: node_modules and .next are dependencies and build
# output. The changelog is excluded because its job is to record that the
# fixture was removed — that history is the rule being kept, not broken — and it
# is read on GitHub, never rendered into these files.
if [ -d site/app ] && grep -rniE "$SKETCH" site/app site/components site/lib; then
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

# A third: the site's hero draws the banner the binary prints, version and all,
# and it is a separate package that cannot import src/version.ts. Left behind on
# a bump it publishes a release nobody can install as the tool's own output.
grep -q "export const VERSION = '$app_version'" site/lib/site.ts ||
  report "site/lib/site.ts does not state APP_VERSION from src/version.ts ($app_version)"

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

# The SDK reads ANTHROPIC_BASE_URL from the environment, so the host is stated
# in code or it is whatever a shell profile last set. SECURITY.md names every
# host tula talks to; without this the file could stop being true silently.
grep -q "const API_BASE_URL = 'https://api.anthropic.com'" src/agent/agent.ts ||
  report "src/agent/agent.ts does not pin the Anthropic base URL"
grep -q 'baseURL: API_BASE_URL' src/agent/agent.ts ||
  report "the Anthropic client is constructed without the pinned base URL"

# `fetch` strips `Authorization` across a cross-origin redirect and nothing
# else, so a venue's own key header would be re-sent to whatever the `Location`
# names. src/core/http.ts refuses redirects for that reason; the two callers
# that opt back in carry no credential, and any third has to be argued for here.
if grep -rn "redirect: *'follow'" src --include='*.ts' --include='*.tsx' \
     --exclude='*.test.ts' | grep -vE '^src/update/(check|apply)\.ts:'; then
  report "a credential-bearing request opts back into following redirects"
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

# A raw internal anchor leaves the app: a full document load, so the reader
# waits for the whole site again and lands wherever the browser puts them.
if grep -rn '<a href="/' site/app site/components --include='*.tsx' 2>/dev/null; then
  report "an internal link is a raw anchor; use <Link> instead"
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
# Filtered to what is on disk as well: a module removed with plain `rm` is still
# a cached path, and the reverse arm below asks whether a file still exists.
tracked() { git ls-files -co --exclude-standard "$@"; }
shipped=$(tracked src scripts install.sh | grep -E '\.(tsx?|sh)$' | grep -v '\.test\.ts$' |
  while read -r f; do [ -f "$f" ] && printf '%s\n' "$f"; done | sort -u)

# Both arms match on the path, not the basename. A basename is satisfied by any
# line mentioning it, so `src/connectors/registry.ts` was covered by the entry
# for `src/cli/registry.ts` — and, in this direction, AGENTS.md went on
# describing a deleted `src/cli/registry.ts` for as long as any directory held a
# file of that name. The layout is an indented tree, so the path is rebuilt from
# the indentation rather than read off the line.
layout_paths() {
  awk '
    /^```text$/ { inb=1; next }
    /^```$/     { inb=0; next }
    !inb        { next }
    {
      line=$0
      sub(/[[:space:]]*#.*$/, "", line)
      match(line, /^ */); ind=RLENGTH
      name=substr(line, ind+1)
      sub(/[[:space:]]+$/, "", name)
      if (name == "") next
      # The layout is not the only ```text fence in the file: the hard-boundary
      # diagram is one too, and its rows are prose that happens to end in a
      # module path. A tree entry is a bare name and never carries a space.
      if (name ~ /[[:space:]]/) next
      d = int(ind/2)
      if (name ~ /\/$/) { stack[d]=substr(name,1,length(name)-1); for(k=d+1;k<20;k++) stack[k]=""; next }
      p=""
      for (k=0;k<d;k++) if (stack[k]!="") p = p stack[k] "/"
      print p name
    }
  ' AGENTS.md
}
documented=$(layout_paths | grep -E '\.(tsx?|sh)$' | sort -u)

# One set each way, so the two arms cannot disagree about what "the build" is:
# the span is src, scripts and install.sh, and not `src` alone, because a script
# deleted from the tree was named while a script added to it was not.
for path in $shipped; do
  printf '%s\n' "$documented" | grep -qx "$path" ||
    report "$path is in the build but nowhere in AGENTS.md"
done

for named in $documented; do
  printf '%s\n' "$shipped" | grep -qx "$named" ||
    report "AGENTS.md still describes $named, which no longer exists"
done

[ $fail -eq 0 ] && echo "guard: clean"
exit $fail
