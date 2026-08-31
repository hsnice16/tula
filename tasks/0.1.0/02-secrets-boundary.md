# 02 · Secrets store and the boundary

**Status**: done

## Goal

A credential store the future agent layer cannot reach, with file permissions
enforced rather than documented.

## Acceptance

- Credentials at `~/.config/tula/credentials.json`, dir 700, file 600.
- A file wider than 600 is refused on read, not warned about.
- `TULA_CONFIG_DIR` redirects the store for tests and scratch runs.
- `redact()` exists for log and error paths.
- `scripts/guard.sh` fails if `src/agent/**` ever imports the store.

## Notes

Refusing rather than warning is the point: a group-readable key file on a shared
box is the same failure as no protection at all.
