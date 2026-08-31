# 03 · On-chain session keys

**Status**: planned

## Goal

ERC-7715 `wallet_grantPermissions`: a short-lived scoped signer that can only spend
up to X, only to specific contracts, only calling specific functions, only until
expiry.

## Acceptance

- Guardrails enforced on-chain, not by app configuration.
- The agent literally cannot exceed the grant, regardless of bugs or injection.
- Grants are visible and revocable from inside tula.
- Expiry is short by default.

## Notes

Everyone else's agent safety is a config file the agent could ignore, a bug could
bypass, or an injection could rewrite. This is a smart contract.
