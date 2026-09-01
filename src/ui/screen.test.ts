import { EventEmitter } from 'node:events'
import { Terminal } from '@xterm/headless'
import { expect, test } from 'bun:test'
import { render } from 'ink'
import { createElement } from 'react'
import { Session } from '../cli/session.js'
import type { PriceOracle } from '../core/prices.js'
import { App } from './app.js'
import { guardResize } from './resize.js'

/**
 * What the user would see, not what we meant to draw.
 *
 * Ink sizes a frame as `str.split('\n').length` and erases that many rows next
 * render — no wrapping accounted for anywhere. So a row that wraps is a row it
 * never erases, and the previous frame survives under the new one. Nothing in
 * the tree can detect that: the bug lives between the bytes we emit and the
 * grid they land on, so the only test that sees it has to own a grid.
 *
 * xterm's emulator is that grid, driven by the same bytes a terminal gets.
 * Writing our own was the mistake this replaces — a model built from the
 * hypothesis it is testing agrees with the hypothesis.
 */

const oracle: PriceOracle = {
  source: 'none',
  quote: async () => null,
  quoteMany: async () => new Map(),
}

interface Screen {
  press(keys: string): Promise<void>
  resize(columns: number, rows: number, waitMs?: number): Promise<void>
  /** Every row the emulator holds, scrollback included. */
  rows(): string[]
  /** Only the rows a user is looking at. */
  visible(): string[]
  stop(): void
}

function stdoutStub(columns: number, rows: number, onWrite: (chunk: string) => void) {
  return Object.assign(new EventEmitter(), {
    columns,
    rows,
    isTTY: true,
    write: (chunk: string) => {
      onWrite(chunk)
      return true
    },
  })
}

/**
 * Ink pulls input on `readable` and `read()`, never on `data`. A stub that only
 * emits `data` swallows every keystroke in silence, and the suite then asserts
 * about an app nobody ever typed into — which is how these tests once passed
 * against a screen full of ghosts.
 */
function stdinStub() {
  const queue: string[] = []
  const stdin = Object.assign(new EventEmitter(), {
    isTTY: true,
    setRawMode: () => {},
    setEncoding: () => {},
    resume: () => {},
    pause: () => {},
    read: () => queue.shift() ?? null,
    ref: () => {},
    unref: () => {},
    type: (keys: string) => {
      queue.push(keys)
      stdin.emit('readable')
    },
  })
  return stdin
}

async function open(columns: number, rows: number): Promise<Screen> {
  const term = new Terminal({ cols: columns, rows, allowProposedApi: true })
  // Everything Ink writes goes to the emulator before anything is asserted, so
  // a pending write can never be mistaken for a frame that was never drawn.
  let pending: Promise<void> = Promise.resolve()
  const write = (chunk: string) => {
    // What the tty line discipline does on the way out (`onlcr`). Feeding the
    // emulator raw would leave every line starting where the last one ended.
    const onlcr = chunk.replace(/(?<!\r)\n/g, '\r\n')
    pending = pending.then(() => new Promise<void>((done) => term.write(onlcr, done)))
  }

  const stdout = stdoutStub(columns, rows, write)
  const stdin = stdinStub()
  // What runApp does, in the order it does it: the extra erase has to be queued
  // ahead of Ink's own, and a harness that skips it is not testing what ships.
  guardResize(stdout as unknown as NodeJS.WriteStream)
  const instance = render(
    createElement(App, {
      session: new Session(new Map(), oracle),
      connectors: new Map(),
      // Not `undefined`: that is what puts the first run into onboarding.
      initialApiKey: '',
      initialVenues: [],
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { stdout: stdout as any, stdin: stdin as any, exitOnCtrlC: false, patchConsole: false },
  )

  const settle = async () => {
    // Ink throttles renders to 30fps and flushes <Static> outside that throttle,
    // so a frame can still be owed several ticks after the keystroke that caused it.
    for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 25))
    await pending
  }

  await settle()
  return {
    async press(keys: string) {
      stdin.type(keys)
      await settle()
    },
    rows: () => {
      const out: string[] = []
      const buffer = term.buffer.active
      for (let y = 0; y < buffer.length; y++) {
        out.push(buffer.getLine(y)?.translateToString(true) ?? '')
      }
      return out
    },
    // Narrowing reflows rows off the top into scrollback before any handler is
    // told the size changed, so a clear can never reach them: they are the one
    // artifact nothing on this side of the terminal can retract. They are also
    // not what anyone is looking at, and the live screen is the claim being made.
    visible: () => {
      const out: string[] = []
      const buffer = term.buffer.active
      for (let y = buffer.baseY; y < buffer.baseY + term.rows; y++) {
        out.push(buffer.getLine(y)?.translateToString(true) ?? '')
      }
      return out
    },
    resize: async (nextColumns: number, nextRows: number, waitMs = 250) => {
      term.resize(nextColumns, nextRows)
      stdout.columns = nextColumns
      stdout.rows = nextRows
      stdout.emit('resize')
      await new Promise((r) => setTimeout(r, waitMs))
      await pending
    },
    stop: () => {
      instance.unmount()
      term.dispose()
    },
  }
}

const isRule = (row: string) => row.trim().startsWith('─'.repeat(10))
const isStatus = (row: string) => /\d+ venues/.test(row)

function ruleRows(screen: Screen) {
  return screen.visible().filter(isRule).length
}

/**
 * The input box is one rule above and one below, and the status line under it is
 * drawn once. A third rule, a second status line, or any other row that appears
 * twice is a frame that outlived the erase meant to take it back.
 *
 * Counting the placeholder was the mistake this replaces. It is only on screen
 * while the input is empty, so it read zero for half these tests; and a ghost is
 * the *top* of the frame before it, which for a transcript of any length is body
 * rows the placeholder count never looked at. Printed on failure because the
 * shape of the leftovers is the diagnosis — which rows survived says how far
 * short the erase ran, and nothing else on hand says that.
 */
function dump(screen: Screen) {
  for (const [at, row] of screen.visible().entries()) console.log(`${String(at).padStart(3)} |${row}`)
}

/** The frame's own shape, which no transcript can account for. */
function expectOneFrame(screen: Screen) {
  const rows = screen.visible().filter((row) => row.trim())
  const rules = rows.filter(isRule).length
  const status = rows.filter(isStatus).length
  if (rules !== 2 || status !== 1) dump(screen)
  expect({ rules, status }).toEqual({ rules: 2, status: 1 })
}

function expectOneInputBox(screen: Screen) {
  const body = screen.visible().filter((row) => row.trim() && !isRule(row))
  // Only sound where the transcript holds no repeat of its own, so the tests
  // that run one command twice on purpose ask for expectOneFrame instead.
  const twice = [...new Set(body.filter((row, at) => body.indexOf(row) !== at))]
  if (twice.length > 0) dump(screen)
  expect(twice).toEqual([])
  expectOneFrame(screen)
}

const WIDTHS = [80, 100, 195, 200]

for (const columns of WIDTHS) {
  test(`the input box is drawn once at ${columns} columns, however often it redraws`, async () => {
    const screen = await open(columns, 33)
    try {
      // Every one of these is a redraw, and a redraw is what leaves a ghost:
      // an erase short by a row survives as the top of the frame before it.
      await screen.press('/help\r')
      await screen.press('hello')
      await screen.press('\x7f\x7f\x7f\x7f\x7f')
      await screen.press('/')
      await screen.press('exp')
      await screen.press('\x1b')

      expectOneInputBox(screen)
    } finally {
      screen.stop()
    }
  })

  test(`no row reaches past ${columns} columns`, async () => {
    const screen = await open(columns, 33)
    try {
      await screen.press('/help\r')
      await screen.press('/')
      // A row wider than the viewport is the mechanism itself, so it is worth
      // failing on directly: by the time it shows up as a ghost the cause is
      // several frames back.
      const wrapped = screen
        .rows()
        .map((row, at) => ({ at, width: row.length }))
        .filter((row) => row.width > columns)
      expect(wrapped).toEqual([])
    } finally {
      screen.stop()
    }
  })
}

test('a menu taller than a short viewport does not leave the frame under it', async () => {
  const screen = await open(195, 20)
  try {
    await screen.press('/help\r')
    await screen.press('/')
    await screen.press('\x1b')
    await screen.press('hello\r')
    expectOneInputBox(screen)
  } finally {
    screen.stop()
  }
})

test('a resize does not stack the frames drawn before it', async () => {
  const screen = await open(195, 33)
  try {
    await screen.press('/help\r')
    await screen.resize(150, 33)
    await screen.press('hello')
    await screen.resize(190, 40)
    await screen.press('\x7f\x7f\x7f\x7f\x7f')
    expectOneInputBox(screen)
  } finally {
    screen.stop()
  }
})

/**
 * The frame a resize catches mid-flight. Ink repaints on the resize event and
 * paints the tree it already has, so anything measured in cells a moment ago is
 * laid into the new terminal — and these assert before React has re-run, which
 * is the only window in which that is visible.
 */
test('narrowing does not leave the frame that was on screen', async () => {
  const screen = await open(195, 33)
  try {
    await screen.press('/help\r')
    await screen.resize(120, 33, 40)
    expectOneInputBox(screen)
  } finally {
    screen.stop()
  }
})

test('narrowing with the command menu open', async () => {
  const screen = await open(195, 33)
  try {
    await screen.press('/help\r')
    await screen.press('/')
    await screen.resize(110, 33, 40)
    await screen.press('\x1b')
    expectOneInputBox(screen)
  } finally {
    screen.stop()
  }
})

test('narrowing with a panel open, then closing it', async () => {
  const screen = await open(195, 33)
  try {
    await screen.press('/help\r')
    await screen.press('\x0b')
    await screen.resize(100, 30, 40)
    await screen.press('\x1b')
    expectOneInputBox(screen)
  } finally {
    screen.stop()
  }
})

test('a drag: every step of a narrowing, one frame apart', async () => {
  const screen = await open(195, 33)
  try {
    await screen.press('/help\r')
    for (let width = 190; width >= 100; width -= 5) await screen.resize(width, 33, 12)
    await screen.resize(100, 33)
    expectOneInputBox(screen)
  } finally {
    screen.stop()
  }
})

test('a hard shrink leaves what it leaves, and then stops', async () => {
  const screen = await open(200, 40)
  try {
    await screen.press('/help\r')
    // Narrowing past half the width reflows rows already on screen into more
    // rows than Ink recorded before the resize, so it erases fewer than it
    // wrote and some of that frame survives. Nothing here can un-reflow rows a
    // terminal has already split. What is ours is that it stops there: the
    // debris is bounded by the one frame the resize caught, and every frame
    // after it erases its own. Growth is the bug; a scar is not.
    await screen.resize(60, 20, 40)
    const scar = ruleRows(screen)
    for (const keys of ['a', 'b', '\x7f', '\x7f', '/', '\x1b']) await screen.press(keys)
    expect(ruleRows(screen)).toBeLessThanOrEqual(scar)
  } finally {
    screen.stop()
  }
})

/**
 * The drag in the bug report: a pane pulled in until the terminal is a dozen
 * columns wide, then pushed back out. Every step is a narrowing that reflows the
 * frame beneath it, so this is the same defect sixty times over — and the width
 * it passes through is far below the floor the arithmetic above clamps to.
 */
test('a pane dragged shut and opened again', async () => {
  const screen = await open(132, 63)
  try {
    await screen.press('/help\r')
    for (let width = 130; width >= 12; width -= 6) await screen.resize(width, 63, 12)
    for (let width = 18; width <= 132; width += 12) await screen.resize(width, 63, 12)
    await screen.resize(132, 63, 400)
    expectOneInputBox(screen)
  } finally {
    screen.stop()
  }
})

/**
 * Clearing the screen is the other erase a reflow cannot outrun, and it is the
 * wrong one: everything above the frame is the transcript, which <Static> wrote
 * once and Ink will never write again. These two say what a clear would cost —
 * the first that the transcript is still on screen, the second that there is
 * still only one of it, which is what a clear that re-emitted to make up for
 * itself would break. A re-emission appends, while the copy that scrolled past
 * the top of the viewport stays where no clear reaches: unbounded growth traded
 * for a bounded ghost.
 */
test('a narrowing keeps the transcript', async () => {
  const screen = await open(132, 63)
  try {
    await screen.press('/help\r')
    await screen.resize(90, 63)
    expect(screen.visible().filter((row) => row.includes('Net exposure per asset'))).toHaveLength(1)
    expectOneInputBox(screen)
  } finally {
    screen.stop()
  }
})

test('a drag does not leave the transcript behind more than once', async () => {
  const screen = await open(195, 63)
  try {
    const written = (needle: string) => screen.rows().filter((row) => row.includes(needle)).length
    for (let at = 0; at < 4; at++) await screen.press('/help\r')
    const before = written('Type / for commands')
    expect(before).toBe(4)
    for (let width = 190; width >= 60; width -= 10) await screen.resize(width, 63, 20)
    for (let width = 70; width <= 195; width += 10) await screen.resize(width, 63, 20)
    await screen.resize(195, 63, 300)
    expect(written('Type / for commands')).toBe(before)
    expectOneFrame(screen)
  } finally {
    screen.stop()
  }
})

/**
 * Widening splits nothing, so there is nothing here to erase — the terminal
 * rejoins the rows it wrapped and the transcript comes back whole on its own.
 * Which is the argument for not redrawing it: a redraw at the narrow width is
 * what would make the wrapping permanent.
 */
test('widening puts the transcript back as it was', async () => {
  const screen = await open(195, 63)
  try {
    await screen.press('/help\r')
    const row = (needle: string) => screen.rows().find((r) => r.includes(needle))?.trim()
    const wide = row('What gets liquidated first, and how far away that is')
    expect(wide).toBeDefined()
    await screen.resize(60, 63)
    await screen.resize(195, 63)
    expect(row('What gets liquidated first, and how far away that is')).toBe(wide)
  } finally {
    screen.stop()
  }
})

/**
 * The drag as a mouse actually sends it: resizes arriving faster than Ink's 30fps
 * repaint, against a transcript tall enough that the frame sits on the last row.
 * Both matter. A frame at the foot of the screen has no room to grow into, so the
 * reflow scrolls the screen to make it, and every row that goes over the top is
 * one no erase can reach afterwards — which is how a correction that only erased
 * could leave the app walking up the screen a row per resize, shedding the
 * transcript behind it.
 */
test('a drag faster than the repaint, against a full screen', async () => {
  const screen = await open(141, 40)
  try {
    const written = () => screen.rows().filter((row) => row.includes('Type / for commands')).length
    for (let at = 0; at < 5; at++) await screen.press('/help\r')
    const before = written()
    expect(before).toBe(5)
    for (let width = 138; width >= 90; width -= 3) await screen.resize(width, 40, 0)
    await screen.resize(90, 40, 400)
    expect(written()).toBe(before)
    expectOneFrame(screen)
    for (let width = 93; width <= 141; width += 3) await screen.resize(width, 40, 0)
    await screen.resize(141, 40, 400)
    expect(written()).toBe(before)
    expectOneFrame(screen)
  } finally {
    screen.stop()
  }
})

/**
 * What the gap looked like: the frame adrift with blank rows between it and the
 * transcript, or below it, depending on which way the rows were lost. A screen
 * with a transcript longer than it has no room for empty rows anywhere.
 */
test('a drag leaves no blank band on a screen that was full', async () => {
  const screen = await open(141, 40)
  try {
    for (let at = 0; at < 5; at++) await screen.press('/help\r')
    for (let width = 138; width >= 90; width -= 3) await screen.resize(width, 40, 0)
    await screen.resize(90, 40, 400)
    const rows = screen.visible()
    const status = rows.findIndex(isStatus)
    expect(status).toBeGreaterThan(0)
    // A blank row between entries is how the transcript is spaced; a run of them
    // is the band. Anything above the status line is transcript or frame.
    let run = 0
    let longest = 0
    for (const row of rows.slice(0, status)) {
      run = row.trim() ? 0 : run + 1
      longest = Math.max(longest, run)
    }
    if (longest > 2) dump(screen)
    expect(longest).toBeLessThanOrEqual(2)
  } finally {
    screen.stop()
  }
})

/**
 * ctrl+o is a mode rather than a pane. The whole argument for it is that what
 * was held back joins the transcript where the question that produced it
 * already is — so this asserts on the live screen, which is the only place a
 * pane and an expansion look different.
 */
test('ctrl+o puts the rest of an entry back where it was', async () => {
  const screen = await open(195, 63)
  try {
    await screen.press('/help\r')
    // Line nineteen of /help, so it is behind the twelve-row preview.
    const rest = () => screen.visible().some((row) => row.includes('/refresh'))
    const asked = () => screen.visible().some((row) => row.includes('❯ /help'))
    expect(rest()).toBe(false)

    await screen.press('\x0f')
    expect(rest()).toBe(true)
    expect(asked()).toBe(true)
    // Nothing on screen says "… more lines" now, so the way back has to be here.
    expect(screen.visible().some((row) => row.includes('ctrl+o to collapse'))).toBe(true)
    expectOneInputBox(screen)

    await screen.press('\x0f')
    expect(rest()).toBe(false)
    expect(asked()).toBe(true)
    expectOneInputBox(screen)
  } finally {
    screen.stop()
  }
})

/**
 * The mode outlives the entry it was turned on for. Nothing re-renders a
 * <Static> child, so this is only true if the flag is read when the next entry
 * is written — which is a different code path from the redraw above.
 */
test('output arriving while ctrl+o is on comes through whole', async () => {
  const screen = await open(195, 63)
  try {
    await screen.press('/help\r')
    await screen.press('\x0f')
    await screen.press('/help\r')
    expect(screen.visible().filter((row) => row.includes('more lines'))).toEqual([])
    // Line nineteen of both answers, so two of them is both arriving whole.
    expect(screen.visible().filter((row) => row.includes('/refresh'))).toHaveLength(2)
  } finally {
    screen.stop()
  }
})

/**
 * The redraw an expansion needs is the one a resize needs, and it appends the
 * same way: without the clear ahead of it the collapsed copy stays above the
 * expanded one, and toggling is how a user would stack a dozen of them.
 */
test('toggling ctrl+o does not leave a copy of the transcript per press', async () => {
  const screen = await open(195, 63)
  try {
    await screen.press('/help\r')
    const written = () => screen.rows().filter((row) => row.includes('Type / for commands')).length
    expect(written()).toBe(1)
    for (let at = 0; at < 6; at++) await screen.press('\x0f')
    expect(written()).toBe(1)
    expectOneInputBox(screen)
  } finally {
    screen.stop()
  }
})
