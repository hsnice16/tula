# 01 · The venue handle

**Status**: planned

## Goal

A `Position` carries the identifier its venue will demand back, verbatim.

## Acceptance

- A new optional field, distinct from `Position.id` — that one is ours,
  synthetic and stable, and `encumbers` points at it.
- Carried verbatim. Never parsed, never assembled, never normalized.
- Never rendered, and it does not cross the hard boundary: it is not a figure and
  the model has no use for it.
- Absent where a venue has no such handle. Absent, not an empty string.
- An opaque handle survives verbatim, base64 tuples included. Aave v4's
  `chain::address::id` is the case this is written against, and it can only be
  exercised once [`breadth/08`](../breadth/08-aave-v4.md) reads V4 — the field
  does not wait for it.

## Notes

Do this while the product is read-only, when it is a field nothing uses yet.
`ROADMAP.md` pulls this task forward on exactly that argument, along with
[`model-neutrality/01`](../model-neutrality/01-provider-interface.md), which
makes the same one; the rest of 10 keeps its place behind 8 and 9.

Aave v4 identifies reserves and positions with opaque base64 `chain::address::id`
tuples and rejects hand-assembled ones, so a transaction can only be built for a
position whose handle survived normalization. That is a property of the API, not
of any one transport. Every connector today builds its own id
(`aave:debt:${asset}`) and keeps nothing from the venue, so the trade diff in 13
could display a position it cannot act on. Adding the field then is a schema change
across every connector in the release that ships execution.
