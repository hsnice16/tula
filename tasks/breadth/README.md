# 4 · Breadth

Hand-building the long tail is the treadmill that kills aggregators. One
integration for hundreds of protocols, plus the venues that have to be hand-built
because they carry real margin math or a domain nothing else covers — Binance,
Coinbase, Stripe — and the plain token balances every address holds. Circle Mint
was one of them and is not any more: it issues no read-only key.

Prices moved here too: a book is only as complete as the assets it can put a
number against, so the price source became something the user picks.

## Tasks

- [01 · Portfolio aggregator API](01-aggregator-api.md) — planned
- [02 · Binance connector](02-binance-connector.md) — done · spot and margin; futures is written and unreachable
- [03 · Chain coverage](03-chain-coverage.md) — done
- [04 · Stripe connector](04-stripe-connector.md) — done
- [05 · Coinbase and Circle](05-coinbase-and-circle.md) — done · Coinbase shipped; Circle Mint was removed
- [06 · Wallet token balances](06-wallet-tokens.md) — done
- [07 · Switchable price sources](07-price-sources.md) — done
- [08 · Aave V4](08-aave-v4.md) — planned · live on Ethereum, declared unread, and it hides a liquidation
- [09 · Aave depth](09-aave-depth.md) — planned
- [10 · Hyperliquid depth](10-hyperliquid-depth.md) — planned
- [11 · Wallet depth](11-wallet-depth.md) — planned
- [12 · Chain reach](12-chain-reach.md) — planned · the EVM chains outside the three, HyperEVM, Solana
- [13 · Binance depth](13-binance-depth.md) — planned
- [14 · Coinbase depth](14-coinbase-depth.md) — planned
- [15 · Kraken depth](15-kraken-depth.md) — planned
- [16 · Stripe depth](16-stripe-depth.md) — planned

09–16 are one idea split by venue: every area a connector declares it never
asks for, filed where the work would go. A gap with no entry here fails
`src/coverage-plan.test.ts`, which is what stops the list of them growing
faster than the plan for them — it already had, by thirteen.
