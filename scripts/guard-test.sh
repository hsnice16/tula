#!/usr/bin/env bash
# Proves guard.sh still catches what it claims to.
#
# The security page publishes these checks as the enforcement behind its
# promises, and a regex that silently stops matching is worse than no regex: the
# page keeps making the claim. Each probe is a write path somebody could
# plausibly add, planted in src/ and expected to be refused by name.
set -uo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT" || exit 1

PROBE=src/connectors/guard-probe.ts
AGENT_PROBE=src/agent/guard-probe.ts
# The credential store's own directory: one rule below is about what a module
# holding every credential at once is allowed to reach, so a probe outside it
# proves nothing about it.
SECRETS_PROBE=src/secrets/guard-probe.ts
# The boundary check's subject is the directory itself, so one probe below moves
# it. Restored on an interrupt as well: leaving src/agent under another name is
# a broken checkout, not a failed test.
RENAMED=src/agent-guard-probe
# One check's subject is CHANGELOG.md itself, which cannot be planted under a
# scratch name, so it is edited in place and restored — on an interrupt too.
CHANGELOG_SAVED=$(mktemp)
cp CHANGELOG.md "$CHANGELOG_SAVED"
# The same for src/agent/tools.ts: the field one probe plants has to go into the
# real file, because what it is testing is where a value in that file ends up.
TOOLS=src/agent/tools.ts
TOOLS_SAVED=$(mktemp)
cp "$TOOLS" "$TOOLS_SAVED"
# The reverse layout check's subject is a module that is *gone*, and AGENTS.md
# is what names it — so the probe deletes a real file rather than editing the
# doc, which is the one thing this script must not rewrite under a concurrent
# reader. A basename the tree carries twice, because a check matching basenames
# is exactly what passes here.
LAYOUT_GONE=src/connectors/registry.ts
LAYOUT_SAVED=$(mktemp)
cp "$LAYOUT_GONE" "$LAYOUT_SAVED"
restore() {
  rm -f "$PROBE" "$AGENT_PROBE" "$SECRETS_PROBE"
  [ -d "$RENAMED" ] && mv "$RENAMED" src/agent
  cp "$CHANGELOG_SAVED" CHANGELOG.md
  cp "$TOOLS_SAVED" "$TOOLS"
  # Only when the probe left it deleted: an unconditional copy would put the
  # start-of-run contents back over whatever the file holds by then.
  [ -f "$LAYOUT_GONE" ] || cp "$LAYOUT_SAVED" "$LAYOUT_GONE"
  rm -f "$CHANGELOG_SAVED" "$TOOLS_SAVED" "$LAYOUT_SAVED"
}
trap restore EXIT INT TERM

fail=0
# Captured first, then matched: under `pipefail` the guard's own non-zero exit
# would sink the pipeline even where grep found the line.
#
# Matched by message, not exit status: an untracked probe also trips the
# AGENTS.md check, which would let a dead regex pass for the wrong reason.
reports() {
  want=$1
  what=$2
  out=$(bash scripts/guard.sh 2>&1)
  if printf '%s\n' "$out" | grep -qF "GUARD FAILED: $want"; then
    echo "  ok: $what"
  else
    echo "  MISSED: $what"
    echo "        expected: $want"
    fail=1
  fi
}

expect() {
  printf '%s\n' "$2" > "$PROBE"
  reports "$1" "$2"
  rm -f "$PROBE"
}

# The same, planted inside the agent layer: the boundary is about what that
# directory can reach, so a probe anywhere else proves nothing about it.
expect_agent() {
  printf '%s\n' "$2" > "$AGENT_PROBE"
  reports "$1" "$2"
  rm -f "$AGENT_PROBE"
}

expect_secrets() {
  printf '%s\n' "$2" > "$SECRETS_PROBE"
  reports "$1" "$2"
  rm -f "$SECRETS_PROBE"
}

# The credential check reads the modules that name `ConnectorCredentials`, so a
# probe has to be one of them — which is also the shape a leak would arrive in.
expect_credential() {
  {
    printf "import type { ConnectorCredentials } from './types.js'\n"
    printf '%s\n' "$2"
  } > "$PROBE"
  reports "$1" "$2"
  rm -f "$PROBE"
}

ORDERS="an order, withdrawal or transfer endpoint is referenced in src/"
SIGNING="a transaction-signing RPC is referenced in src/"
KEYS="key material is handled outside src/connectors/coinbase.ts"

echo "guard-test: order and withdrawal endpoints"
expect "$ORDERS" "const p = '/0/private/AddOrder'"
expect "$ORDERS" "const p = '/api/v3/order'"
expect "$ORDERS" "const p = '/fapi/v1/order'"
expect "$ORDERS" "const p = '/sapi/v1/capital/withdraw/apply'"
expect "$ORDERS" "const p = '/api/v3/brokerage/orders'"
expect "$ORDERS" "const p = 'https://api.hyperliquid.xyz/exchange'"
expect "$ORDERS" "const p = '/v1/payouts'"
expect "$ORDERS" "const p = '/v1/transfers'"
expect "$ORDERS" "const p = '/v1/refunds'"

echo "guard-test: on-chain signing"
expect "$SIGNING" "const m = 'eth_sendRawTransaction'"
expect "$SIGNING" "const m = 'eth_sendTransaction'"
expect "$SIGNING" "const m = 'eth_signTypedData_v4'"
expect "$SIGNING" "const m = 'personal_sign'"

echo "guard-test: key material outside the Coinbase connector"
expect "$KEYS" "export const privateKey = ''"
expect "$KEYS" "const seedPhrase = ''"
expect "$KEYS" "const m = 'mnemonic'"
expect "$KEYS" "import { createPrivateKey } from 'node:crypto'"

# SECURITY.md states this one as an architectural guarantee rather than a habit,
# and every probe here got past the two greps that used to stand for it.
echo "guard-test: the agent layer reaching a credential or a venue"
STORE="the agent layer reaches src/secrets/store.ts"
CONNECTOR="the agent layer reaches src/connectors/kraken.ts"
expect_agent "$STORE" "import * as secrets from '../secrets/store.js'"
expect_agent "$STORE" "export { load } from '../secrets/store.js'"
expect_agent "$CONNECTOR" "export * from '../connectors/kraken.js'"
# Through a module that holds credentials rather than naming one: the shape the
# boundary would actually be crossed in, and the shape no grep of src/agent sees.
expect_agent "$STORE" "import type { Session } from '../cli/session.js'"
expect_agent "src/agent/guard-probe.ts builds an import specifier at runtime" \
  "const venue = await import(process.env['V'] ?? '')"

# `tasks/foundations/05-demo-fixture.md` cites this check as the evidence the
# fixture stays gone, and the fixture was registered on `TULA_DEMO`. Under \b
# that name matched nothing — `_` is a word character — so the one spelling the
# task names walked straight past the check standing for it.
echo "guard-test: language that reads as a toy project"
SKETCH="language that reads as a toy project is in shipped source"
expect "$SKETCH" "const enabled = process.env['TULA_DEMO'] === '1'"
expect "$SKETCH" "export const DUMMY_BOOK = []"
expect "$SKETCH" "// a fake price, for now"

# `redact()` was accepted for the log and error paths and never written. What
# stands in its place is the property itself: nothing hands a credential to
# anything that writes one. Planted against for the reason everything here is —
# these checks are what SECURITY.md's promise about the store rests on now.
echo "guard-test: a credential reaching a log, an error, a file or another process"
LEAK="a credential reaches a log, an error, a file or another process in $PROBE"
expect_credential "$LEAK" "export const leak = (c: ConnectorCredentials) => console.log(c)"
expect_credential "$LEAK" "export const leak = (c: ConnectorCredentials) => console.error(c['apiKey'])"
expect_credential "$LEAK" "export const leak = (c: ConnectorCredentials) => { throw new Error(\`key \${c['apiKey']} was refused\`) }"
expect_credential "$LEAK" "export const leak = (c: ConnectorCredentials) => process.stderr.write(c['apiSecret'] ?? '')"
expect_credential "$LEAK" "export const leak = (c: ConnectorCredentials) => JSON.stringify(c)"
expect_credential "$LEAK" "export const leak = (c: ConnectorCredentials) => writeFile('/tmp/x', c['signingKey'] ?? '')"
expect_credential "$LEAK" "export const leak = (c: ConnectorCredentials) => spawn('sh', [], { env: { K: c['apiSecret'] ?? '' } })"
expect_credential "$LEAK" "export const leak = (c: ConnectorCredentials) => { process.env['LEAK'] = c['passphrase'] ?? '' }"

# The half of the rule that is about not firing: an error whose prose says
# "credentials" is what every connector says when a stored one is incomplete,
# and a check that reads it as a leak is a check somebody turns off.
echo "guard-test: the words a real error uses are not a leak"
printf "import type { ConnectorCredentials } from './types.js'\nexport const fine = (c: ConnectorCredentials) => { if (!c['apiKey']) throw new Error('The stored credentials are incomplete. Reconnect the venue.') }\n" > "$PROBE"
out=$(bash scripts/guard.sh 2>&1)
rm -f "$PROBE"
if printf '%s\n' "$out" | grep -qF "GUARD FAILED: $LEAK"; then
  echo "  MISSED: an error that only names credentials in prose was read as one leaking"
  fail=1
else
  echo "  ok: prose about a credential is not a credential"
fi

echo "guard-test: the credential store reaching out of the process"
STORE_OUT="src/secrets can log, spawn or reach the network; the store that holds every credential may do none of them"
expect_secrets "$STORE_OUT" "export const trace = (v: string) => console.log(v)"
expect_secrets "$STORE_OUT" "export const send = (v: string) => fetch('https://example.invalid', { body: v })"
expect_secrets "$STORE_OUT" "import { spawn } from 'node:child_process'"

echo "guard-test: the agent layer under another name"
mv src/agent "$RENAMED"
reports "src/agent does not exist" "renaming the directory the checks are keyed on"
mv "$RENAMED" src/agent

echo "guard-test: a version bumped without its changelog section"
awk '{print} /^## \[Unreleased\]$/ && !done {print ""; print "## [0.0.0-probe] - 1970-01-01"; done=1}' \
  "$CHANGELOG_SAVED" > CHANGELOG.md
reports "CHANGELOG.md's newest section is 0.0.0-probe" "a section naming another release"
cp "$CHANGELOG_SAVED" CHANGELOG.md

# The layout check matches a basename in neither direction, and it used to match
# one in both: a second module of the same name was covered by the first one's
# entry — `src/connectors/registry.ts` walked past it behind `src/cli/registry.ts`
# — and a deleted module went on being described for as long as any directory
# held a file of that name. Both probes are a name the tree carries twice,
# because that is the only case a basename check misses.
echo "guard-test: a module the layout does not name"
probe=src/connectors/session.ts
printf 'export const planted = 1\n' >"$probe"
out=$(bash scripts/guard.sh 2>&1)
rm -f "$probe"
if printf '%s\n' "$out" | grep -qF "$probe is in the build but nowhere in AGENTS.md"; then
  echo "  ok: a basename documented elsewhere does not cover it"
else
  echo "  MISSED: $probe passed the layout check"
  fail=1
fi

echo "guard-test: the layout naming a module that is gone"
rm -f "$LAYOUT_GONE"
out=$(bash scripts/guard.sh 2>&1)
cp "$LAYOUT_SAVED" "$LAYOUT_GONE"
if printf '%s\n' "$out" | grep -qF "AGENTS.md still describes $LAYOUT_GONE, which no longer exists"; then
  echo "  ok: a sibling of the same basename does not stand in for it"
else
  echo "  MISSED: AGENTS.md kept describing $LAYOUT_GONE"
  fail=1
fi

# Whether venue text in a tool result is marked is a data-flow property, so no
# grep in guard.sh can reach it. The check that does lives in bun test: it runs
# every tool over an engine whose venue strings carry a sentinel and fails on
# any path the result does not declare as untrusted. It is planted against here
# for the reason everything above is — a check that silently stops catching
# things leaves SECURITY.md making the claim anyway.
echo "guard-test: a tool field carrying venue text without a mark"
command -v bun >/dev/null 2>&1 || {
  echo "  MISSED: bun is not installed, so nothing here checked the mark"
  fail=1
}
if command -v bun >/dev/null 2>&1; then
  awk '{print} /^        fetched_at: at\(f.loadedAt\),$/ {print "        probe_unmarked: f.failures[0] ?? null,"}' \
    "$TOOLS_SAVED" >"$TOOLS"
  if ! grep -qF 'probe_unmarked' "$TOOLS"; then
    # The anchor moved, so the probe planted nothing and the check below would
    # pass against an unmodified file — the failure mode this whole script exists for.
    echo "  MISSED: the probe planted no field; the anchor in $TOOLS has moved"
    fail=1
  else
    out=$(bun test src/agent/tools.test.ts 2>&1)
    cp "$TOOLS_SAVED" "$TOOLS"
    if printf '%s\n' "$out" | grep -qF 'get_venue_status declares probe_unmarked'; then
      echo "  ok: the unmarked field is named by the path it sits at"
    else
      echo "  MISSED: a new field carrying venue text passed without a mark"
      fail=1
    fi
  fi
  cp "$TOOLS_SAVED" "$TOOLS"
fi

# The real tree has to stay clean, or the probes above prove nothing: every
# venue's help links and field hints mention exactly these words in prose.
echo "guard-test: the tree itself"
clean=$(bash scripts/guard.sh 2>&1)
if printf '%s\n' "$clean" | grep -q '^guard: clean$'; then
  echo "  ok: no false positive on help links or hints"
else
  echo "  MISSED: guard.sh does not pass on the unmodified tree"
  fail=1
fi

[ $fail -eq 0 ] && echo "guard-test: clean"
exit $fail
