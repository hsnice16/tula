#!/usr/bin/env bash
# Proves scan-staged still catches what it claims to.
#
# The same argument as guard-test.sh: SECURITY.md and CONTRIBUTING publish this
# hook as the reason a pasted key never reaches history, and a pattern that
# stops matching leaves the claim standing with nothing behind it. Every probe
# below is a credential somebody could plausibly paste — and the formats this
# tool actually holds are here, not just the ones with a vendor prefix.
#
# Runs against a scratch repository rather than this one, so a probe is never a
# staged secret in the real index even for the length of a test.
set -uo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT INT TERM

mkdir -p "$WORK/.githooks"
cp "$ROOT/.githooks/scan-staged" "$ROOT/.githooks/allowed-secrets" "$WORK/.githooks/"
git -C "$WORK" init -q
git -C "$WORK" config user.email t@example.invalid
git -C "$WORK" config user.name t

fail=0

# Empty. Its only job is to break a prefix apart in the source above, so the
# scanner reading *this* file does not see a token it would have to allowlist.
x=

# The scanner reads staged content, so each probe is written, added, tested and
# unstaged. `git reset` rather than a new repo per probe: same isolation, and
# the whole suite still runs in well under a second.
probe() {
  outcome=$1
  name=$2
  body=$3
  file=${4:-probe.ts}

  printf '%s\n' "$body" > "$WORK/$file"
  git -C "$WORK" add "$file"
  out=$(cd "$WORK" && bash .githooks/scan-staged 2>&1)
  status=$?
  git -C "$WORK" reset -q
  rm -f "$WORK/$file"

  case "$outcome" in
    caught)
      if [ $status -ne 0 ]; then
        echo "  ok: $name"
      else
        echo "  MISSED: $name"
        fail=1
      fi
      ;;
    quiet)
      if [ $status -eq 0 ]; then
        echo "  ok: $name"
      else
        echo "  FALSE POSITIVE: $name"
        printf '%s\n' "$out" | sed 's/^/        /'
        fail=1
      fi
      ;;
  esac
}

# Assembled rather than written out. A probe spelled in full would be a literal
# credential in a tracked file, which is the one thing this hook exists to stop
# — and exempting the file by path would leave a hole shaped exactly like the
# place somebody would hide one.
hex32=4c0883a69102937d6231471b5dbb6204
hex64="$hex32${hex32}"
b64=kQH5HW/8p1uGOVjbgWA7FunAmGO8lsSU
half="legal winner thank year wave sausage"

echo "scan-test: vendor-prefixed tokens"
probe caught "an Anthropic key" "const k = 'sk-${x}ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789'"
probe caught "a GitHub PAT" "const k = 'g${x}hp_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789'"
probe caught "an AWS access key id" "const k = 'AK${x}IAIOSFODNN7EXAMPLE'"
probe caught "a PEM private key" "const k = '-----BEG${x}IN OPENSSH PRIVATE KEY-----'"

echo "scan-test: the credentials tula actually holds"
# No vendor prefix and no fixed length between them — the reason the name is
# matched rather than the value.
probe caught "a Kraken API secret" "const apiSecret = '${b64}${b64}=='"
probe caught "a Binance secret key" "const secret = '${b64}${b64}'"
pw=hunter2hunter2hunter2
probe caught "a password in a config assignment" "DB_PASS${x}WORD='$pw'"

echo "scan-test: key material and seed phrases"
probe caught "a bare EVM private key" "const k = '$hex64'"
probe caught "a prefixed EVM private key" "const k = '0x$hex64'"
probe caught "a 12-word seed phrase" "const m = '$half $half'"

# Both of these got past an earlier version of the hook, which is why they are
# here: one required quotes around the value, the other trusted the extension.
echo "scan-test: the shapes a leak is actually written in"
probe caught "an unquoted KEY=value, as a .env holds it" "KRAKEN_API_SEC${x}RET=${b64}${b64}=="
probe caught "a credential in a text file merely named .png" \
  "const apiSecret = '${b64}${b64}=='" logo.png

echo "scan-test: addresses"
probe caught "an unlisted address" "const a = '0x${hex32}12345678'"
probe quiet "an allowlisted public contract" \
  "const pool = '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2'"

echo "scan-test: lockfiles"
probe quiet "a lockfile of integrity hashes" \
  '"sha512-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789AbCdEfGhIjKlMnOpQrStUv=="' bun.lock
probe caught "a registry token in a lockfile" \
  "//registry.npmjs.org/:_authToken=np${x}m_AbCdEfGhIjKlMnOpQrStUvWxYz01" bun.lock

# The cases the scanner has to stay quiet about, or it teaches --no-verify.
echo "scan-test: no false positive on ordinary code"
probe quiet "ABI calldata padded with zeros" \
  "const data = '0x70a08231000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead908'"
probe quiet "a sha512 integrity hash in a lockfile" \
  '"integrity": "sha512-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789=="' bun.lock
probe quiet "prose about secrets" \
  "// The secret is never logged, and the api_key is read from the store."
probe quiet "a field named secret with no value" "fields: [{ name: 'apiSecret', secret: true }]"

[ $fail -eq 0 ] && echo "scan-test: clean"
exit $fail
