# 11 · First-run onboarding

**Status**: done

## Goal

Ask for the Anthropic key before the first question, not as an error after one.

## Acceptance

- On first run with no key, a welcome screen offers to paste one or continue without.
- The key is not echoed; it is validated for the `sk-ant-` prefix before being accepted.
- It is stored in `~/.config/tula/credentials.json` at mode 600, under a reserved
  key that `listVenues()` never returns.
- `ANTHROPIC_API_KEY` in the environment takes precedence over the stored key.
- A browser sign-in counts as a credential, so someone already signed in is not
  asked again on the next start.
- `/login` names the credential in use and offers to replace it, or to sign out
  of a key tula saved.
- Choosing to continue without one leaves every command working.

## Notes

Same file and same permission rule as venue credentials: one place to protect, one
place to audit. It is still the only credential in the store that is *meant* to
leave the machine, which is why it is stored separately from the venue map rather
than beside it.
