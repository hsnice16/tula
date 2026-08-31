# 01 · Install script

**Status**: done

## Goal

`curl --proto '=https' --tlsv1.2 -LsSf https://hsnice16.github.io/tula/install.sh | sh`

## Acceptance

- Hardened curl flags: no HTTP downgrade on redirect, TLS floor, fail on HTTP error.
- Verifies the artifact attestation before installing, and refuses on failure.
- Versioned install directory plus a symlink launcher, so rollback is a symlink flip.
- A user-replaced launcher is respected, not clobbered.
- A pinned-version URL path exists for reproducible CI installs.
