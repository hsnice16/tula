# 08 · Agent loop

**Status**: done
**Covered by**: `src/agent/agent.test.ts`, `src/cli/shell.test.ts`

## Goal

Ask in plain English, over the same vocabulary the structured commands already use.

## Acceptance

- A line matching a known command runs deterministic code; anything else goes to
  the model. **Superseded by [`10-slash-commands`](10-slash-commands.md)**: a
  leading `/` is now the whole rule, and `parseCommand` returns null without one.
- Streaming, so the answer appears as it is produced.
- All tool results for one turn return in a single user message.
- A failing tool returns `is_error`, and the loop continues.
- A refusal surfaces as an actionable message and is not kept in history. The
  whole exchange is rolled back to where it started, not by one entry: after a
  tool round the last entry is the tool results, and dropping only those left a
  `tool_use` with nothing answering it — which the API rejects, so every
  question after the refusal failed too.
- The loop gives up after a bounded number of tool rounds.
- Without an API key the whole product still works; only natural language is unavailable.

## Notes

`claude-opus-5`, adaptive thinking, effort `medium` — this is an interactive
terminal route over pre-computed numbers, where latency is the quality that
matters most.

A manual loop rather than the SDK tool runner: the UI needs per-delta and
per-tool callbacks to render, and it avoids a Zod dependency.
