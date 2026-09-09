# 02 · Conformance gate

**Status**: planned

## Goal

A provider earns the menu by passing a suite, rather than by being added to a list.

## Acceptance

- Fixed scenarios over a known book, plus the injection payloads from
  [09-injection-defense](../the-shell/09-injection-defense.md).
- Three failures it has to catch: a figure the model rounded itself, a tool call
  it answered without making, and a venue string it followed as an instruction.
- A provider that fails is not offered. Not offered with a warning — not offered.
- Runs in CI, and is what a new-provider contribution has to pass.

## Notes

`verifyScope` refuses an over-scoped key at connect time instead of documenting
the risk. This is that move, made about a model: the difference between a
guarantee and a sentence in a README is whether code checks it.
