# 07 · Risk engine as a tool surface

**Status**: done

## Goal

Expose layer 4 to the model, and nothing below it.

## Acceptance

- Tools: net exposure, positions, what breaks first, run scenario, venue status.
- The agent layer imports a `RiskEngine` interface only — no connector, no secret
  store, no fetch. `scripts/guard.sh` fails the build if that changes.
- Quantities cross the boundary as strings: a float here is a rounding error in
  someone's liquidation distance.
- An unknown price is `null` and says so; an unknown liquidation distance is `null`
  and is documented as not meaning safe.
- Venue status exposes failures so an answer can be qualified.

## Notes

Every number a tool returns was computed by deterministic code before the model
saw it. The model orchestrates and narrates; it does not calculate.
