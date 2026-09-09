# 02 · A credential store that holds a set

**Status**: planned

## Goal

One venue, more than one credential — because one person has more than one wallet.

## Acceptance

- A venue holds an ordered set of credentials rather than one, and `put` adds to
  it rather than replacing it. Order is insertion order and stable across reads,
  so attribution does not shuffle between sessions.
- Every refusal in `src/secrets/store.ts` survives the reshape unchanged: mode
  600 enforced on read, `lstat` rather than `stat`, a config directory nobody
  else may write to, and plain JSON with no encryption implied. The migrating
  write goes through the same temp-and-rename path, so a crash mid-migration
  leaves the old file intact rather than a truncated one.
- Existing files migrate on read, idempotently. Nobody reconnects a venue to keep
  it working, and migrating twice does not double the entries.
- **An older binary meeting a new file refuses loudly.** Reading the new shape as
  absent would render as *not connected* and offer to take a key — a tool asking
  for a credential it already holds is the shape of a phishing page.
- **The same credential twice is refused, not stored twice.** Two entries for one
  address double every position it holds, which is the one error worse than the
  gap this closes.
- Removing one credential leaves the others, and removing the last is the same
  as disconnecting the venue. Removal is by the entry the user named, never by
  position in a list they cannot see.
- Reserved keys — the provider key, the price source — stay reserved, stay
  single, and are still never offered as venues.
- Each entry is nameable, because two addresses are told apart by what they are
  for, not by their first four characters. An unnamed entry still works.
- Positions from each are attributed, so a total can be traced back to which
  wallet contributed it, and so `INCOMPLETE` can say which one failed.
- Covered in `src/secrets/store.test.ts`, beside the refusals it must not disturb.

## Why it is its own task

`src/secrets/store.ts` declares `type Store = Record<string, ConnectorCredentials>`
— one entry per venue id, and `put` replaces. That single line is what stops a
person watching a hot wallet and a cold one, which is an ordinary way to hold
crypto, and it means the headline figure is short by whatever is in the other one.

It is also a file `AGENTS.md` lists under *things to leave alone*, for reasons
that are still right. The task is to change its shape without touching what it
refuses.

## What this does not block

`../breadth/03-chain-coverage.md` reads one address across several chains, which
needs no reshape at all — the note in `../cross-domain/03-watched-addresses.md`
claiming chain coverage "needs the same thing" is wrong and is corrected there.
What does need this is a user whose chains hold different addresses.

