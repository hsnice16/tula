#!/usr/bin/env bash
# Refuses a built binary that carries a debug listener.
#
#   bash scripts/binary-audit.sh dist/tula
#
# `bun build --compile` bundles a dynamic import whenever its specifier resolves
# at build time, so a dependency alone is enough to put an inspect-and-mutate
# channel inside the process that holds every venue key — no import of ours, and
# no runtime flag that turns it off. ink's React DevTools hook did exactly that:
# react-devtools-core is an optional peer, so `bun install` supplied it whether
# this project asked or not, ink's reconciler imported it behind a `DEV=true`
# the bundler does not evaluate, and the released binary carried the backend and
# `ws://localhost:8097` with it. SECURITY.md enumerates every host tula talks to
# and a debug socket is not among them.
#
# What is matched is deliberately narrow. Bun's runtime is inside every compiled
# binary and carries a WebSocket implementation, an inspector and the string
# `react-devtools` — a compiled hello-world has all three — so anything general
# enough to catch "a socket" catches every build there is. Each pattern below is
# absent from a bun binary that bundles an empty program, which is what makes a
# hit mean something.
set -uo pipefail

BINARY=${1:-dist/tula}

[ -f "$BINARY" ] || {
  echo "binary-audit: $BINARY does not exist; build it first" >&2
  exit 1
}

fail=0
found() {
  echo "AUDIT FAILED: $BINARY carries $1"
  fail=1
}

# -a rather than `strings`, which lives in binutils and is not on every runner.
carries() { grep -qaE -- "$1" "$BINARY"; }

carries 'react-devtools-core' &&
  found "the React DevTools backend (react-devtools-core)"
carries 'connectToDevTools' &&
  found "a React DevTools connection (connectToDevTools)"
carries 'wss?://(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])' &&
  found "a hardcoded local socket URL"

[ $fail -eq 0 ] && echo "binary-audit: $(basename "$BINARY") opens no debug listener"
exit $fail
