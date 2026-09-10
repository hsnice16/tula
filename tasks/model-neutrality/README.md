# 11 · Model neutrality

The agent layer names what it needs from a model; a provider says what it can do.
The Anthropic client is the shape of what shipped first, not the interface — where
a provider works better in another shape, the interface is what gives way.

Safe to do at all because of the hard boundary: every figure crosses it already
computed and formatted, so a weaker model costs prose, never numbers. The two
things that boundary does not cover — injection resistance and tool-call
reliability — are what the gate in 02 is for. Its test corpus is already there:
[the-shell/09](../the-shell/09-injection-defense.md) shipped the payloads in
`src/agent/fixture.ts` and `src/agent/injection.eval.ts` runs a real model at
them, reporting rather than failing. 02 is what turns that report into a gate,
and what makes it a gate every provider has to pass.

## Tasks

- [01 · Provider interface](01-provider-interface.md) — planned; two rules already hold for Anthropic
- [02 · Conformance gate](02-conformance-gate.md) — planned
- [03 · A provider that runs locally](03-local-provider.md) — planned
