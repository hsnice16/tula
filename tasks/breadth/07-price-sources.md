# 07 · Switchable price sources

**Status**: done

## Goal

One price source at a time, chosen by the user, with CoinGecko working out of the
box. A single oracle disagreeing with a venue by a few basis points is tolerable;
not being able to change which oracle that is, is not.

## Acceptance

- CoinGecko is active with no configuration and needs no key.
- CoinMarketCap, CryptoCompare and CoinPaprika are selectable alternatives.
- Exactly one is active per process; choosing one replaces the last.
- A source needing a key is keyed in-app, never on a command line.
- Switching rebuilds the oracle and reprices the whole book, never half of it.
- A source that answers but prices nothing says so and names the way back.

## Notes

Keys live under the reserved `__prices` entry, not under the source's own id: a
top-level entry would make `listVenues` offer a price feed as a venue and Session
would try to fetch positions from it. Only the active source's key is kept — a key
for a source nobody is using earns nothing and can still leak.

`ConnectFlow` was narrowed from `Connector` to a `Connectable`, because a price
source has no positions and inventing a `VenueKind` for it would put a non-venue
in the canonical model.

**Pyth was implemented and then removed.** Hermes now answers `unauthorized` on
both `/v2/updates/price/latest` and the v1 equivalent; only the feed list is still
public. It was the best fit on the merits — perp venues settle against it — but a
source that cannot be verified working must not ship. CoinPaprika replaced it:
keyless, 2000 coins, an explicit market-cap `rank` that settles contested tickers,
and a per-coin `last_updated` so freshness comes from the source's own clock
rather than receipt time.

DefiLlama was considered and dropped: it is keyed by `chain:contract-address`, not
by symbol, so slotting it behind a symbol-keyed `PriceOracle` would have meant
routing through CoinGecko ids — "switch to DefiLlama" would still have called
CoinGecko.
