# 05 · Coinbase and Circle

**Status**: done

## Goal

Cover the two venues a dollar most often sits in when it is not on an exchange or
in a protocol.

## Acceptance

- Coinbase Advanced reads spot and held balances over CDP API keys, with JWT
  authentication — ES256 for EC keys, EdDSA for Ed25519.
- Coinbase scope comes from `key_permissions`, so nothing is `unknown`.
- Circle Mint reads available and unsettled balances; unsettled is its own row.
- Circle's key format is checked before anything leaves the machine.
- Circle's trade and withdraw scope stays `unknown`, and the connect screen says
  so rather than implying a check happened.

## Notes

bun's `node:crypto` throws on `dsaEncoding: 'ieee-p1363'`, so the DER to JOSE
conversion is done by hand. A wrong signature would have surfaced as "Coinbase
rejected your key" — a failure that looks like the user's fault.

A Coinbase CDP signing key is an API credential, not a wallet key. The field is
named `signingKey` for that reason, and because `privateKey` is a term
`scripts/guard.sh` refuses to let into the source at all.

Circle Mint balances are denominated in the fiat currency of the account, so a USD
balance appears as USD. USDC exposure comes from wherever the USDC actually sits —
Kraken, Hyperliquid, Aave — and nets there.
