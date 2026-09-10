# 01 · Install script

**Status**: done
**Covered by**: `scripts/install-test.sh`, `src/site-claims.test.ts`

## Goal

`curl --proto '=https' --tlsv1.2 -LsSf https://usetu.la/install.sh | sh`

## Acceptance

- Hardened curl flags: no HTTP downgrade on redirect, TLS floor, fail on HTTP error.
- Verifies the artifact attestation before installing, and refuses a failed one.
  Where `gh` is missing or not signed in it installs and names which of the two
  was the reason; `TULA_REQUIRE_ATTESTATION` is what makes it a gate.
- Versioned install directory plus a symlink launcher, so rollback is a symlink flip.
- A user-replaced launcher is respected, not clobbered.
- A pinned-version URL path exists for reproducible CI installs.
