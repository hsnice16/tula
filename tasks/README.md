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
  <theme>/                <- one folder per milestone, except execution/ (13-16)
    README.md             <- milestone scope
    NN-<slug>.md          <- one task per file, numbered by intended order
```

## Statuses

Each task file carries a `**Status**: ...` line:

- `done` - shipped; the file is a record of what happened.
- `in_progress` - being worked on now.
- `planned` - scheduled for this milestone, not started.
- `deferred` - considered and postponed, with the rationale kept as a future reference.

## `done` names its evidence

A `done` task carries one more line, directly under the status:

```text
**Status**: done
**Covered by**: `src/core/risk.test.ts`, `src/consistency.test.ts`
```

Backticked paths, relative to the repo root, and each one is a `*.test.ts`, a
`*.live.ts` or a check script the gate runs — something that fails when the
acceptance above stops being true. `src/tasks.test.ts` sweeps every file here and
fails on a `done` without the line, or on a line naming a file that is not there.

**Any path in the repo counts.** The test that proves a task is often not the one
beside the module it describes: agreement between two commands lives in
`src/consistency.test.ts`, a declared coverage gap is held open by the connector
test asserting the gap is still there, half the distribution work is proven by a
shell script the gate runs, and a venue's own data is re-checked out of band by a
`*.live.ts`. Cite the check that would actually fail. Requiring a sibling
`*.test.ts` would only push people to write a weaker test in a tidier place.

It is one line because a rule that costs more than that is a rule people route
around on the busy release. It cannot tell a good test from a bad one; what it
removes is the thing that actually happened, which is a status nobody had to put
anything behind. One audit found eight tasks marked `done` with unmet acceptance
bullets and four marked `planned` that had already shipped, and the whole of
`src/site-claims.test.ts` exists because prose about this product turned out not
to be trustworthy — it sweeps the README, `SECURITY.md`, `ROADMAP.md`, `AGENTS.md`,
the installer and the site, and none of these files, which is where `ROADMAP.md`
says the record actually lives.

Partly-done work may carry the line too, for the part that already holds. What
it may not carry is a path that has gone.

## A bullet that did not land says so

Most work does not fail; it lands one bullet short. That is the state the eight
false `done`s were in, so it gets a spelling of its own. Mark the bullet in the
acceptance list and qualify the status:

```text
**Status**: done, except telling the reader a symbol was altered

- **Not met.** Say what was seen — to the *reader*. The sidecar tells the model,
  and `src/cli/session.ts` swaps the sanitized symbol in silently.
```

`**Not met.**` in those words, at the head of the bullet, because a grep is the
only thing that finds these across the tree — six files once spelled it six other
ways and were invisible to every sweep but a human read.

`src/tasks.test.ts` fails on a task carrying a `**Not met**` bullet under a bare
`done`. Only that direction is checkable — nothing can tell that an unmarked
bullet was met. What it removes is the cheaper failure, which is knowing about a
gap, writing it down in the body, and leaving the headline saying `done`.

## How to use in a session

```text
Work on tasks/the-shell/03-interactive-shell.md.
```

The agent reads that task for goal and acceptance criteria, the milestone's
`README.md` for scope, and `AGENTS.md` at the repo root for conventions. When the
task lands, update its status line, add the `**Covered by**` line, and add a
`CHANGELOG.md` entry.

## Versioning

`0.x` while the read-only risk view is finding its shape. `1.0` when it is complete
and trustworthy without an agent. Milestones: `ROADMAP.md`. Shipped work:
`CHANGELOG.md`. Current version: `src/version.ts`.
