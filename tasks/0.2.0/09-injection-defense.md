# 09 · Prompt injection defence

**Status**: planned

## Goal

Text tula did not write reaches the screen and the model. Two kinds do today: an
asset symbol — as a venue's listing spells it, or as an Aave reserve contract
returns it over whichever RPC is configured — and a venue's own error text when
one fails. No memo, NFT metadata or protocol description is read at all, and
adding a third source means bounding it and listing it in `SECURITY.md`.

## Acceptance

Already in place:

- Both are capped and stripped of control characters where all seven connectors
  arrive, in `src/cli/session.ts`, and covered by hostile-input tests there and
  in `src/connectors/evm.test.ts`.
- No tool takes a URL or a call target at all, so exfiltration through a crafted
  one is impossible by construction rather than by instruction.

Left to do:

- Venue-supplied text is bounded but not *labelled*: it arrives in tool results
  as ordinary JSON values, and the only thing telling the model it is data is a
  system-prompt rule. Delimit and mark it explicitly.
- An eval that tries to talk the model into acting on a hostile symbol, rather
  than a unit test that only proves the string was trimmed.

## Notes

It cannot steal funds. It can exfiltrate the portfolio, or lie about a health
factor to induce a bad decision - which is the same damage by another route.
