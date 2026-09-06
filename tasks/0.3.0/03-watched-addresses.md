# 03 · Watched addresses

**Status**: done, except multiple addresses per venue

## Goal

Add a public address to watch, distinct from pasting an exchange key.

## Acceptance

- `tula connect hyperliquid` asks for an address, never a key.
- Addresses are validated for checksum before being stored.
- The connect screen never has a field that could accept a seed phrase.
- Multiple addresses per venue are supported. **Not done** — the credential
  store holds one entry per venue and `put` replaces it. Tracked in
  `tasks/0.6.0/03-chain-coverage.md`, which needs the same thing.

## Notes

This is where a phishing template would be created if the UI blurred the two. It
must be obvious which one is being asked for.
