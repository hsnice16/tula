# 01 · Watch mode

**Status**: planned

## Goal

A live-refreshing view of exposure and liquidation distances.

## Acceptance

- `tula watch` refreshes on an interval and renders in place.
- Per-venue freshness is visible at all times; a failing venue is marked, not dropped.
- Refresh interval respects each venue's rate limits.
- Ctrl-C exits cleanly and restores the terminal.

## Notes

This is where Ink earns its place - a live-updating view is what it is good at,
unlike the question-and-answer loop of the shell.
