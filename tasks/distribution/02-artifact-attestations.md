# 02 · Artifact attestations

**Status**: done
**Covered by**: `scripts/install-test.sh`, `src/site-claims.test.ts`, `scripts/guard.sh`

## Goal

Cryptographic provenance without standing up GPG infrastructure.

## Acceptance

- Every release publishes GitHub artifact attestations, sigstore-backed and keyless.
- `gh attestation verify` documented in the README and SECURITY.md.
- The install script verifies automatically where `gh` is present and signed in,
  and says which was missing where it is not. Unproven is not a refusal unless
  `TULA_REQUIRE_ATTESTATION` is set: not signed in is not proof of anything, and
  `gh attestation verify` needs a token even for a public repository.

## Notes

Chosen over GPG because there is no key to generate, publish, rotate or lose.
Foundry does exactly this; Kraken CLI uses minisign to the same end.
