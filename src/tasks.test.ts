import { describe, expect, test } from 'bun:test'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * `done` in a task file means a test says so.
 *
 * `ROADMAP.md` names the `**Status**:` line as the record of what shipped, and
 * `src/site-claims.test.ts` exists because prose about this product turned out
 * not to be trustworthy — it sweeps the README, SECURITY, ROADMAP, AGENTS, the
 * installer and the site, and none of the task files, which is where the record
 * actually lives. One audit found eight tasks marked `done` with unmet
 * acceptance bullets and four marked `planned` that had already shipped.
 *
 * A status is a claim, and the cheapest way to make a claim checkable is to
 * make it name its evidence. So a `done` task carries one extra line — the test
 * files covering its acceptance — and this sweep fails on a `done` without one,
 * or on one citing a file that is not there. It cannot read whether the test is
 * a good test; what it removes is the failure that actually happened, which is
 * a status nobody had to put anything behind.
 */

const ROOT = 'tasks'

function taskFiles(): string[] {
  const out: string[] = []
  for (const entry of readdirSync(ROOT)) {
    const dir = join(ROOT, entry)
    if (!statSync(dir).isDirectory()) continue
    for (const file of readdirSync(dir)) {
      if (file.endsWith('.md') && file !== 'README.md') out.push(join(dir, file))
    }
  }
  return out.sort()
}

const FILES = taskFiles()

/** The four in `tasks/README.md`, and nothing else. A fifth spelling is a status nobody can filter on. */
const STATUSES = ['done', 'in_progress', 'planned', 'deferred']

interface Task {
  path: string
  /** The bare status word. `done · Ethereum only` is `done`; the qualifier is prose. */
  status: string
  /** Whole status line, qualifier included. */
  stated: string
  /** True where the status says more than the bare word — the "except" half. */
  qualified: boolean
  cites: string[] | null
  /** Acceptance bullets the task itself declares it did not land. */
  unmet: number
}

/**
 * The whole citation, however many lines it is written over.
 *
 * A single-line regex read the first physical line and stopped, so the paths on
 * a wrapped continuation were never existence-checked — silently, and on the two
 * longest lists in the tree, which are the ones most likely to wrap. A citation
 * nobody checks reads as evidence, which is the exact failure the line exists to
 * remove. It runs to the first blank line or the next heading or bullet.
 */
function coveredBy(text: string): string | null {
  const lines = text.split('\n')
  const start = lines.findIndex((line) => /^\*\*Covered by\*\*:/.test(line))
  if (start === -1) return null
  const parts = [(lines[start] as string).replace(/^\*\*Covered by\*\*:/, '')]
  for (const line of lines.slice(start + 1)) {
    const trimmed = line.trim()
    if (trimmed === '' || /^[#*-]/.test(trimmed)) break
    parts.push(line)
  }
  return parts.join(' ')
}

function parse(text: string, path: string): Task {
  const status = /^\*\*Status\*\*:\s*(.+)$/m.exec(text)
  if (!status?.[1]) throw new Error(`${path} has no **Status**: line`)
  const covered = coveredBy(text)
  const stated = status[1].trim()
  const word = (stated.split(/[\s·,]/)[0] ?? '').toLowerCase()
  return {
    path,
    stated,
    status: word,
    qualified: stated.toLowerCase() !== word,
    // Backticked, so a sentence beside the paths cannot be mistaken for one.
    cites: covered === null ? null : [...covered.matchAll(/`([^`]+)`/g)].map((m) => m[1] as string),
    // `**Not met.**` and `**Not met**` alike — the marker is the words, not the
    // punctuation somebody put inside the bold.
    unmet: [...text.matchAll(/\*\*Not met\b/g)].length,
  }
}

const read = (path: string): Task => parse(readFileSync(path, 'utf8'), path)

/**
 * A file that fails when the thing it covers breaks.
 *
 * Any path in the repo, deliberately: the test that proves a task is not always
 * the one sitting beside the module it describes. A cross-command agreement
 * lives in `src/consistency.test.ts`, a coverage gap is held open by the
 * connector test that asserts it is still there, and half the distribution work
 * is proven by a shell script the gate runs. Requiring a sibling `*.test.ts`
 * would push people to write the weaker test in the tidier place.
 *
 * `*.eval.ts` and `*.live.ts` count for the same reason they are named that way:
 * both are outside `bun test` because what they check is a venue's or a model's
 * behaviour rather than this repository's, and a task whose acceptance is exactly
 * that has nowhere truer to point.
 */
const isEvidence = (path: string): boolean => /\.(test\.ts|live\.ts|eval\.ts|sh)$/.test(path)

describe('a task file states one of the four statuses', () => {
  test('there are task files to read at all', () => {
    // Without this the whole sweep passes over an empty list, which is the one
    // way a check on a directory reports clean about nothing.
    expect(FILES.length).toBeGreaterThan(30)
  })

  for (const path of FILES) {
    test(`${path} is not a status nobody can filter on`, () => {
      expect({ path, status: read(path).status }).toEqual({ path, status: expect.any(String) })
      expect(STATUSES).toContain(read(path).status)
    })
  }
})

describe('done names the tests that hold it', () => {
  const done = FILES.map(read).filter((t) => t.status === 'done')

  test('the convention covers more than a couple of files', () => {
    expect(done.length).toBeGreaterThan(10)
  })

  for (const task of done) {
    test(`${task.path} says which tests cover its acceptance`, () => {
      // The failure this prevents: "done" written by somebody who believed it,
      // with nothing that would notice when it stopped being true.
      expect({ path: task.path, cites: task.cites }).not.toEqual({
        path: task.path,
        cites: null,
      })
      expect(task.cites?.length ?? 0).toBeGreaterThan(0)
    })

    for (const cited of task.cites ?? []) {
      test(`${task.path} cites ${cited}, which is there and is a check`, () => {
        // A citation that rots is worse than none: it reads as evidence.
        expect({ cited, exists: existsSync(cited) }).toEqual({ cited, exists: true })
        expect({ cited, evidence: isEvidence(cited) }).toEqual({ cited, evidence: true })
      })
    }
  }
})

describe('a bare done means every bullet landed', () => {
  /**
   * The state that produced the eight false `done`s is not a lie — it is work
   * that landed with one bullet short and a status nobody went back to. So the
   * bullet says so in the acceptance list, in a form a sweep can see, and the
   * status is then made to admit it: `done, except <the bullet>`.
   *
   * Only this direction is checkable. Nothing here can tell that an unmarked
   * bullet was met — what it removes is the cheaper failure, which is knowing a
   * gap, writing it down, and leaving the headline saying `done`.
   */
  for (const task of FILES.map(read).filter((t) => t.unmet > 0)) {
    test(`${task.path} declares ${task.unmet} unmet bullet(s), so its status says so`, () => {
      expect({ path: task.path, stated: task.stated, qualified: task.qualified }).toEqual({
        path: task.path,
        stated: task.stated,
        qualified: true,
      })
    })
  }

  test('the rule fires on a task hiding a gap, whether or not one is open today', () => {
    // The loop above passes over an empty list once every declared gap has
    // closed, so the mechanism is exercised against a document rather than
    // against the tree. Asserting the tree still holds one would be a check
    // that fails on the day the last bullet lands — rewarding a `**Not met.**`
    // left behind over the work that removed it.
    const hiding = parse('**Status**: done\n\n- **Not met.** the half that did not land.\n', 'tasks/x/y.md')
    expect({ unmet: hiding.unmet, qualified: hiding.qualified }).toEqual({ unmet: 1, qualified: false })
    const admitted = parse('**Status**: done, except the half that did not land\n', 'tasks/x/y.md')
    expect(admitted.qualified).toBe(true)
  })
})

describe('a citation is not left behind by the status it was written for', () => {
  for (const task of FILES.map(read).filter((t) => t.cites !== null && t.status !== 'done')) {
    test(`${task.path} is ${task.status} and still cites real files`, () => {
      // Partly-done work cites what already holds. The line is allowed here; a
      // path in it that no longer exists is not, whatever the status says.
      for (const cited of task.cites ?? []) {
        expect({ cited, exists: existsSync(cited) && isEvidence(cited) }).toEqual({
          cited,
          exists: true,
        })
      }
    })
  }
})

describe('the convention is written down where the next agent will look', () => {
  test('tasks/README.md documents Covered by beside the statuses', () => {
    const readme = readFileSync(join(ROOT, 'README.md'), 'utf8')
    expect(readme).toContain('**Covered by**')
    for (const status of STATUSES) expect(readme).toContain(`\`${status}\``)
  })
})
