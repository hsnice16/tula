# 02 · Staleness policy

**Status**: planned — the inheritance rule already shipped; the thresholds have not

## Goal

Define, in one place, when a number is too old to show without shouting.

## Acceptance

- A threshold beyond which a figure renders as stale rather than current.
- A second threshold beyond which it is withheld and the gap named.
- Applies to prices and positions alike.
- The whole-portfolio view inherits the worst contributor. **Shipped** —
  `netExposure` takes the oldest contributor's `asOf` (`src/core/exposure.ts`)
  and the status line reads `Session.stalest()`.

## Notes

Silently serving stale risk is the failure mode that actually hurts someone.
