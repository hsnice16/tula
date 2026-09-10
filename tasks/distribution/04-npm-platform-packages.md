# 04 · npm platform packages

**Status**: done
**Covered by**: `src/site-claims.test.ts`, `scripts/guard.sh`

## Goal

Serve the same native binary through npm, so no channel gets a lesser artifact.

## Acceptance

- `@hsnice16/tula` with per-platform optional dependencies and a postinstall that
  copies the native binary over the placeholder launcher. Copied, not linked:
  npm's bin shim already points at that path, and overwriting the target keeps
  the shim valid on the package managers that copy rather than link.
- The installed binary never invokes Node; Node is needed to install, not to run.
- Published by the same release workflow, in its own job after the archives are
  built and attested — as Homebrew is in its own.
