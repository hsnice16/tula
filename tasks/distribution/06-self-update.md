# 06 · Release check and self-update

**Status**: done

## Goal

Tell somebody a newer build exists, and let them take it without leaving the
shell — without ever moving a binary they did not ask to have moved.

## Acceptance

- The check is a GET of the public `/releases/latest` page, resolved off the
  redirect, carrying no version, identifier or query string. Once a day at most,
  and `TULA_NO_UPDATE_CHECK=1` stops it.
- `/update` prints what it would install and where to check it; `/update install`
  is a second word somebody had to mean to type before anything is downloaded.
- The checks are `install.sh`'s, in `install.sh`'s order: an archive absent from
  `checksums.txt`, a hash mismatch, and any version not newer than the running
  one are each refused with nothing installed. `/releases/latest` skips
  pre-releases, so a pre-release build is otherwise offered a silent downgrade.
- Under Homebrew or npm it declines to move at all and names that channel's own
  command, so neither is left reporting a version that is not running.
- Provenance is not checked on this path — that needs the GitHub CLI — and the
  plan `/update` prints says so before the question is answered.
- State lives in `state.json`, never `credentials.json`: writing a timestamp
  must not mean importing the module that reads venue keys.

## Notes

The install script stays the way back. It is the path that checks who built the
binary, and the one that still works when tula will not start.
