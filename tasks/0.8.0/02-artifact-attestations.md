# 02 · Artifact attestations

**Status**: done

## Goal

Cryptographic provenance without standing up GPG infrastructure.

## Acceptance

- Every release publishes GitHub artifact attestations, sigstore-backed and keyless.
- `gh attestation verify` documented in the README and SECURITY.md.
- The install script verifies automatically.

## Notes

Chosen over GPG because there is no key to generate, publish, rotate or lose.
Foundry does exactly this; Kraken CLI uses minisign to the same end.
