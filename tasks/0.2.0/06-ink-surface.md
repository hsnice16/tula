# 06 · Ink input surface

**Status**: done

## Goal

The front door. Not a bare REPL prompt — a rendered surface with the answer above
and a bordered input below, in the shape of the terminal agents people already use.

## Acceptance

- Bordered input box, output rendered above it, live status line beneath.
- Status shows venue count, position count, oldest data, and whether the model is available.
- Line editing with a visible cursor, plus history on the arrow keys.
- Ctrl-C clears a non-empty line and exits an empty one; Ctrl-D exits.
- A paste that arrives as one chunk does not bury a control character in the line.
- Streaming answers render as they arrive; tool activity shows what is running.

## Notes

The input component is hand-written rather than pulled from a package: it is the
product's front door, and every dependency here is a dependency in a process that
reads exchange keys.

Ink statically imports `react-devtools-core` from a module it only loads when
`DEV=true`, so the compiled binary carries it (+2.3 MB). Marking it external
breaks the binary at startup.
