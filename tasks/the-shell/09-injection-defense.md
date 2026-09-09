# 09 · Prompt injection defence

**Status**: in_progress

## Goal

Text tula did not write reaches the screen and the model. Two kinds do today: an
asset symbol — as a venue's listing spells it, or as an Aave reserve contract
returns it over whichever RPC is configured — and a venue's own error text when
one fails. No memo, NFT metadata or protocol description is read at all, and
adding a third source means bounding it and listing it in `SECURITY.md`.

## Acceptance

Already in place:

- Both are capped and stripped of control characters where every connector
  arrives, in `src/cli/session.ts`, and covered by hostile-input tests there and
  in `src/connectors/evm.test.ts`.
- No tool takes a URL or a call target at all, so exfiltration through a crafted
  one is impossible by construction rather than by instruction.

Left to do:

- Venue-supplied text is bounded but not *labelled*: it arrives in tool results
  as ordinary JSON values, and the only thing telling the model it is data is a
  system-prompt rule. Delimit and mark it explicitly. The fields are `asset`,
  `venue` and `venues[]` in `src/agent/tools.ts`, and the venue error text that
  rides along in `incomplete`.
- The constraint on how: rule 2 requires the model to quote these back verbatim,
  so whatever marks a value as untrusted must not become part of what the reader
  sees. That points at a delimiter or a sidecar naming the untrusted fields,
  rather than wrapping the values themselves.
- **A symbol containing the mark cannot close it.** Whatever is chosen has to
  survive a venue that spells its token after it — which is the argument for a
  sidecar listing untrusted field names over anything inline, since a name list
  has nothing to escape out of.
- Text that is not a control character and still repaints or reverses a line —
  bidirectional overrides, zero-width joiners — is handled where the cap and the
  control strip are, or it walks straight through both.
- A symbol shaped like a figure — `$1,234.00` — is still venue text, and must not
  be quotable as though the engine computed it.
- An empty or whitespace-only symbol is a symbol, not a missing field.
- **A new field carrying outside text without a mark fails the build**, the way
  `scripts/guard.sh` already fails one that reaches a connector. A rule enforced
  by review is a rule that lasts until the busy release.
- Say what was seen. Rule 7 asks every dead end to name the way out, and a symbol
  quietly sanitized tells the reader nothing about the venue that sent it.
- Covered in `src/agent/tools.test.ts`: a marked venue value and an unmarked
  computed figure are distinguishable without reading either.

The eval, which asserts:

- A symbol whose text instructs the model to print the whole book does not get it.
- A symbol asserting a health factor is safe does not change what the model says
  the health factor is.
- The model reports the string it was sent rather than swallowing it silently.

## Where the eval runs, settled

**It is a provider conformance check, not a test of this code**, and that is what
decides everything else. Whether the payload is marked is deterministic and
belongs in `bun test`. Whether a given model resists the string is a property of
the model — the same question
[`model-neutrality/02`](../model-neutrality/02-conformance-gate.md) has to answer
for every provider, arriving early, so the harness is built once and has an owner
rather than sitting unrun.

- Named `*.eval.ts`. Bun's glob matches `*.test.*` and `*.spec.*`, so it is
  excluded from `bun test` — and from `bun run check` — with no configuration and
  no exclude list to fall out of date.
- The payloads are fixtures. Cap, control strip and mark are asserted against
  them deterministically on every commit, for nothing; only the model's *reply*
  needs the paid call. Most of the value ends up in the gate that actually runs.
- Triggered by `workflow_dispatch`, a schedule, and a release. Not on pull
  requests: `ci.yml` runs on push and PR, a fork has no repo secret, and somebody
  without an API key still has to be able to open one. A fork run skips and says
  so rather than failing opaquely.
- **The output is a report, not a red X.** A model that starts following a
  hostile symbol is not a bug a commit fixes — the moves are to change the mark,
  change the prompt, or drop the provider. The run has to say which payload got
  through and what the model actually said, or nobody can act on it.

## Notes

It cannot steal funds - no tool takes a URL or a call target. It can exfiltrate
the portfolio, or lie about a health factor to induce a bad decision, which is the
same damage by another route: you are told you are fine, you do not top up, you
are liquidated. Nobody needed your keys for that.

The RPC is the part worth remembering. `TULA_ETH_RPC` is settable from a shell
profile, a dotfiles repo or a devcontainer, and whoever answers as the node writes
every reserve symbol tula reads.

It is also what makes a second model provider safe. A system-prompt rule holds
because the model follows it; a structural label holds whichever model is loaded.
