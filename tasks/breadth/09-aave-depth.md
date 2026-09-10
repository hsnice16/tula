# 09 · Aave depth

**Status**: planned

## Goal

Read the rest of what an Aave account holds, so `NOT READ` on this venue is a
list that shortens rather than a standing shape.

`src/connectors/aave.ts` declares five gaps. [`08`](./08-aave-v4.md) takes the
largest; this takes the other four, three of which hide a liquidation and are
therefore hand-built by the rule `ROADMAP.md` states about the tail.

## Acceptance

- **The Safety Module** — staked AAVE, ABPT and GHO. Each stake contract answers
  `balanceOf`, so it is three addresses in a batch already going out. An
  unstaked balance carries a cooldown; whether that is a `spot` row or an
  `UNAVAILABLE` reason is the question to settle, and
  [`risk-engine/04`](../risk-engine/04-availability.md) already has the column.
- **Isolation mode and its borrow cap.** The ceiling is in bits [212..251] of the
  reserve configuration word `loadReserves` already fetches, and
  `isolationModeTotalDebt` — how much of the ceiling is drawn — is word `[14]` of
  the same `getReserveData` return the connector already slices. So no call is
  added. But decoding the bits closes nothing on its own: it changes no figure
  on any screen, and retiring the declaration for it would shorten `/venues`
  without the reader seeing anything new. The close is the ceiling *and* the
  isolation state derived beside it — a lone collateral bit in the bitmap this
  connector already reads, over a reserve whose ceiling is non-zero — landing as
  headroom on the row.
- **Settle what isolation mode actually hides before closing it.** It is
  declared `hides: 'liquidation'`, and the evidence in this tree does not
  support that. Aave sets isolation state only where exactly one collateral bit
  is set, and `usedAsCollateral` already reads that bitmap per reserve — so
  every other supply is already a `spot` row with no `liquidation` block, and
  `collateralMoveUnder` already weights the single isolated leg alone. If that
  invariant holds against a live isolated account, what is missing is borrow
  headroom rather than a liquidation, and the classification should move with
  the read. Check it rather than assume it either way: a `hides` value is what
  `unrankedVenues()` puts under `breaks`.
- **The eMode category. Done** — `getUserEMode` per market, then that category's
  `getEModeCategoryCollateralConfig` and `getEModeCategoryCollateralBitmap`, and
  the category's threshold published in the reserve's place for a leg inside it.
  Four things it is worth having written down, each measured against the chain
  rather than assumed:
  - **Bits [168..175] are a trap, and were the plan here until they were
    checked.** All six pools run Liquid eMode, where membership is the
    category's collateral bitmap. That field survives and still mirrors
    membership for assets onboarded before the upgrade — so it reads correctly
    on WETH and wstETH, which are the two anybody would spot-check — while every
    asset onboarded since reads zero whatever category it is in. rsETH reads 0
    and is a collateral member of Ethereum Core category 3.
  - **It was worse than a weighting error.** `secures` was gated on the
    reserve's own threshold, and Aave has live reserves at a reserve threshold
    of 0 that are full collateral inside a category at 92-95% — six of them on
    Ethereum Core alone. Those legs were not weighted wrongly, they stopped
    being collateral legs: no liquidation block, and out of the `encumbers` list
    the debt beside them says it is covered by.
  - **Out-of-category collateral is still counted**, at its own reserve rate,
    which is not what the older eMode did. Confirmed on a Base account whose
    stated account threshold of 9299 only reproduces with the out-of-category
    leg counted at 7800; excluding it gives exactly 9300.
  - **Category ids are sparse and run past 48**, so only the account's own is
    fetched. Enumerating them is unbounded and wrong.
- **`getEModeCategoryData` is not the call to make.** It survives on all six
  pools as a legacy shim, and its return is a dynamic struct whose first word is
  an offset rather than a field — `decodeString` cannot be pointed at it either.
  The two collateral views are statically encoded and answer everything.
- **Stable-rate debt**, or the declaration retired with evidence. Word `[9]` of
  `getReserveData` is still a live token address on mainnet, so it reads with
  one more `balanceOf`. But Aave disabled stable-rate borrowing, and a column
  that is always zero is worse than no column: confirm against the live markets
  in `scripts/conformance.live.ts`, and if nothing can carry a balance, drop the
  gap rather than build for it. **Retiring a declaration is a finding, not a
  shortcut — it needs the check that proves it, in the file that reruns.**
- Every chain Aave v3 is deployed on that tula does not read is
  [`12`](./12-chain-reach.md)'s, not this file's.
- Each gap closed removes its `doesNotRead` entry in the same change, and the
  test in `aave.test.ts` holding it open goes with it.

## Notes

Do not close a declaration ahead of the connector. The gap is real until it is
read, and `/venues` is what tells the user so. The test holding isolation mode
open asserts on the *keys* `reserveConfig` returns, so a one-line decode trips
it and lets the declaration be retired for work the reader never sees. Take the
bullets above rather than the test's word for what closing means.

Adjacent and not a coverage gap, so it is declared nowhere and belongs here:
**decimals are bits [48..55] of the same configuration word**, and the connector
fetches them again over the wire — roughly ninety extra calls per refresh, on
the venue most likely to be rate-limited, for a figure already in hand. It also
carries a decode failure path the connector goes to some trouble over. Cheaper
than anything above it and it removes code rather than adding it.
