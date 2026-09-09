# 02 · Policy file

**Status**: planned

## Goal

Max position size, per-venue caps, a daily drawdown circuit breaker, blocked
instruments, and what may execute silently versus what needs a human.

## Acceptance

- Human-readable and diffable.
- Enforced before a trade diff is even offered.
- A breach is refused, not warned about.
- The file itself is outside anything the agent can write.

## Notes

Binance shipped agent trading with no cap on losses, saying that keeping agents in
check is largely up to users. That gap is the reason this exists.
