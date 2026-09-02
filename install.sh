#!/bin/sh
# tula installer — https://hsnice16.github.io/tula
#
# The install path is part of the security product. Someone running this is
# about to paste keys tied to their net worth into the binary it fetches, so
# every step that could hand them a different binary is checked, and the script
# refuses rather than warns.
#
#   curl --proto '=https' --tlsv1.2 -LsSf https://hsnice16.github.io/tula/install.sh | sh
#
# Environment:
#   TULA_VERSION              install this exact version instead of the latest
#   TULA_INSTALL_DIR          root of the install tree (default ~/.tula)
#   TULA_REQUIRE_ATTESTATION  refuse to install at all unless provenance is proven
#   TULA_NO_MODIFY_PATH       do not touch any shell profile
set -eu

REPO="hsnice16/tula"
SITE="https://hsnice16.github.io/tula"
INSTALL_DIR="${TULA_INSTALL_DIR:-$HOME/.tula}"
BIN_DIR="$INSTALL_DIR/bin"
BROWSE="https://github.com/$REPO/releases"

say() { printf '%s\n' "$*"; }
note() { printf '  %s\n' "$*"; }

# Every failure names the next step. Someone stuck here has money at risk and no
# way to tell a broken download from a hostile one.
die() {
  printf '\nInstall failed: %s\n' "$1" >&2
  shift
  for line in "$@"; do printf '  %s\n' "$line" >&2; done
  exit 1
}

need() {
  command -v "$1" >/dev/null 2>&1 || die "\`$1\` is required and was not found." \
    "Install it and run this again."
}

# --proto '=https' refuses an HTTP downgrade on redirect; -f fails on an HTTP
# error rather than saving the error page as if it were the binary.
fetch() {
  curl --proto '=https' --tlsv1.2 -fsSL --retry 3 --retry-connrefused "$1" -o "$2"
}

need curl
need tar
need uname
need mkdir

# ---------------------------------------------------------------- platform ---

detect_target() {
  os=$(uname -s)
  arch=$(uname -m)
  case "$os" in
    Darwin) os=darwin ;;
    Linux) os=linux ;;
    *) die "tula has no build for $os." \
        "Build from source instead: https://github.com/$REPO" ;;
  esac
  case "$arch" in
    arm64 | aarch64) arch=arm64 ;;
    x86_64 | amd64) arch=x64 ;;
    *) die "tula has no build for $arch." \
        "Build from source instead: https://github.com/$REPO" ;;
  esac
  # Builds link against glibc. musl silently fails at exec time with a message
  # about a missing loader, which reads as a corrupt download rather than an
  # unsupported libc — so it is caught here instead.
  if [ "$os" = linux ] && [ ! -e /lib/ld-linux-x86-64.so.2 ] &&
    [ ! -e /lib/ld-linux-aarch64.so.1 ] && [ ! -e /lib64/ld-linux-x86-64.so.2 ]; then
    die "This looks like a musl system (Alpine); tula's Linux builds need glibc." \
      "Run it in a glibc container, or build from source: https://github.com/$REPO"
  fi
  printf '%s-%s' "$os" "$arch"
}

# Resolved from the release redirect rather than the JSON API, which rate-limits
# unauthenticated callers by IP — an office behind one NAT would see installs
# start failing for no reason they could diagnose.
latest_version() {
  url=$(curl --proto '=https' --tlsv1.2 -fsSL --retry 3 -o /dev/null \
    -w '%{url_effective}' "https://github.com/$REPO/releases/latest") ||
    die "Could not reach GitHub to find the latest version." \
      "Check the network, then try again." \
      "Or name one yourself:  TULA_VERSION=<version> (see $BROWSE)"
  version=${url##*/tag/}
  case "$version" in
    v*) printf '%s' "${version#v}" ;;
    # /releases/latest redirects to the release list rather than to a tag when a
    # repository has published nothing. Suggesting a version to pin here would
    # be a dead end pointing at another dead end: there is none to pin.
    */releases) die "tula has no published releases yet, so there is nothing to install." \
      "Build it from source meanwhile:  https://github.com/$REPO#install" \
      "Releases will appear at:         $BROWSE" ;;
    *) die "GitHub did not name a latest release." \
      "Pick one by hand:  TULA_VERSION=<version> (see $BROWSE)" ;;
  esac
}

# ------------------------------------------------------------------ verify ---

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | cut -d' ' -f1
  elif command -v openssl >/dev/null 2>&1; then
    openssl dgst -sha256 "$1" | sed 's/.*= *//'
  else
    die "No SHA-256 tool found (sha256sum, shasum or openssl)." \
      "Install one; tula will not install an unverified binary."
  fi
}

verify_checksum() {
  archive=$1
  sums=$2
  name=$(basename "$archive")
  expected=$(grep " $name\$" "$sums" | cut -d' ' -f1) || true
  [ -n "$expected" ] || die "$name is not listed in checksums.txt." \
    "Do not use this download. Report it: https://github.com/$REPO/security"
  actual=$(sha256_of "$archive")
  [ "$expected" = "$actual" ] || die "$name does not match its published checksum." \
    "expected $expected" "got      $actual" \
    "Do not use this download. Report it: https://github.com/$REPO/security"
}

# Provenance, not just integrity: the checksum file travels with the artifact,
# so whoever could replace one could replace both. The attestation is signed by
# GitHub's workflow identity and cannot be reissued by anyone holding the files.
verify_attestation() {
  archive=$1
  if ! command -v gh >/dev/null 2>&1; then
    if [ -n "${TULA_REQUIRE_ATTESTATION:-}" ]; then
      die "TULA_REQUIRE_ATTESTATION is set and the GitHub CLI is not installed." \
        "Install it: https://cli.github.com"
    fi
    UNVERIFIED=1
    UNVERIFIED_WHY="the GitHub CLI is not installed"
    return 0
  fi
  # `gh attestation verify` will not call the API without a token, even for a
  # public repository (cli/cli#11803), so an unauthenticated CLI fails exactly
  # as a forged archive does. Not signed in is not proof of anything, so it is
  # treated as the absent CLI above is rather than as the refusal below.
  if ! gh auth status >/dev/null 2>&1; then
    if [ -n "${TULA_REQUIRE_ATTESTATION:-}" ]; then
      die "TULA_REQUIRE_ATTESTATION is set and the GitHub CLI is not signed in." \
        "Sign in and retry:  gh auth login"
    fi
    UNVERIFIED=1
    UNVERIFIED_WHY="the GitHub CLI is not signed in"
    return 0
  fi
  # A failure here is never advisory. A binary that fails its attestation is one
  # somebody other than this repository's release workflow produced.
  gh attestation verify "$archive" --repo "$REPO" >/dev/null 2>&1 ||
    die "$(basename "$archive") failed attestation: it was not built by $REPO." \
      "Do not use this download. Report it: https://github.com/$REPO/security"
  return 0
}

# ----------------------------------------------------------------- install ---

VERSION=${TULA_VERSION:-}
[ -n "$VERSION" ] || VERSION=$(latest_version)
VERSION=${VERSION#v}
TARGET=$(detect_target)
ARCHIVE="tula-v$VERSION-$TARGET.tar.gz"
BASE="https://github.com/$REPO/releases/download/v$VERSION"
UNVERIFIED=
UNVERIFIED_WHY=

say ""
say "tula $VERSION — $TARGET"

TMP=$(mktemp -d 2>/dev/null || mktemp -d -t tula)
trap 'rm -rf "$TMP"' EXIT INT TERM

note "downloading"
fetch "$BASE/$ARCHIVE" "$TMP/$ARCHIVE" ||
  die "No build of $VERSION for $TARGET." \
    "Releases: https://github.com/$REPO/releases"
fetch "$BASE/checksums.txt" "$TMP/checksums.txt" ||
  die "Could not download checksums.txt for $VERSION." \
    "tula will not install a binary it cannot check."

note "checking the download matches its published checksum"
verify_checksum "$TMP/$ARCHIVE" "$TMP/checksums.txt"

note "checking it was built by $REPO"
verify_attestation "$TMP/$ARCHIVE"

VERSION_DIR="$INSTALL_DIR/versions/$VERSION"
mkdir -p "$VERSION_DIR" "$BIN_DIR"
tar -xzf "$TMP/$ARCHIVE" -C "$VERSION_DIR" ||
  die "Could not unpack $ARCHIVE." "The download may be truncated; try again."
[ -f "$VERSION_DIR/tula" ] || die "$ARCHIVE did not contain a tula binary." \
  "Report it: https://github.com/$REPO/issues"
chmod 755 "$VERSION_DIR/tula"

# Every version stays on disk under its own number and the launcher is a symlink,
# so moving between them is a link flip rather than a re-download — including
# backwards, at the moment when a bad build is showing someone a wrong number.
LAUNCHER="$BIN_DIR/tula"
REPLACED=
if [ -e "$LAUNCHER" ] && [ ! -L "$LAUNCHER" ]; then
  # Somebody put their own file here. Overwriting it would discard a wrapper
  # that may be setting TULA_CONFIG_DIR or pinning a version on purpose.
  REPLACED=1
else
  ln -sf "$VERSION_DIR/tula" "$LAUNCHER"
fi

# -------------------------------------------------------------------- path ---

on_path() {
  case ":$PATH:" in *":$BIN_DIR:"*) return 0 ;; *) return 1 ;; esac
}

profile_for_shell() {
  case "${SHELL:-}" in
    */zsh) printf '%s' "${ZDOTDIR:-$HOME}/.zshrc" ;;
    */bash) [ -f "$HOME/.bashrc" ] && printf '%s' "$HOME/.bashrc" ||
      printf '%s' "$HOME/.bash_profile" ;;
    */fish) printf '%s' "$HOME/.config/fish/config.fish" ;;
    *) printf '' ;;
  esac
}

PATH_NOTE=
if ! on_path; then
  profile=$(profile_for_shell)
  if [ -n "${TULA_NO_MODIFY_PATH:-}" ] || [ -z "$profile" ]; then
    PATH_NOTE="add it yourself:  export PATH=\"$BIN_DIR:\$PATH\""
  elif grep -qs 'tula/bin' "$profile" 2>/dev/null; then
    PATH_NOTE="already in $(basename "$profile") — open a new shell"
  else
    mkdir -p "$(dirname "$profile")"
    case "$profile" in
      */config.fish) printf '\n# tula\nfish_add_path "%s"\n' "$BIN_DIR" >>"$profile" ;;
      *) printf '\n# tula\nexport PATH="%s:$PATH"\n' "$BIN_DIR" >>"$profile" ;;
    esac
    PATH_NOTE="added to $(basename "$profile") — open a new shell, or: export PATH=\"$BIN_DIR:\$PATH\""
  fi
fi

# ------------------------------------------------------------------ report ---

say ""
if [ -n "$REPLACED" ]; then
  say "Installed tula $VERSION, and left your launcher alone."
  note "yours:      $LAUNCHER"
  note "this build: $VERSION_DIR/tula"
  note "to switch:  ln -sf \"$VERSION_DIR/tula\" \"$LAUNCHER\""
else
  say "Installed tula $VERSION to $LAUNCHER"
fi

if [ -n "$UNVERIFIED" ]; then
  say ""
  say "Checksum verified. Provenance was not: $UNVERIFIED_WHY,"
  say "so nothing here proved $REPO built this binary. To check that yourself,"
  say "verify the archive — the attestation is over that, not the binary inside:"
  note "curl -fLO $BASE/$ARCHIVE"
  note "gh attestation verify \"$ARCHIVE\" --repo $REPO"
fi

[ -n "$PATH_NOTE" ] && { say ""; note "$PATH_NOTE"; }

say ""
say "  tula          open the shell"
say "  tula --help   every command"
say ""
say "It is read-only: it cannot place an order or move funds, and it never asks"
say "for a seed phrase. What it does with your keys: $SITE/security/"
say ""
