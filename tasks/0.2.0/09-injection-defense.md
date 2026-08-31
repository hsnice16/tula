# 03 · Prompt injection defence

**Status**: planned

## Goal

Token names, memo fields, NFT metadata and protocol descriptions are
attacker-controlled and flow into context even in a read-only tool.

## Acceptance

- All venue-supplied text is delimited and labelled as untrusted data.
- No tool call target or URL is ever taken from venue-supplied text.
- Test suite includes hostile token names and memo fields.
- Exfiltration through a crafted URL is impossible by construction, not by instruction.

## Notes

It cannot steal funds. It can exfiltrate the portfolio, or lie about a health
factor to induce a bad decision - which is the same damage by another route.
