# 8 · Field report

The first outside read of a real account. A tester connected Hyperliquid, did
not share the account, and reported three things: the USDC behind a leveraged
short added to collateral, portfolio-margin accounts wrong, HIP-3 markets
missing — and, as a nice-to-have, completion and vim keys.

Every Hyperliquid item was already known to this repository in some form. The
double count was an audit finding the shipped fix did not remove; the builder
dexes were a declared gap; portfolio margin was a recapture bullet in
[`breadth/10`](../breadth/10-hyperliquid-depth.md). What none of them had was a
test that could fail on the account the tester holds. That is the thing this
milestone adds first.

It is also wider than the report. Reading how each venue presents a
derivatives account turned up a total that means different things for the same
position at different venues, on the front page included.

## Tasks

The figures come before the keys, and within each half the order is the
dependency order.

- [01 · Capture every account mode Hyperliquid has](01-capture-every-account-mode.md) — done, except a capture on a non-USDC dex
- [02 · Balances as the venue states them, in each account mode](02-balances-per-account-mode.md) — done
- [03 · What a portfolio-margin account has borrowed, and what secures it](03-portfolio-margin-borrowing.md) — done
- [04 · One headline total, meaning the same thing at every venue](04-one-headline-total.md) — done
- [05 · Account-wide liquidation, under unified account and portfolio margin](05-account-wide-liquidation.md) — done
- [06 · Builder-deployed perp dexes (HIP-3)](06-builder-dexes.md) — done, except a non-USDC dex position
- [07 · Readline keys on every line somebody types into](07-readline-keys.md) — done
- [08 · History that outlives the session, and ctrl+r](08-saved-history.md) — done
- [09 · Completing arguments, and a suggestion as you type](09-argument-completion.md) — done
- [10 · Vim mode, opt-in](10-vim-mode.md) — done
- [11 · A question that runs over more than one line](11-multi-line-input.md) — done
- [12 · Every key, listed where somebody looks for it](12-keys-reference.md) — done
- [13 · Typing while an answer is still coming](13-type-while-working.md) — done

## The standard each task follows

Where a task changes how something is shown, it follows what the venue itself
shows and what the tools people already use do, cited in the task — not a
reading of what somebody might think a word means. The Hyperliquid tasks quote
the venue's own app and docs; 04 quotes the exchanges, libraries and trackers
surveyed; 07–13 quote the shells and terminal tools the keys come from.

## Done means

Each figure task is accepted by a test over a captured account in the mode it
is about, never over a fixture typed to match the belief. And the milestone is
not closed by the tests alone: the tester is asked to open their account in the
build that ships 02 and say whether the rows match what the venue shows them.
