# 10 · Venue reach

Reach past what tula builds itself. Chain coverage is not here — it is 4's
unfinished half rather than new ground, and closes in [7](../open-pieces). The
aggregator is, because what it would add is exposure nobody can be liquidated on,
which makes it reach rather than repair.

What is left is genuinely new: a venue the user adds without waiting for us, and
without the venue having adopted anything in particular. The tiers in 02 follow
what a venue actually is, because a chain needs no authentication and an exchange
needs the part that is genuinely hard.

01 is here rather than in 13 because it costs nothing while the product is
read-only and is a schema migration afterwards. `ROADMAP.md` pulls it forward on
that argument, ahead of the rest of this milestone; 02 and 03 keep their place
behind 8 and 9.

## Tasks

- [01 · The venue handle](01-venue-handle.md) — planned
- [02 · User-added venues](02-user-added-venue.md) — planned
- [03 · MCP as one adapter shape](03-mcp-connector.md) — planned
- [Portfolio aggregator API](../breadth/01-aggregator-api.md) — planned, and needs
  a provider chosen before it can be estimated

## Notes

Aave's MCP server (`https://mcp.aave.com`) wraps AaveKit's GraphQL API, which
carries the same reads and the same transaction-preparing queries against a typed
schema. A tool-discovery layer earns its place for an agent that has no code path;
tula has one, so the API is the better target and 03 is for venues that offer no
such API. Where tula already reads a venue from chain, that stays the default
regardless — a hosted server sees the address it is asked about.
