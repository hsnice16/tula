# 02 · A credential store that holds a set

**Status**: done
**Covered by**: `src/secrets/store.test.ts`, `src/cli/connect.test.ts`, `src/site-claims.test.ts`

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
  for a credential it already holds is the shape of a phishing page. The
  mechanism is `__version: 2` plus handing a list where a credential was
  expected, so the venue fails out loud rather than reading as absent. What runs
  is the shape that decides it: `store.test.ts` pins that a v2 file still lists
  the venue under its own key and holds a list rather than a credential there,
  which is what an old `Record<string, ConnectorCredentials>` lookup hands a
  connector. That the shipped v0.1.3 binary then behaves as described was checked
  by hand once; nothing here spawns an old binary.
- **The same credential twice is refused, not stored twice.** Two entries for one
  address double every position it holds, which is the one error worse than the
  gap this closes.
- Removing one credential leaves the others, and removing the last is the same
  as disconnecting the venue. Removal is by the entry the user named, never by
  position in a list they cannot see. `/<venue> disconnect <ref>` is what calls
  it; `/forget <venue>` is the spelling that still means the whole venue.
- Reserved keys — the provider key, the price source — stay reserved, stay
  single, and are still never offered as venues.
- Each entry is nameable, because two addresses are told apart by what they are
  for, not by their first four characters. An unnamed entry still works. The
  store takes a name and refuses a duplicate one, and the connect flow asks for
  one from the second entry onward — before that there is nothing to tell apart.
  A name is stored flattened to one line and refused rather than truncated where
  it would not fit beside a figure.
- Positions from each are attributed, so a total can be traced back to which
  wallet contributed it, and `INCOMPLETE` says which one failed.
  `src/cli/session.ts` fetches once per entry in `listCredentials` and stamps
  `Position.account` from the entry it read with — only where the venue holds
  more than one, since below that the venue names the account. `get` is left for
  the reserved rows, which are single by definition; nothing that reads a venue
  may call it, because first-entry-only is the whole of how a second wallet
  stayed out of a total.
- Covered in `src/secrets/store.test.ts`, beside the refusals it must not disturb.

## Why it is its own task

`src/secrets/store.ts` declared `type Store = Record<string, ConnectorCredentials>`
— one entry per venue id, and `put` replaced. That single line was what stopped a
person watching a hot wallet and a cold one, which is an ordinary way to hold
crypto, and it meant the headline figure was short by whatever was in the other one.

It is also a file `AGENTS.md` lists under *things to leave alone*, for reasons
that are still right. The task is to change its shape without touching what it
refuses.

## What this does not block

`../breadth/03-chain-coverage.md` reads one address across several chains, which
needs no reshape at all — the note in `../cross-domain/03-watched-addresses.md`
claiming chain coverage "needs the same thing" is wrong and is corrected there.
What does need this is a user whose chains hold different addresses.

