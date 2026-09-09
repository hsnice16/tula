# 11 · Model neutrality

The agent layer names what it needs from a model; a provider says what it can do.
The Anthropic client is the shape of what shipped first, not the interface — where
a provider works better in another shape, the interface is what gives way.

Safe to do at all because of the hard boundary: every figure crosses it already
computed and formatted, so a weaker model costs prose, never numbers. The two
things that boundary does not cover — injection resistance and tool-call
reliability — are what the gate in 02 is for, and 02 cannot be written until
[the-shell/09](../the-shell/09-injection-defense.md) lands in 7: its payloads are
the gate's test corpus.

## Tasks

- [01 · Provider interface](01-provider-interface.md) — planned
- [02 · Conformance gate](02-conformance-gate.md) — planned
- [03 · A provider that runs locally](03-local-provider.md) — planned
