# 01 · Portfolio aggregator API

**Status**: planned

## Goal

Cover what is left of the long tail through a single integration rather than one
connector each.

This task once said the tail was narrower than the usual list of protocol names
suggests, on the grounds that stETH, wstETH and sUSDe already arrive priced. They
do not. `src/connectors/wallet.ts` reads the ERC-20s a Token Lists feed names,
and the default feed names none of the liquid staking tokens or the yield-bearing
stables — the connector declares exactly that under `doesNotRead`, and
`src/connectors/wallet.test.ts` holds the gap open with 100 stETH reading as
silence rather than a row.

So Lido and Ethena are missing, and they are missing as a token nobody asked
about rather than as pool math: a broader list answers that half, and no provider
is needed for it. What only a provider answers is positions that are not a token
in the wallet at all, and receipt tokens whose `delta` needs the protocol's own
pool math.

## Acceptance

- One provider chosen from Zerion, Zapper, DeBank Cloud or Alchemy Portfolio.
- Positions land in the same canonical model as hand-built venues.
- Tier-2 positions are visibly labelled as aggregator-sourced.
- A tier-2 position never overrides a tier-1 reading of the same venue.
- The provider's own key, if any, lives in the same secret store under the same rules.

## Notes

Never hand-build these. The two-tier split is what makes breadth survivable.

The API call is the easy part. *A tier-2 position never overrides a tier-1 reading*
is the hard one: an aggregator reporting the same Aave position tula reads directly
must not double-count it. There is precedent in the tree — `src/connectors/wallet.ts`
already excludes Aave receipt tokens for exactly this reason.

The provider choice gates the estimate, and it is a decision about cost and terms
rather than an implementation detail. It also carries a cost nothing else in this
milestone does: an address goes to a third party, which is why the tier-2 label is
a promise to the reader and not bookkeeping.

It sits in **10** rather than **7** because the remainder splits by the only
question tula answers. What is left uncovered *and* liquidatable — Morpho,
Compound, Spark — is hand-built by the policy in `ROADMAP.md`, and an aggregator
could not give a health factor anyway. What is left uncovered and not
liquidatable moves the net notional and cannot move what breaks first. So this
completes a total; it does not extend the risk engine, and nothing else in 7 is
that.

Until a user asks for it, `open-pieces/01-scope-disclosure` states the gap, which
is the honest thing to do about one you have not decided to close. `TULA_TOKEN_LIST`
is the cheap half-step, and the whole of the answer for the staking and
yield-bearing tokens above: a broader list widens ERC-20 coverage for a config
default, with no key and no address leaving the machine.
