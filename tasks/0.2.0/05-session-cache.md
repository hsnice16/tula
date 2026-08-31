# 05 · Session cache and refresh

**Status**: done

## Goal

Hold fetched positions for the session so queries are instant, without ever
presenting cached numbers as live.

## Acceptance

- Fetch once on shell start, then serve from cache.
- `refresh` refetches; failures degrade loudly and keep the previous data marked stale.
- Age is shown on every view, so cache is visible rather than implied.
- A venue that fails mid-session stays flagged until it succeeds.

## Notes

Never serve cached numbers as live. Freshness is a safety feature, not a detail.
