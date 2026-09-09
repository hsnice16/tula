# 03 · Watched addresses

**Status**: done, except multiple addresses per venue

## Goal

Add a public address to watch, distinct from pasting an exchange key.

## Acceptance

- `tula connect hyperliquid` asks for an address, never a key.
- Addresses are validated for checksum before being stored.
- The connect screen never has a field that could accept a seed phrase, at one
  address or at ten.
- Multiple addresses per venue are supported. **Not done** — the credential
  store holds one entry per venue and `put` replaces it
  (`src/secrets/store.ts`). Tracked in
  [`open-pieces/02`](../open-pieces/02-credential-store-set.md).

  Chain coverage does not need it: reading one address across several chains
  changes no credential shape. What needs the reshape is a second address, on
  any chain.
- Connecting a second address leaves the first connected, and both sets of
  positions appear, each attributed to the address it came from.
- The same address twice is refused. Two spellings of one address — differing
  only in checksum case — are the same address, and storing both double-counts
  every holding in it.
- A venue holding several addresses is one venue in `/` and in the menu, not one
  per address.
- One address failing does not take the others down, and `INCOMPLETE` names which
  address went rather than only which venue.
- `breaks` says which address holds the position at risk, since the answer is
  useless if you cannot tell which wallet to act on.
- Disconnecting names the address it is about to forget, and drops only that
  address's positions from the session.
- Covered in `src/cli/connect.test.ts`, with the book in `src/cli/shell.test.ts`.

## Notes

This is where a phishing template would be created if the UI blurred the two. It
must be obvious which one is being asked for.
