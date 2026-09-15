# 04 · One headline total, meaning the same thing at every venue

**Status**: done
**Covered by**: `src/core/exposure.test.ts`, `src/core/risk.test.ts`, `src/consistency.test.ts`, `src/site-example.test.ts`, `src/connectors/coinbase.test.ts`, `src/connectors/kraken.test.ts`

## Goal

`/exposure` ends on `Net notional`, the sum of `delta × price` over the book.
What a derivatives position adds to it depends on which connector read it:

| Where | Rows for one position | What it adds to the total |
|---|---|---|
| Hyperliquid | the perp's signed size, and `collateral` USDC of `totalRawUsd` | `accountValue` — the cash leg cancels the notional |
| Kraken margin | the base leg and the loan in the quote asset | the position's unrealised profit or loss — the loan cancels the notional |
| Coinbase perps | the perp's signed size; the perp portfolio's cash as a spot row | the cash plus the signed notional |
| Binance futures (unreachable with any key tula stores) | the perp's signed size | the signed notional |
| The front page's book | a Hyperliquid perp of −2 ETH, no cash row | the signed notional |

The same short moves the headline figure by a different amount at each venue,
and the page that argues for the product models Hyperliquid the way the
Hyperliquid connector does not.

## What is standard

Every venue, library and tracker surveyed keeps three things apart:

- **Balance** — cash collateral: Binance Futures' Wallet Balance, Deribit's
  `balance` ("does not include open futures PnL").
- **Equity** — balance plus unrealised PnL: Hyperliquid's `accountValue`,
  Binance's Margin Balance, Bybit's `totalEquity`, OKX's `totalEq`, Kraken
  Futures' Portfolio Value, Deribit's `equity`. ccxt's Hyperliquid balance maps
  USDC `total` to `accountValue`. This is the figure that enters a portfolio
  total and is compared with maintenance margin.
- **Positions** — listed apart, with signed size, notional, entry, mark,
  unrealised PnL and liquidation price.

None of them adds a derivative's notional to a total, and none shows a short's
notional as cash. Net exposure per asset — spot plus signed perp size — is used
by practitioners (Kraken's hedging guide calls spot long plus perp short
delta-neutral) and is kept apart from value.

Sources: the survey behind this milestone; ccxt
`ts/src/hyperliquid.ts` and issue 28093; Hyperliquid's
`trading/margining` and `trading/account-abstraction-modes`; each exchange's
own account-summary API reference.

## Decided before building

- **The label is `Equity`.** It is the word Hyperliquid's own app uses for this
  figure — `account.equity` is "Account Equity", explained as "Balance + Unrealized
  PNL (approximate account value if all positions were closed)", in the en-US
  strings under `https://app.hyperliquid.xyz/assets/` — and the one the API
  references use: Bybit `totalEquity`
  (`https://bybit-exchange.github.io/docs/v5/account/wallet-balance`), OKX `totalEq`
  (`https://www.okx.com/docs-v5/en/#trading-account-rest-api-get-balance`), Deribit
  `equity` (`https://docs.deribit.com/#private-get_account_summary`). Binance
  names the same figure Margin Balance and defines it as Wallet Balance plus
  unrealized PnL
  (`https://www.binance.com/en/blog/futures/what-is-the-available-balance-margin-balance-and-total-balance-on-binance-futures-457299340443288694`).
  Hyperliquid also says "Portfolio Value" inside two ratio explanations; one
  venue's second word does not outweigh the term five use for the field itself.
- **No net-exposure total stays beside it.** The institutional figure is long
  market value minus short market value with cash excluded
  (`https://corporatefinanceinstitute.com/resources/wealth-management/net-exposure`,
  `https://www.investmentnews.com/alternatives/net-exposure-the-long-and-short-of-it/57169`).
  Excluding cash means tula deciding which assets are cash, and
  `src/connectors/symbols.ts` refuses exactly that claim: a bridged or omnichain
  dollar is its own row because filing it as a dollar is a claim about a peg. The
  per-asset `NET` column is the exposure figure, and it is unchanged.
- **How a derivative reaches the total.** A perp carries `equity` on its
  position: its unrealised PnL where the venue states that per position
  (Coinbase's `unrealized_pnl`, documented at
  `https://docs.cdp.coinbase.com/api-reference/advanced-trade-api/rest-api/portfolios/get-portfolio-breakdown`),
  or zero where the venue states it inside a balance row already on the book
  (Hyperliquid's `accountValue`, and the spot balance under unified account and
  portfolio margin). Under a shock it adds `delta × (shocked price − price)` to
  that. A perp whose venue states neither is left out of the total and named
  beside it, as an unpriced asset is — both are a figure missing from one sum,
  and the note that names one names the other.
- **Binance futures stay unstated.** `positionRisk` carries an unrealised profit
  but the futures wallet balance is not read, and the path is unreachable with
  any key tula stores; a total that took the one without the other would be
  short by the wallet. It is named beside the total instead.

## Acceptance

- **The portfolio total is equity**: spot and collateral valued at price, debt
  subtracted, and each derivatives account contributing the equity its venue
  states — never a notional. A perp's notional stays in the per-asset exposure
  rows and leaves the total.
- **Labelled in the venues' own word for it.** `Net value` was renamed to `Net
  notional` because it counted a leveraged perp's whole position; once a perp
  contributes equity, the reason for the rename is gone, and the label is chosen
  from the terms above and stated in `CHANGELOG.md` with that history.
- **Whether a net-exposure total stays beside it** is settled against the
  institutional definition — long notional minus short notional, cash excluded —
  sourced in this file before it is built. A total that mixes cash into
  exposure, as `Net notional` did, is neither figure.
- **Per-asset exposure is unchanged**: `delta` is still spot plus signed perp
  size, and every ETH figure the front page states still holds.
- **Each venue states its equity from its own field:**
  - Hyperliquid, `accountValue` per dex, sourced per account mode as
    [`02`](02-balances-per-account-mode.md) settles;
  - Coinbase, the perp portfolio's balances from the portfolio breakdown, which
    the connector fetches and discards everything of but `perp_positions`;
  - Kraken margin, the pair of rows it already emits, pinned by a test to sum to
    the position's unrealised PnL at the price used;
  - Binance futures, `marginBalance`, on the day a key that reads it can be
    stored.
- **A venue that cannot state its equity makes the total say so**, naming the
  venue — `null` with a reason, per the convention that unknown is a value. A
  signed notional in its place is the defect this task removes.
- `src/consistency.test.ts`: the same short at every derivatives venue moves the
  total by the same amount, and `/exposure`, `/positions`, the one-shot CLI and
  the agent's tools state one total.
- `src/site-example.test.ts`, `site/app/page.tsx` and `site/app/og.png/route.tsx`:
  the book's Hyperliquid short carries the account value the venue would state,
  and the published total is recomputed from the engine, not edited by hand.
- **`shock` moves with it.** `src/core/risk.ts` states the total before and
  after a move, from `portfolioValue`; under an equity total a perp's shocked
  figure is its equity after the move — margin plus the changed unrealised PnL —
  and `src/core/risk.test.ts` pins that a short's shocked contribution is not its
  shocked notional.

## Notes

This is wider than the report that found it, and it is here rather than filed
under breadth for the reason this milestone exists: it was a shipped figure
that meant different things for the same position.
