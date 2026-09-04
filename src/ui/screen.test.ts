import { EventEmitter } from 'node:events'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Anthropic from '@anthropic-ai/sdk'
import { Terminal } from '@xterm/headless'
import { afterAll, beforeAll, expect, test } from 'bun:test'
import { render } from 'ink'
import { createElement } from 'react'
import { Agent } from '../agent/agent.js'
import { fixtureEngine } from '../agent/fixture.js'
import { Session } from '../cli/session.js'
import { APP_VERSION } from '../version.js'
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

/**
 * Every test in this file drives the real app, and a command it runs writes
 * where the real one would — a click on a price source in the menu switched the
 * developer's own stored source, from a test. Only the sign-in test used to
 * isolate itself; the store is out of reach for all of them now.
 */
let sandbox = ''
beforeAll(async () => {
  sandbox = await mkdtemp(join(tmpdir(), 'tula-ui-'))
  process.env['TULA_CONFIG_DIR'] = sandbox
})
afterAll(async () => {
  await rm(sandbox, { recursive: true, force: true })
})

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
  /** What the emulator made of the mouse-tracking requests it was sent. */
  mouseMode(): string
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

interface Options {
  /** `undefined` is what a real first run passes; '' is a session that has one. */
  initialApiKey?: string | undefined
  agent?: Agent
}

async function open(columns: number, rows: number, options: Options = {}): Promise<Screen> {
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
  // A terminal answers some of what is written to it — where its cursor is,
  // which is the only way the app can place an inline block on the screen. The
  // answer comes back on stdin, so the loop has to be closed here or the test
  // is running against a terminal that never replies to anything.
  term.onData((answer) => {
    stdin.type(answer)
  })
  // What runApp does, in the order it does it: the extra erase has to be queued
  // ahead of Ink's own, and a harness that skips it is not testing what ships.
  guardResize(stdout as unknown as NodeJS.WriteStream)
  const instance = render(
    createElement(App, {
      session: new Session(new Map(), oracle),
      connectors: new Map(),
      // Not `undefined` unless a test says so: that is what a first run passes.
      initialApiKey: 'initialApiKey' in options ? options.initialApiKey : '',
      initialVenues: [],
      ...(options.agent ? { agent: options.agent } : {}),
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    {
      stdout: stdout as any,
      stdin: stdin as any,
      exitOnCtrlC: false,
      patchConsole: false,
      // Ink drops its erase sequences where it detects CI, writing every frame
      // one under the last — which is the defect this file exists to catch. The
      // terminal under test is a user's, never the runner's.
      interactive: true,
    },
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
    mouseMode: () => term.modes.mouseTrackingMode,
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

/**
 * Enter ran nothing while the menu was open: it completed, like tab, so every
 * command cost two presses — the first spent closing a menu.
 */
test('enter runs the highlighted command, and tab is what completes it', async () => {
  const screen = await open(195, 33)
  try {
    // Counted over the scrollback: an open menu is tall enough to push what the
    // command printed off the top of a viewport this size.
    const ran = () => screen.rows().filter((row) => row.includes('Type / for commands')).length
    await screen.press('/hel')
    await screen.press('\r')
    expect(ran()).toBe(1)
    expectOneInputBox(screen)

    await screen.press('/hel')
    await screen.press('\t')
    expect(ran()).toBe(1)
    // The row under the top rule is the line being typed on, which is where a
    // completion lands — the echo of the run above it reads the same trimmed.
    const rows = screen.visible()
    expect(rows[rows.findIndex(isRule) + 1]?.trim()).toBe('❯ /help')
  } finally {
    screen.stop()
  }
})

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

/**
 * ctrl+k used to fill the viewport with a panel and nothing else, which pushed
 * the transcript over the top of the screen — where nothing can hand it back.
 * Closing left the status line alone on a blank screen, and the answer you
 * opened the search from was gone for good.
 */
test('ctrl+k floats over the transcript, and closing puts the screen back', async () => {
  const screen = await open(120, 24)
  try {
    await screen.press('/help\r')
    const asked = () => screen.visible().some((row) => row.includes('❯ /help'))
    const answered = () => screen.visible().some((row) => row.includes('your book'))
    expect([asked(), answered()]).toEqual([true, true])

    await screen.press('\x0b')
    // The dialog is a box with rows of transcript still standing either side of
    // it — which is the whole claim, and the one a full-height panel fails.
    const framed = screen.visible().filter((row) => row.includes('│'))
    expect(framed.length).toBeGreaterThan(8)
    expect(framed.some((row) => /\S\s+│/.test(row))).toBe(true)
    expect([asked(), answered()]).toEqual([true, true])
    expect(screen.visible().filter(isStatus)).toHaveLength(1)
    // Nothing above the fold: the frame grew into a cleared screen rather than
    // scrolling to make room, so the backdrop cannot be scrolled off or behind.
    expect(screen.rows()).toHaveLength(24)

    await screen.press('\x1b')
    expect(screen.visible().some((row) => row.includes('│'))).toBe(false)
    expect([asked(), answered()]).toEqual([true, true])
    expectOneInputBox(screen)
  } finally {
    screen.stop()
  }
})

/**
 * The overlay is a copy of the screen with the dialog written over it, and the
 * real transcript is <Static> — emitted once. Every open scrolls that copy in
 * and every close makes Ink reprint what <Static> holds, so a leak here is one
 * more transcript in the buffer per press, growing without bound.
 */
test('opening and closing the palette does not stack copies of the transcript', async () => {
  const screen = await open(120, 24)
  try {
    const written = () => screen.rows().filter((row) => row.includes('Type / for commands')).length
    for (let at = 0; at < 4; at++) await screen.press('/help\r')
    expect(written()).toBe(4)
    for (let at = 0; at < 5; at++) {
      await screen.press('\x0b')
      await screen.press('\x1b')
    }
    expect(written()).toBe(4)
    expectOneFrame(screen)
  } finally {
    screen.stop()
  }
})

/**
 * The copy is what the dialog is laid over, so it has to reach the line you were
 * typing on. Cut to whole entries it stopped up to an entry short, leaving a
 * band of blank rows exactly where the real screen has transcript.
 */
test('the backdrop behind the palette reaches the input box', async () => {
  const screen = await open(120, 30)
  try {
    for (let at = 0; at < 5; at++) await screen.press('/help\r')
    await screen.press('\x0b')
    const rows = screen.visible()
    const rule = rows.findIndex(isRule)
    expect(rule).toBeGreaterThan(0)
    // Every row above the input box is transcript, and the dialog sits in the
    // middle of them: a blank run here is the copy falling short of the frame.
    let run = 0
    let longest = 0
    for (const row of rows.slice(0, rule)) {
      run = row.trim() ? 0 : run + 1
      longest = Math.max(longest, run)
    }
    if (longest > 1) dump(screen)
    expect(longest).toBeLessThanOrEqual(1)
  } finally {
    screen.stop()
  }
})

/**
 * The count read "N more below" off the whole match list rather than off the
 * window, so it never moved as you arrowed down and still promised more at the
 * last row — which reads as a list that does not scroll.
 */
test('the palette count runs out at the bottom of the list', async () => {
  const screen = await open(120, 30)
  try {
    await screen.press('\x0b')
    const footer = () => screen.visible().find((row) => row.includes('esc closes')) ?? ''
    const opened = footer().match(/(\d+) more below/)?.[1]
    expect(opened).toBeDefined()

    for (let at = 0; at < 12; at++) await screen.press('\x1b[B')
    expect(footer().match(/(\d+) more below/)?.[1]).not.toBe(opened)

    // Past the end: the selection clamps to the last entry, so the window is
    // sitting on the bottom of the list however many more of these land.
    for (let at = 0; at < 80; at++) await screen.press('\x1b[B')
    expect(footer()).not.toContain('more below')
  } finally {
    screen.stop()
  }
}, 120_000)

/**
 * Tracking has to be off everywhere else: with it on, the terminal stops
 * handing the mouse to itself, and the transcript is the part people drag over
 * to copy a number out of.
 */
test('the wheel scrolls the palette, and the terminal gets the mouse back', async () => {
  const screen = await open(120, 30)
  try {
    expect(screen.mouseMode()).toBe('none')
    await screen.press('\x0b')
    expect(screen.mouseMode()).toBe('any')

    // One notch, one row. Moving the cursor and letting the window follow it
    // spent the first several notches inside the rows already on screen, which
    // is a list that does not answer the wheel until it suddenly does.
    const heading = () => screen.visible().some((row) => row.includes('your book'))
    expect(heading()).toBe(true)
    await screen.press('\x1b[<65;40;10M')
    expect(heading()).toBe(false)

    // And the bar says where in the list that left us.
    const thumb = () => screen.visible().filter((row) => row.includes('┃')).length
    expect(thumb()).toBeGreaterThan(0)
    for (let at = 0; at < 40; at++) await screen.press('\x1b[<65;40;10M')
    expect(screen.visible().some((row) => row.includes('/refresh'))).toBe(true)

    await screen.press('\x1b')
    expect(screen.mouseMode()).toBe('none')

    // A terminal left in mouse mode by something else still reports, and the
    // report is punctuation: unswallowed it lands on the line being typed.
    await screen.press('\x1b[<65;40;10M')
    expect(screen.visible().some((row) => row.includes('65;40'))).toBe(false)
    expectOneInputBox(screen)
  } finally {
    screen.stop()
  }
}, 120_000)

/**
 * A dialog that can only be driven from the keyboard is half a dialog. The
 * pointer has to reach it the way it reaches any other: the row under it lights
 * up, a click runs that row, and a click on the screen outside is the way out.
 */
test('the palette answers the pointer', async () => {
  const screen = await open(120, 30)
  try {
    await screen.press('\x0b')
    const rowOf = (text: string) => screen.visible().findIndex((row) => row.includes(text))
    const footer = () => screen.visible().find((row) => row.includes('enter ')) ?? ''
    // /shock is the one entry that cannot be run outright, so the footer says
    // which of the two things enter would do — and that names the selection.
    expect(footer()).toContain('enter runs it')

    // 35 is movement with no button held. Terminal coordinates are 1-based.
    const shock = rowOf('/shock')
    await screen.press(`\x1b[<35;30;${shock + 1}M`)
    expect(footer()).toContain('still has to be typed')
    await screen.press(`\x1b[<35;30;${rowOf('/breaks') + 1}M`)
    expect(footer()).toContain('enter runs it')

    // 0 is the left button going down, and the row under it is the one that runs.
    await screen.press(`\x1b[<0;30;${rowOf('/exposure') + 1}M`)
    expect(screen.visible().some((row) => row.includes('❯ /exposure'))).toBe(true)
    expect(screen.mouseMode()).toBe('none')

    // And a click on the screen the dialog is floating over closes it, running
    // nothing — which is what every other dialog does.
    await screen.press('\x0b')
    await screen.press('\x1b[<0;2;2M')
    expect(screen.visible().some((row) => row.includes('esc'))).toBe(false)
    expectOneInputBox(screen)
  } finally {
    screen.stop()
  }
}, 120_000)

/**
 * The `/` menu is part of the frame rather than floating over it, so where it
 * lands depends on where the transcript left the cursor — at the bottom of the
 * screen once the session has filled it, part-way down before that. 45 rows on
 * a fresh session is the second case, and a click that assumed the first would
 * land on a different command than the one under the pointer.
 */
test('the / menu answers the pointer, wherever the frame ended up', async () => {
  const screen = await open(120, 45)
  try {
    await screen.press('/')
    const markedRow = () => screen.visible().findIndex((row) => /❯\s+\/\w/.test(row))
    const rowOf = (text: string) => screen.visible().findIndex((row) => row.includes(text))
    expect(screen.visible()[markedRow()]).toContain('/breaks')

    // 35 is movement with no button held. Terminal coordinates are 1-based.
    const target = rowOf('/coinpaprika')
    await screen.press(`\x1b[<35;10;${target + 1}M`)
    expect(markedRow()).toBe(target)
    expect(screen.visible()[markedRow()]).toContain('/coinpaprika')

    // 0 is the left button going down, and the row under it is the one that
    // runs. A reading command: nothing in this file may run one that writes.
    const exposure = rowOf('/exposure')
    await screen.press(`\x1b[<0;10;${exposure + 1}M`)
    expect(screen.visible().some((row) => row.includes('❯ /exposure'))).toBe(true)
    expect(rowOf('/cryptocompare')).toBe(-1)
    expect(screen.mouseMode()).toBe('none')
    expectOneInputBox(screen)
  } finally {
    screen.stop()
  }
}, 120_000)

test('the wheel scrolls the / menu, and a click away puts it down', async () => {
  // Short enough that the menu cannot draw every command it has.
  const screen = await open(120, 22)
  try {
    await screen.press('/')
    const showing = (text: string) => screen.visible().some((row) => row.includes(text))
    expect([showing('/breaks'), showing('/refresh')]).toEqual([true, false])

    for (let at = 0; at < 6; at++) await screen.press('\x1b[<65;10;10M')
    expect([showing('/breaks'), showing('/refresh')]).toEqual([false, true])

    // Away from the block, which is how any autocomplete is put down. The line
    // it was opened from is untouched.
    await screen.press('\x1b[<0;2;1M')
    expect(showing('/refresh')).toBe(false)
    expect(screen.visible().some((row) => /❯\s+\/$/.test(row.trimEnd()))).toBe(true)
  } finally {
    screen.stop()
  }
}, 120_000)

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

/**
 * The credential screens read two directories: the Anthropic CLI's profile
 * store and tula's own. Both are pointed at temporary ones so the assertion is
 * about a state the test built, and so a run never reads — or writes — the
 * credentials of whoever is running it.
 */
async function credentialEnv({ profile }: { profile: boolean }) {
  const anthropic = await mkdtemp(join(tmpdir(), 'tula-ant-'))
  const store = await mkdtemp(join(tmpdir(), 'tula-store-'))
  await chmod(store, 0o700)
  if (profile) {
    await mkdir(join(anthropic, 'credentials'), { recursive: true })
    await writeFile(join(anthropic, 'credentials', 'default.json'), '{}')
  }
  const saved = { ...process.env }
  process.env['ANTHROPIC_CONFIG_DIR'] = anthropic
  process.env['TULA_CONFIG_DIR'] = store
  delete process.env['ANTHROPIC_API_KEY']
  delete process.env['ANTHROPIC_AUTH_TOKEN']
  return async () => {
    process.env = { ...saved }
    await rm(anthropic, { recursive: true, force: true })
    await rm(store, { recursive: true, force: true })
  }
}

test('a browser sign-in is not asked for again on the next start', async () => {
  const restore = await credentialEnv({ profile: true })
  const screen = await open(100, 33, { initialApiKey: undefined })
  try {
    // The profile is the credential. Asking for one anyway is what the status
    // line beside it contradicts, and what a signed-in user saw every start.
    expect(screen.visible().join('\n')).not.toContain('Sign in with your Anthropic account')
    expectOneFrame(screen)
  } finally {
    screen.stop()
    await restore()
  }
})

test('with no credential anywhere, the first run still asks for one', async () => {
  const restore = await credentialEnv({ profile: false })
  const screen = await open(100, 33, { initialApiKey: undefined })
  try {
    expect(screen.visible().join('\n')).toContain('Sign in with your Anthropic account')
  } finally {
    screen.stop()
    await restore()
  }
})

test('/login names the credential in use rather than starting over', async () => {
  const restore = await credentialEnv({ profile: true })
  const screen = await open(100, 33)
  try {
    await screen.press('/login\r')
    const shown = screen.visible().join('\n')
    expect(shown).toContain('signed in with your Anthropic account')
    // The first-run screen re-announced the product and told a user with venues
    // connected to go connect one.
    expect(shown).not.toContain('Continue without one')
    expect(shown).not.toContain('connect a venue')

    // Leaving puts the shell back with its transcript written once. A panel
    // that returns in place of the whole App unmounts <Static>, and the way
    // back writes every entry again under the copy already on screen.
    await screen.press('\x1b')
    expect(screen.visible().join('\n')).toContain('/login')
    expectOneInputBox(screen)
  } finally {
    screen.stop()
    await restore()
  }
})

const PREAMBLE = "I'll pull the netted position."
const ANSWER = '8.5 ETH, as of noon.'

/**
 * A model that says something, stops to read a tool, and is then held before it
 * can answer. Everything about that pause is invisible from this side — the
 * request is out, the prose is already on screen — so a model still working and
 * one that has hung look identical, and `release` is the only way the frame
 * between them stands still long enough to be asserted on.
 */
function pausingAgent() {
  let release = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const turns = [
    {
      stop_reason: 'tool_use',
      content: [
        { type: 'text', text: PREAMBLE },
        { type: 'tool_use', id: 'tu_1', name: 'get_net_exposure', input: { asset: 'ETH' } },
      ],
    },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: ANSWER }] },
  ] as unknown as Anthropic.Message[]
  let at = 0
  const client = {
    messages: {
      stream() {
        const msg = turns[at++]
        if (!msg) throw new Error('stub ran out of turns')
        // The first request answers; every one after it waits, because a tool
        // round is what puts the answer's own request behind a pause.
        const said = (at > 1 ? gate : Promise.resolve()).then(() => msg)
        return {
          on(event: string, cb: (t: string) => void) {
            if (event === 'text') {
              void said.then((m) => {
                for (const b of m.content) if (b.type === 'text') cb(b.text)
              })
            }
            return this
          },
          finalMessage: () => said,
        }
      },
    },
  }
  return {
    agent: new Agent(fixtureEngine, { client: client as unknown as Anthropic }),
    release: () => release(),
  }
}

const SPINNING = /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/

test('an answer that stops for a tool still says it is working', async () => {
  const { agent, release } = pausingAgent()
  const screen = await open(100, 33, { agent })
  try {
    await screen.press('what is my eth exposure\r')

    // The defect: the row went out with the first token, so the tool round and
    // the request after it ran under a screen that had stopped moving.
    const held = screen.visible()
    const preamble = held.findIndex((row) => row.includes(PREAMBLE))
    expect(preamble).toBeGreaterThan(-1)
    const working = held.slice(preamble).find((row) => SPINNING.test(row))
    if (!working) dump(screen)
    expect(working).toMatch(/(thinking|netting your exposure)/)

    release()
    // Nothing typed: settling is what a press does either side of the keys.
    await screen.press('')
    // One paragraph each, and a blank line between. The deltas carry no seam, so
    // the two turns had been running into each other mid-sentence.
    expect(screen.visible().join('\n')).toContain(`${PREAMBLE}\n\n   ${ANSWER}`)
    // And the row goes when the work does, rather than spinning under a finished
    // answer — which would be the same lie the other way around.
    expect(screen.visible().some((row) => SPINNING.test(row))).toBe(false)
  } finally {
    screen.stop()
  }
})

const BANNER = `tula ${APP_VERSION}`

test('the session opens with a banner, written once', async () => {
  const screen = await open(100, 33)
  try {
    expect(screen.visible().filter((row) => row.trim() === BANNER)).toHaveLength(1)
    // It is a transcript entry, so it scrolls away with the rest rather than
    // being redrawn — and a redraw that reissued it would stack a second copy.
    await screen.press('/help\r')
    await screen.press('/help\r')
    expect(screen.rows().filter((row) => row.trim() === BANNER)).toHaveLength(1)
    expectOneFrame(screen)
  } finally {
    screen.stop()
  }
})

test('/clear takes the transcript off the screen, not just out of the state', async () => {
  const screen = await open(100, 33)
  try {
    await screen.press('/help\r')
    expect(screen.visible().join('\n')).toContain('/breaks')

    // <Static> wrote every row to the terminal once. Emptying the transcript
    // leaves all of them exactly where they were, and adds the row that asked.
    await screen.press('/clear\r')
    const shown = screen.visible().join('\n')
    expect(shown).not.toContain('/breaks')
    expect(shown).not.toContain('/clear')
    expect(shown).toContain(BANNER)
    expectOneInputBox(screen)
  } finally {
    screen.stop()
  }
})

/**
 * The mark is a gutter at the head of the summary, not a prefix on the row: the
 * names are the column being read down, so both they and the summaries beside
 * them have to start where a row with no mark starts them. Colour is the one
 * thing this file cannot see — `translateToString` returns the grid's
 * characters — so what is asserted here is the shape the colour is carried in.
 */
test('a venue mark takes a gutter, and both columns still line up', async () => {
  const screen = await open(195, 33)
  try {
    // `/c` leaves one filter holding both kinds: the price sources, which the
    // menu lists with no venue connected, and `/clear`, which is nobody's brand.
    await screen.press('/c')
    const marked = screen.visible().find((row) => row.includes('/coingecko'))
    const plain = screen.visible().find((row) => row.includes('/clear'))
    if (!marked || !plain) dump(screen)
    expect(marked).toMatch(/● CoinGecko/)
    expect(plain).not.toMatch(/●/)
    expect(plain?.indexOf('/clear')).toBe(marked?.indexOf('/coingecko'))
    // The mark sits in the blank the unmarked row leaves before its summary.
    expect(plain?.indexOf('Clear the screen')).toBe(marked?.indexOf('CoinGecko'))
  } finally {
    screen.stop()
  }
})
