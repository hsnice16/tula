# 01 · Portfolio aggregator API

**Status**: planned

## Goal

Cover the long tail - Pendle, Ethena, Lido, Morpho, Curve and hundreds more -
through a single integration rather than one connector each.

## Acceptance

- One provider chosen from Zerion, Zapper, DeBank Cloud or Alchemy Portfolio.
- Positions land in the same canonical model as hand-built venues.
- Tier-2 positions are visibly labelled as aggregator-sourced.
- A tier-2 position never overrides a tier-1 reading of the same venue.
- The provider's own key, if any, lives in the same secret store under the same rules.

## Notes

Never hand-build these. The two-tier split is what makes breadth survivable.
