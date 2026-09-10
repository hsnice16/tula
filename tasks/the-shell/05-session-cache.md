# 05 · Session cache and refresh

**Status**: done
**Covered by**: `src/cli/shell.test.ts`, `src/core/format.test.ts`

## Goal

Hold fetched positions for the session so queries are instant, without ever
presenting cached numbers as live.

## Acceptance

- Fetch once on shell start, then serve from cache.
- `refresh` refetches; failures degrade loudly and keep the previous data marked
  stale. A venue that fails and returns nothing keeps the rows it last returned,
  each carrying the `asOf` it was read with, and `LoadResult.stale` names the
  venue so the note above the table says the rows are the previous read. A venue
  that answered in part keeps nothing: it has fresh rows already, and a previous
  row beside one of them is the same holding twice.
- Age is shown on every view, so cache is visible rather than implied.
- A venue that fails mid-session stays flagged until it succeeds.

## Notes

Never serve cached numbers as live. Freshness is a safety feature, not a detail.
