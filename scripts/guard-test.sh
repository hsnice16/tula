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
trap 'rm -f "$PROBE"' EXIT INT TERM

fail=0
expect() {
  want=$1
  body=$2
  printf '%s\n' "$body" > "$PROBE"
  # Captured first, then matched: under `pipefail` the guard's own non-zero
  # exit would sink the pipeline even where grep found the line.
  #
  # Matched by message, not exit status: an untracked probe also trips the
  # AGENTS.md check, which would let a dead regex pass for the wrong reason.
  out=$(bash scripts/guard.sh 2>&1)
  if printf '%s\n' "$out" | grep -qF "GUARD FAILED: $want"; then
    echo "  ok: $body"
  else
    echo "  MISSED: $body"
    echo "        expected: $want"
    fail=1
  fi
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
