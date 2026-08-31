# 04 · Encumbrance model

**Status**: planned

## Goal

Make `encumbers` real: a debt is meaningless without the collateral backing it, and
margin is meaningless without the position it supports.

## Acceptance

- Aave debt legs link to the collateral legs that secure them.
- Perp margin links to the position it backs.
- Views can show an encumbered group as one unit.
- Free versus encumbered balance is distinguishable per asset.

## Notes

Without this, a user reads a large collateral balance as spendable when it is not.
