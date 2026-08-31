# 05 · Release workflow

**Status**: done · macOS signing is gated on Apple credentials being configured

## Goal

One tag produces every artifact, signed, in one job.

## Acceptance

- Cross-compiled binaries for macOS arm64/x64 and Linux x64/arm64.
- macOS binaries signed and notarized when Apple credentials are configured. An
  unsigned build still installs correctly: neither curl nor Homebrew quarantines
  what it downloads, so the certificate hardens the path rather than gating it.
- Attestations published for every artifact.
- Homebrew and npm updated from the same run.
- The release fails closed if any verification step fails.
