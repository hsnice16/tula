# 12 · Venues as commands

**Status**: done

## Goal

Remove the discovery step. A user should not have to find out which venues exist
and then type a name into a connect command — the venues are in the menu, and
picking one does the right thing.

## Acceptance

- Every venue in the build appears in the `/` menu, connected or not, with its own
  status beside it: position count and freshness, `FAILED — …`, or `not connected`.
- `/<venue>` on an unconnected venue starts the connect flow; on a connected one it
  shows status.
- `/<venue> ` opens a submenu of everything scoped to that venue: `connect`,
  `positions`, `breaks`, `status`, `docs`, `disconnect`. Subcommands that need
  credentials are hidden until it is connected.
- Connecting happens inside the app, with the venue's official links on screen at
  the step where they are needed.
- Secret fields are never echoed; the key-scope check still refuses anything that
  can withdraw.
- `/connect` and `/venues` still run, but are out of the menu — the menu replaced them.

## Notes

Connectors declare their own `fields` and `help` links, so the flow is generic:
Hyperliquid will ask for a public address, not a key, and the same component
handles it without a branch.

The tension worth remembering: venue-first navigation is the habit this product
exists to break. Venues are in the menu as *nouns you act on*, with status inline
so the menu doubles as the overview — the default query path is still
`/exposure` or a plain question, neither of which names a venue.
