# 04 · npm platform packages

**Status**: done

## Goal

Serve the same native binary through npm, so no channel gets a lesser artifact.

## Acceptance

- `@tula/cli` with per-platform optional dependencies and a postinstall link.
- The installed binary never invokes Node; Node is needed to install, not to run.
- Published from the same release job as every other channel.
