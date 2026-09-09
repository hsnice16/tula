# 02 · User-added venues

**Status**: planned

## Goal

Someone adds the venue they actually use — a regional exchange, a chain we do not
cover — without waiting for a release, and without the venue having adopted
anything in particular.

## Acceptance

- Three tiers, by what the venue is: a chain or contract needs an address and,
  where it is not standard, an ABI; an exchange needs a manifest; a venue with an
  MCP server needs a URL. Most of the tail is the first two.
- A manifest declares one of a **closed set** of authentication schemes — bearer,
  and HMAC parameterized by what is signed, in what order, encoded how. Not an
  expression language: a manifest that can express anything is audited by nobody.
- A venue outside the closed set is refused with the reason. That limit is real
  and is better said than designed around.
- No user-supplied code runs. The process holds exchange keys.
- Positions from one are visibly marked as third-party sourced, and do not carry
  the authority of a chain read in the same view.
- Never in an execution path. This holds from the day the feature ships, not from
  the day execution does.
- Removable, leaving nothing behind. `doctor` names every added venue and the
  host it talks to.

## Notes

The exchange tier is the one with a design problem, and it is authentication.
`src/connectors/kraken.test.ts` pins Kraken's published signature vector because
drift there reads to a user as a bad key — that is the failure a hand-written
manifest invites, and the closed scheme set is what bounds it. Exchanges cluster
into a few families because they copied each other, so the set can be small.

The execution refusal is written here rather than in 13 because that is the
release where it would quietly go. A manifest pasted from a forum must not be
able to build an order, and the rule is cheapest to keep while nothing can.
