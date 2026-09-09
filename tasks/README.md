# tasks/

Work breakdown, readable by any agent (Claude Code, Cursor, Codex, Devin, etc.).

Folders are named for their milestone in [`ROADMAP.md`](../ROADMAP.md). None is
named for a version: a version number is chosen when a release is cut, from what
went into it, so a folder claiming one is a folder that will be wrong about which
release its work shipped in.

## Structure

```text
tasks/
  README.md               <- this file
  <theme>/                <- one folder per milestone
    README.md             <- milestone scope
    NN-<slug>.md          <- one task per file, numbered by intended order
```

## Statuses

Each task file carries a `**Status**: ...` line:

- `done` - shipped; the file is a record of what happened.
- `in_progress` - being worked on now.
- `planned` - scheduled for this milestone, not started.
- `deferred` - considered and postponed, with the rationale kept as a future reference.

## How to use in a session

```text
Work on tasks/the-shell/03-interactive-shell.md.
```

The agent reads that task for goal and acceptance criteria, the milestone's
`README.md` for scope, and `AGENTS.md` at the repo root for conventions. When the
task lands, update its status line and add a `CHANGELOG.md` entry.

## Versioning

`0.x` while the read-only risk view is finding its shape. `1.0` when it is complete
and trustworthy without an agent. Milestones: `ROADMAP.md`. Shipped work:
`CHANGELOG.md`. Current version: `src/version.ts`.
