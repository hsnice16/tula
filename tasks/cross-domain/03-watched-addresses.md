# 03 · Watched addresses

**Status**: done
**Covered by**: `src/cli/connect.test.ts`, `src/cli/shell.test.ts`, `src/ui/screen.test.ts`, `src/cli/oneshot.test.ts`, `src/secrets/store.test.ts`, `src/connectors/keccak.test.ts`

## Goal

Add a public address to watch, distinct from pasting an exchange key.

## Acceptance

- `tula connect hyperliquid` asks for an address, never a key.
- A mixed-case address is checked against its own checksum before it is stored.
  All-lower and all-upper carry no checksum to disagree with and are accepted on
  shape alone, by design (`addressProblem`, `src/connectors/evm.ts`).
- The connect screen never has a field that could accept a seed phrase, at one
  address or at ten. The added steps — the add-or-replace choice, the optional
  name, the confirmation — are all unmasked, and the only masked box on the
  screen is one a connector's own `secret` field earned.
- Multiple addresses per venue are supported. `Session.refresh` walks
  `listCredentials` and fetches once per entry.
- Connecting a second address leaves the first connected, and both sets of
  positions appear, each attributed to the address it came from —
  `Position.account`, stamped from the `StoredCredential` it was read with, and
  only where the venue holds more than one.
- The same address twice is refused. Two spellings of one address — differing
  only in checksum case — are the same address, and storing both double-counts
  every holding in it. The store refuses it; the connect screen shows the
  refusal and goes back to its first question rather than falling over.
- A venue holding several addresses is one venue in `/` and in the menu, not one
  per address.
- One address failing does not take the others down, and `INCOMPLETE` names which
  address went rather than only which venue. The venue id stays the whole of the
  failure line's prefix, because `commands.ts` reads a failure back by it.
- `breaks` says which address holds the position at risk, since the answer is
  useless if you cannot tell which wallet to act on. Every row carries
  `account.label`; the per-row id is namespaced by the account it came from, so
  two addresses holding one asset cannot collide into a single id.
- Disconnecting names the address it is about to forget, and drops only that
  address's positions from the session. `/<venue> disconnect <ref>` takes one;
  bare over a venue holding several it says which ones there are rather than
  guessing; `/forget <venue>` still means all of them and names each.
- Covered in `src/cli/connect.test.ts`, with the book in `src/cli/shell.test.ts`.

## Notes

This is where a phishing template would be created if the UI blurred the two. It
must be obvious which one is being asked for.

Connecting an already-connected venue is the one path that can destroy a
credential without anybody typing a delete, so it goes through the gate the
delete paths go through: the entry named, the venue's name typed out, Enter
never the confirming key — and the question is asked only once the new
credential has verified, so a bad one cannot cost the reader the one on disk.
Unattended (`src/index.ts`, no TTY) the choice is not offered at all: `ask()`
off a terminal reads the pipe, and a run nobody is watching may not delete a
credential, so it adds.
