# 04 · connect and positions commands

**Status**: done

## Goal

The two one-shot commands the rest of the product is built on.

## Acceptance

- `connect` never echoes the secret, and Ctrl-C restores the terminal.
- A key that can withdraw is refused with an actionable message.
- Non-TTY with no piped input says so instead of failing validation.
- `positions` renders every position with per-row `as_of`.
- A failing venue prints `INCOMPLETE`, lists the failure, and exits non-zero.

## Notes

Called `connect`, not `login`: a CEX is a scoped key paste and a wallet is just an
address. No password field, no browser flow.
