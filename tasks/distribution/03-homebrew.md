# 03 · Homebrew formula

**Status**: done · tap, not homebrew-core; core needs a notable public release first

## Goal

Second channel, and the one most users will actually use.

## Acceptance

- `brew install hsnice16/tap/tula`. The bare `brew install tula` needs
  homebrew-core, which wants a public release with real usage behind it, so it
  is a 1.0 follow-up rather than something to claim now.
- Two channels: a stable one that deliberately lags and skips known-bad builds, and `@latest`.
- Channel selected by cask name rather than configuration.

## Notes

A lagging stable channel matters more here than for a coding tool: a bad build
shows someone the wrong liquidation number.
