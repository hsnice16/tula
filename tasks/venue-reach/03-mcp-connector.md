# 03 · MCP as one adapter shape

**Status**: planned

## Goal

Read a venue whose only programmatic surface is an MCP server — without the model
ever seeing what it returns.

## Acceptance

- The client lives in `src/connectors`. `guard.sh` fails the build if `src/agent`
  imports it.
- One pinned server URL per venue, named in `SECURITY.md` beside every other host.
- tula calls the tools it names. The rest of the server's surface is unreachable
  from anywhere in the tree.
- Responses land in the canonical position model and every figure is recomputed by
  the risk engine.
- Tool descriptions and results are venue text: capped and flattened like a decoded
  symbol or an error string, and read by nobody but the normalizer.
- A rate-limited or failing server prints `INCOMPLETE` and exits non-zero.

## Notes

Last of the three on purpose. MCP exists so a model can discover tools at runtime
and read descriptions to choose between them; a connector needs neither, so below
the boundary the discovery layer is overhead over an HTTP endpoint returning JSON.
Where a venue publishes an API underneath — Aave's server wraps AaveKit's typed
GraphQL — the API is the better target.

The tool count is the argument for naming tools rather than enumerating a
server's. Aave's exposes around forty, `prepare_order`, `submit_signed_order` and
`cancel_order` among them; six are the read and preview surface tula would want.
Keeping the client below the boundary is also what makes a poisoned tool
description inert, since nothing it says reaches a model.
