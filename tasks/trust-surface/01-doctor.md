# 01 · tula doctor

**Status**: planned

## Goal

A read-only health check that is primarily a *security* check, not diagnostics.

## Acceptance

- Reports whether each stored CEX key is actually query-only, re-probing the venue.
- Reports the config file mode and refuses to pass at anything wider than 600.
- Reports which venues are reachable and how stale each one's data is.
- Reports the binary version and, once attestations ship, whether it verifies.
- Exits non-zero when anything fails, so it is usable in a cron.

## Notes

Modelled on `claude doctor`, but the questions are about credentials rather than
installation health.
