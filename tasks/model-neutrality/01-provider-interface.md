# 01 · Provider interface

**Status**: planned

## Goal

`src/agent` depends on an interface it defines, not on a vendor SDK it imported.

## Acceptance

- Anthropic becomes one implementation behind that interface, with no caller
  aware of which one is loaded.
- A provider declares what it supports — streaming, tool calling, multi-turn tool
  loops — and a missing capability is said out loud, not worked around quietly.
- Every provider names one pinned host, listed in `SECURITY.md` and reported by
  `doctor`. A base URL read from the environment still cannot redirect the book.
- A custom endpoint is a confirmed act with the host on screen, never a variable
  a shell profile can set.
- Where a provider has its own CLI or keychain, tula delegates to it and holds no
  token. A pasted key is the fallback, not the pattern.

## Notes

`signin.ts` shells out to `ant auth login` so tula never sees an Anthropic token.
That is the rule, not an Anthropic detail: the second-best outcome is a provider
credential in the store under the same mode-600 refusals as a venue key.
