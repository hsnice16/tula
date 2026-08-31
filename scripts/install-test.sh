#!/usr/bin/env bash
# Exercises install.sh as published, unmodified. The origin it downloads from is
# hardcoded on purpose — an env var that redirects the download is exactly the
# injection this script exists to prevent — so the network is faked one level
# lower, by putting a `curl` shim ahead of the real one on PATH.
#
#   bash scripts/install-test.sh
set -uo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

pass=0
fail=0
ok() {
  printf '  ok    %s\n' "$1"
  pass=$((pass + 1))
}
bad() {
  printf '  FAIL  %s\n' "$1"
  [ -n "${2:-}" ] && printf '        %s\n' "$2"
  fail=$((fail + 1))
}

# A release exactly as the workflow lays one out: two archives and a checksums
# file listing both.
RELEASE="$WORK/release"
mkdir -p "$RELEASE/stage"
printf '#!/bin/sh\necho tula 9.9.9\n' >"$RELEASE/stage/tula"
chmod 755 "$RELEASE/stage/tula"
cp "$ROOT/LICENSE" "$RELEASE/stage/LICENSE"
for t in darwin-arm64 darwin-x64 linux-x64 linux-arm64; do
  tar -czf "$RELEASE/tula-v9.9.9-$t.tar.gz" -C "$RELEASE/stage" tula LICENSE
done
if command -v sha256sum >/dev/null 2>&1; then
  (cd "$RELEASE" && sha256sum ./*.tar.gz | sed 's| \./| |' >checksums.txt)
else
  (cd "$RELEASE" && shasum -a 256 ./*.tar.gz | sed 's| \./| |' >checksums.txt)
fi

# The shim answers the two shapes install.sh uses: a redirect probe that reports
# where /releases/latest landed, and a file download.
SHIM="$WORK/shim"
mkdir -p "$SHIM"
cat >"$SHIM/curl" <<SHIM_EOF
#!/usr/bin/env bash
url=""; out=""; want_url=0
while [ \$# -gt 0 ]; do
  case "\$1" in
    -o) out="\$2"; shift 2 ;;
    -w) case "\$2" in *url_effective*) want_url=1 ;; esac; shift 2 ;;
    https://*) url="\$1"; shift ;;
    *) shift ;;
  esac
done
if [ "\$want_url" = 1 ]; then printf '%s' "https://github.com/hsnice16/tula/releases/tag/v\${FAKE_LATEST:-9.9.9}"; exit 0; fi
name=\${url##*/}
[ -f "$RELEASE/\$name" ] || exit 22
cp "$RELEASE/\$name" "\$out"
SHIM_EOF
chmod 755 "$SHIM/curl"

# -u ZDOTDIR because zsh really does read $ZDOTDIR/.zshrc ahead of $HOME's, so
# a developer who sets it would have the profile test write to their own shell
# config. The installer is right to honour it; the test has to opt out.
sandbox() {
  env -u ZDOTDIR -u TULA_VERSION -u TULA_REQUIRE_ATTESTATION \
    PATH="$SHIM:$PATH" HOME="$1" TULA_INSTALL_DIR="$1/.tula" "${@:2}"
}

run() {
  sandbox "$1" env SHELL=/bin/bash TULA_NO_MODIFY_PATH=1 \
    "${@:2}" sh "$ROOT/install.sh" 2>&1
}

# ---------------------------------------------------------------------------

echo "install.sh"

H="$WORK/h1"
mkdir -p "$H"
out=$(run "$H")
if [ -L "$H/.tula/bin/tula" ] && [ -x "$H/.tula/versions/9.9.9/tula" ]; then
  ok "installs the latest version behind a symlink"
else
  bad "installs the latest version behind a symlink" "$out"
fi
case "$out" in *"Provenance was not"*) ok "says so when it could not prove provenance" ;;
  *) bad "says so when it could not prove provenance" "$out" ;; esac

H="$WORK/h2"
mkdir -p "$H"
out=$(run "$H" env TULA_VERSION=9.9.9)
[ -d "$H/.tula/versions/9.9.9" ] && ok "installs a pinned version" ||
  bad "installs a pinned version" "$out"

# A tampered archive must not reach the disk, whatever else it satisfies.
H="$WORK/h3"
mkdir -p "$H"
cp "$RELEASE/checksums.txt" "$WORK/checksums.bak"
sed 's/^[0-9a-f]\{8\}/deadbeef/' "$WORK/checksums.bak" >"$RELEASE/checksums.txt"
out=$(run "$H")
if [ ! -e "$H/.tula/bin/tula" ] && case "$out" in *"does not match its published checksum"*) true ;; *) false ;; esac; then
  ok "refuses an archive that fails its checksum, and installs nothing"
else
  bad "refuses an archive that fails its checksum, and installs nothing" "$out"
fi
cp "$WORK/checksums.bak" "$RELEASE/checksums.txt"

# gh present and failing is the hostile case: a real binary, real checksum, but
# not built by this repository.
H="$WORK/h4"
mkdir -p "$H"
printf '#!/bin/sh\nexit 1\n' >"$SHIM/gh"
chmod 755 "$SHIM/gh"
out=$(run "$H")
if [ ! -e "$H/.tula/bin/tula" ] && case "$out" in *"failed attestation"*) true ;; *) false ;; esac; then
  ok "refuses a binary that fails attestation, and installs nothing"
else
  bad "refuses a binary that fails attestation, and installs nothing" "$out"
fi

H="$WORK/h5"
mkdir -p "$H"
printf '#!/bin/sh\nexit 0\n' >"$SHIM/gh"
out=$(run "$H")
if [ -L "$H/.tula/bin/tula" ] && case "$out" in *"Provenance was not"*) false ;; *) true ;; esac; then
  ok "installs quietly when attestation passes"
else
  bad "installs quietly when attestation passes" "$out"
fi
rm -f "$SHIM/gh"

H="$WORK/h6"
mkdir -p "$H"
out=$(run "$H" env TULA_REQUIRE_ATTESTATION=1)
if [ ! -e "$H/.tula/bin/tula" ] && case "$out" in *"GitHub CLI is not installed"*) true ;; *) false ;; esac; then
  ok "refuses to install unproven when attestation is required"
else
  bad "refuses to install unproven when attestation is required" "$out"
fi

# Someone who replaced the launcher with their own wrapper keeps it.
H="$WORK/h7"
mkdir -p "$H/.tula/bin"
printf '#!/bin/sh\n# mine\n' >"$H/.tula/bin/tula"
chmod 755 "$H/.tula/bin/tula"
out=$(run "$H")
if grep -q '# mine' "$H/.tula/bin/tula" && case "$out" in *"left your launcher alone"*) true ;; *) false ;; esac; then
  ok "respects a launcher the user replaced"
else
  bad "respects a launcher the user replaced" "$out"
fi

# Rollback is a symlink flip, which only works if old versions stay on disk.
H="$WORK/h8"
mkdir -p "$H"
run "$H" env TULA_VERSION=9.9.9 >/dev/null
FAKE_LATEST=9.9.9 run "$H" >/dev/null
if [ -x "$H/.tula/versions/9.9.9/tula" ] && [ -L "$H/.tula/bin/tula" ]; then
  ok "keeps each version in its own directory"
else
  bad "keeps each version in its own directory"
fi

H="$WORK/h9"
mkdir -p "$H"
out=$(run "$H" env TULA_VERSION=0.0.1)
if [ ! -e "$H/.tula/bin/tula" ] && case "$out" in *"No build of 0.0.1"*) true ;; *) false ;; esac; then
  ok "names the problem when a version has no build"
else
  bad "names the problem when a version has no build" "$out"
fi

# PATH advice is the difference between "installed" and "works".
H="$WORK/h10"
mkdir -p "$H"
out=$(sandbox "$H" env SHELL=/bin/zsh sh "$ROOT/install.sh" 2>&1)
if grep -qs 'tula/bin' "$H/.zshrc" && case "$out" in *".zshrc"*) true ;; *) false ;; esac; then
  ok "puts the launcher on PATH and says which file it edited"
else
  bad "puts the launcher on PATH and says which file it edited" "$out"
fi

# Nothing above may have touched a profile outside the sandbox. This test edits
# shell config, so a leak is silent, permanent and in someone's real home.
leaked=0
for f in "$HOME/.zshrc" "$HOME/.bashrc" "$HOME/.bash_profile" \
  "${ZDOTDIR:-/nonexistent}/.zshrc" "$HOME/.config/fish/config.fish"; do
  [ -f "$f" ] && grep -q "$WORK" "$f" 2>/dev/null && leaked=1
done
[ "$leaked" -eq 0 ] && ok "writes no shell profile outside the sandbox" ||
  bad "writes no shell profile outside the sandbox"

[ -e "$HOME/.tula" ] && bad "creates no install tree outside the sandbox" ||
  ok "creates no install tree outside the sandbox"

echo
echo "  $pass passed, $fail failed"
[ "$fail" -eq 0 ]
