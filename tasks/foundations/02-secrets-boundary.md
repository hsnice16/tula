# 02 · Secrets store and the boundary

**Status**: done
**Covered by**: `src/secrets/store.test.ts`, `scripts/guard.sh`, `scripts/guard-test.sh`

## Goal

A credential store the future agent layer cannot reach, with file permissions
enforced rather than documented.

## Acceptance

- Credentials at `~/.config/tula/credentials.json`, dir 700, file 600.
- A file wider than 600 is refused on read, not warned about.
- `TULA_CONFIG_DIR` redirects the store for tests and scratch runs.
- **No credential reaches a log, an error, a file, a child process or the agent
  layer.** `redact()` was accepted here for the log and error paths and never
  written, and the property above is what shipped instead — stronger, because a
  helper holds only where somebody remembers to call it, while this holds
  because nothing on the credential path writes one anywhere. `scripts/guard.sh`
  fails the build on a credential-named expression inside a log, a thrown error,
  a serialization, a file write, a child process or an environment assignment,
  in any module that names `ConnectorCredentials` — and on `src/secrets/`
  gaining any way out of the process at all, which is the half the argument
  rests on. The comment above the check states what a grep cannot see.
- `scripts/guard.sh` fails if `src/agent/**` ever imports the store.

## Notes

Refusing rather than warning is the point: a group-readable key file on a shared
box is the same failure as no protection at all.
