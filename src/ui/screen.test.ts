import { EventEmitter } from 'node:events'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Anthropic from '@anthropic-ai/sdk'
import Decimal from 'decimal.js'
import { Terminal } from '@xterm/headless'
import { homeRelative } from '../core/paths.js'
import { afterAll, beforeAll, expect, test } from 'bun:test'
import { render } from 'ink'
import { createElement } from 'react'
import { Agent } from '../agent/agent.js'
import { fixtureEngine } from '../agent/fixture.js'
import { Session } from '../cli/session.js'
import type { Connector } from '../connectors/types.js'
import { APP_VERSION } from '../version.js'
import type { Position } from '../core/position.js'
import type { PriceOracle } from '../core/prices.js'
import * as secrets from '../secrets/store.js'
import { App } from './app.js'
import { cells } from './wrap.js'
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
  // The app looks for a newer release on mount. These tests are about what the
  // terminal draws, and a live request to GitHub inside them is a suite that
  // fails on a plane and reaches a third party to assert on a grid of cells.
  process.env['TULA_NO_UPDATE_CHECK'] = '1'
})
afterAll(async () => {
  delete process.env['TULA_NO_UPDATE_CHECK']
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
  /**
   * The rows the emulator wrapped, by index. A row that ran past the last
   * column is not a long string here — xterm split it on the way in, and every
   * line it hands back is the viewport's own width — so the split itself is the
   * only trace of the overflow left to assert on.
   */
  wrapped(): number[]
  /** What the emulator made of the mouse-tracking requests it was sent. */
  mouseMode(): string
  /** Whether the app has left. Ctrl+C is the only thing here that ends one. */
  exited(): boolean
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
  /** Most tests need no venue; the ones about the command list need a real one. */
  connectors?: Map<string, Connector>
  /** What `src/index.ts` reads out of the store before the shell opens. */
  initialVenues?: string[]
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
      session: new Session(options.connectors ?? new Map(), oracle),
      connectors: options.connectors ?? new Map(),
      // Not `undefined` unless a test says so: that is what a first run passes.
      initialApiKey: 'initialApiKey' in options ? options.initialApiKey : '',
      initialVenues: options.initialVenues ?? [],
      ...(options.agent ? { agent: options.agent } : {}),
    }),
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

  let left = false
  void instance.waitUntilExit().then(
    () => {
      left = true
    },
    () => {
      left = true
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
    // Scrollback is cleared on a redraw (`3J`), so what `rows()` holds above the
    // viewport is whatever a resize has not reached yet rather than the frame
    // under test. The live screen is the claim being made.
    visible: () => {
      const out: string[] = []
      const buffer = term.buffer.active
      for (let y = buffer.baseY; y < buffer.baseY + term.rows; y++) {
        out.push(buffer.getLine(y)?.translateToString(true) ?? '')
      }
      return out
    },
    wrapped: () => {
      const out: number[] = []
      const buffer = term.buffer.active
      for (let y = 0; y < buffer.length; y++) if (buffer.getLine(y)?.isWrapped) out.push(y)
      return out
    },
    mouseMode: () => term.modes.mouseTrackingMode,
    exited: () => left,
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
// Singular included, because the count is of venues connected and a session
// with one draws `1 venue` — and anchored on the separator that follows it, or
// the REMOVED block's own `1 venue(s)` is read as a second status line.
const isStatus = (row: string) => /\d+ venues?\s+·/.test(row)

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

  test(`no row wraps at ${columns} columns`, async () => {
    const screen = await open(columns, 33)
    try {
      await screen.press('/help\r')
      await screen.press('/')
      // Nothing here can be read off a row's length: the emulator hands back
      // lines of exactly `columns`, having already done the wrap. A wider row
      // is the mechanism itself, so it is worth failing on directly — by the
      // time it shows up as a ghost the cause is several frames back.
      if (screen.wrapped().length > 0) dump(screen)
      expect(screen.wrapped()).toEqual([])
      // And a screen that drew nothing wraps nothing.
      expect(screen.rows().filter((row) => row.includes('Type / for commands'))).toHaveLength(1)
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

test('a hard shrink leaves nothing of the frame it caught', async () => {
  const screen = await open(200, 40)
  try {
    await screen.press('/help\r')
    // Narrowing past half the width reflows rows already on screen into more
    // rows than Ink recorded before the resize, so Ink's own erase runs short
    // and the top of the old frame stays standing. `guardResize` does not try
    // to erase those rows: it clears the screen and the scrollback with it and
    // redraws, ahead of Ink, so there is no debris to bound. Bounding it was
    // what this asked for, and a bound that a single surviving frame satisfies
    // reads as a licence for one.
    await screen.resize(60, 20, 40)
    expectOneInputBox(screen)
    for (const keys of ['a', 'b', '\x7f', '\x7f', '/', '\x1b']) await screen.press(keys)
    expectOneInputBox(screen)
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
 * A redraw has to re-emit the transcript, which <Static> otherwise writes once,
 * so these two hold it to being on screen and to there being one of it. The
 * scrollback clear `resize.ts` pairs with the re-emission is what makes the
 * second true: without `3J` the copy that scrolled past the top of the viewport
 * survives every clear and stacks.
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
 * Widening leaves no ghost and is still owed the redraw: the transcript carries
 * Ink's line breaks rather than the terminal's, so nothing rejoins the rows the
 * narrow width split, and a widened pane would stay wrapped for the width it
 * left.
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

/**
 * A key is pasted, never typed, and the paste that goes wrong is silent: a
 * shell prompt, a truncated clipboard, the account id off the console page.
 * Stored unchecked, the first thing it breaks is the question somebody asked,
 * several screens later, with the sign-in screen long gone — so the shape is
 * checked here, where the paste and the reader are both still present.
 */
test('a paste that is not an Anthropic key is refused at the screen it was pasted on', async () => {
  const restore = await credentialEnv({ profile: false })
  const screen = await open(100, 33, { initialApiKey: undefined })
  try {
    await screen.press('\x1b[B')
    await screen.press('\r')
    expect(screen.visible().join('\n')).toContain('Paste the key')

    await screen.press('ANTHROPIC_API_KEY=\r')
    const refused = screen.visible().join('\n')
    expect(refused).toContain('sk-ant-')
    // Still here, with the reason, rather than through to a shell that will
    // fail on the first question and blame the question.
    expect(refused).toContain('Paste the key')

    await screen.press('sk-ant-api03-notreal\r')
    expect(screen.visible().join('\n')).not.toContain('Paste the key')
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

const BANNER = `tula v${APP_VERSION}`

/** The mark sits in its own column beside the banner, so the name is not alone on its row. */
const bannerRow = (row: string) => row.trimEnd().endsWith(BANNER)

test('the session opens with a banner, written once', async () => {
  const screen = await open(100, 33)
  try {
    expect(screen.visible().filter(bannerRow)).toHaveLength(1)
    // The mark is beside the name, not above it, and the description clears the
    // column it occupies — a wrap that started under it would read as an indent.
    const rows = screen.visible()
    const at = rows.findIndex(bannerRow)
    expect(rows[at]).toMatch(/▄▄▄ +tula/)
    expect(rows[at + 1]).toMatch(/^ +▄▟ {3}▙▄ +Your true exposure/)
    // The mark's last row now shares its line with the working directory, which
    // is the third banner line and the one that made this block as tall as the
    // mark rather than one row shorter than it. Asserted against `homeRelative`
    // rather than a shape: a checkout deep enough to be elided starts the line
    // with `…` instead of `~` or `/`, which made this pass or fail on where the
    // repository happened to be cloned.
    expect(rows[at + 2]).toContain('▄▄▄▄▄▄▄')
    expect(rows[at + 2]?.trimEnd().endsWith(homeRelative(process.cwd()))).toBe(true)
    expect(rows[at]?.indexOf('tula')).toBe(rows[at + 1]?.indexOf('Your') ?? -1)
    // The directory column lines up with the description above it.
    expect(rows[at + 1]?.indexOf('Your')).toBe(
      rows[at + 2]?.indexOf(homeRelative(process.cwd())) ?? -1,
    )
    // It is a transcript entry, so it scrolls away with the rest rather than
    // being redrawn — and a redraw that reissued it would stack a second copy.
    await screen.press('/help\r')
    await screen.press('/help\r')
    expect(screen.rows().filter(bannerRow)).toHaveLength(1)
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

test('a venue whose markets label their own rows still lines its table up', async () => {
  // One connected venue can label rows per market — `aave-etherfi` beside
  // `aave` — which widens the VENUE column past anything a single-word venue
  // produced. At the width most terminals open at, that is the frame most
  // likely to wrap, and a row that wraps is a row Ink never erases.
  const at = new Date()
  const row = (venue: string, asset: string, quantity: string) => ({
    id: `${venue}:collateral:${asset}`,
    venue,
    kind: 'collateral' as const,
    asset,
    quantity: new Decimal(quantity),
    delta: new Decimal(quantity),
    asOf: at,
  })
  const markets: Connector = {
    venue: { id: 'markets', kind: 'lending', name: 'Markets' },
    fields: [{ name: 'address', label: 'Address', secret: false }],
    help: [],
    async verifyScope() {
      return { canRead: true, canTrade: false as const, canWithdraw: false as const }
    },
    async fetchPositions() {
      return [
        row('markets', 'ETH', '12'),
        row('markets-second', 'WSTETH', '2'),
        row('markets-third', 'WEETH', '1.5'),
      ]
    },
  }

  const screen = await open(80, 34, { connectors: new Map([['markets', markets]]) })
  try {
    await screen.press('/markets connect\r')
    await screen.press('0xabc\r')
    await screen.press('/positions\r')
    let rows: string[] = []
    for (let tries = 0; tries < 40; tries++) {
      rows = screen.rows()
      if (rows.some((r) => r.includes('markets-third'))) break
      await new Promise((r) => setTimeout(r, 100))
    }
    const labelled = rows.filter((r) => /markets(-\w+)?\s+collateral/.test(r))
    if (labelled.length < 3) dump(screen)
    expect(labelled).toHaveLength(3)
    // Every row puts `collateral` in the same column, which is what says the
    // table was laid out at one width rather than wrapped into another.
    const starts = new Set(labelled.map((r) => r.indexOf('collateral')))
    expect(starts.size).toBe(1)
    expect(screen.wrapped()).toEqual([])
  } finally {
    screen.stop()
  }
}, 120_000)

test('connecting says what it is doing while the venue is read', async () => {
  // Connecting stores the credential, then reads the venue — seconds of it on a
  // real book. That read used to run with the spinner off, so the screen sat on
  // "Connected" with nothing moving, and the spinner only went up once the work
  // was done and the cache warm.
  const slow: Connector = {
    venue: { id: 'slowvenue', kind: 'wallet', name: 'Slow Venue' },
    fields: [{ name: 'address', label: 'Address', secret: false }],
    help: [],
    async verifyScope() {
      return { canRead: true, canTrade: false as const, canWithdraw: false as const }
    },
    async fetchPositions() {
      await new Promise((r) => setTimeout(r, 1500))
      return []
    },
  }
  const screen = await open(140, 30, { connectors: new Map([['slowvenue', slow]]) })
  try {
    await screen.press('/slowvenue connect\r')
    await screen.press('0xabc\r')
    // Waited for rather than slept past: a fixed delay races the render on a
    // loaded machine, and a gate that fails at random teaches people to re-run
    // it. The read takes 1.5s, so there is room to look several times.
    let rows: string[] = []
    for (let at = 0; at < 20; at++) {
      rows = screen.visible()
      if (rows.some((row) => row.includes('reading slowvenue'))) break
      await new Promise((r) => setTimeout(r, 50))
    }
    // The venue being read, named — not merely a spinner.
    expect(rows.some((row) => row.includes('reading slowvenue'))).toBe(true)
    // And the line is not offering to take input while it works.
    expect(rows.some((row) => row.includes('ask anything'))).toBe(false)
  } finally {
    screen.stop()
  }
}, 120_000)

/**
 * A venue that answers from a public address, which is every venue in this file
 * that needs connecting: a connect flow with a secret field would mask what is
 * typed, and nothing here is testing masking.
 */
function fakeVenue(
  id: string,
  name: string,
  fetchPositions: () => Promise<Position[]>,
): Connector {
  return {
    venue: { id, kind: 'wallet', name },
    fields: [{ name: 'address', label: 'Address', secret: false }],
    help: [],
    async verifyScope() {
      return { canRead: true, canTrade: false as const, canWithdraw: false as const }
    },
    fetchPositions,
  }
}

function holding(venue: string, asset: string, quantity: string): Position {
  return {
    id: `${venue}:spot:${asset}`,
    venue,
    kind: 'spot',
    asset,
    quantity: new Decimal(quantity),
    delta: new Decimal(quantity),
    asOf: new Date(),
  }
}

/** Waits for the transcript to say something, rather than sleeping past it. */
async function until(screen: Screen, want: string, tries = 40): Promise<string[]> {
  let rows = screen.rows()
  for (let at = 0; at < tries; at++) {
    rows = screen.rows()
    if (rows.some((row) => row.includes(want))) return rows
    await new Promise((r) => setTimeout(r, 100))
  }
  return rows
}

/**
 * A credential for a venue this build dropped is still on disk, and the opening
 * screen gave three answers about it at once: the banner called it connected,
 * the status line counted it among the failures, and the venue count left it
 * out — `Connected: circle, …` over `1 failed` over `2 venues`, eight rows above
 * a block saying nothing was asked of it and nothing failed. Removed, failed and
 * never-asked are three different things, and this is the screen they meet on.
 */
/**
 * The one assertion that has to be made against the grid rather than against a
 * string: what a right-to-left override does is reorder the cells a row is
 * painted into, so a test comparing the output to itself would agree with a
 * terminal drawing the row backwards. Read off the emulator, the codepoint is
 * either in the buffer or it is not.
 */
test('a name tula had to clean is accounted for, and never repainted to prove it', async () => {
  const restore = await credentialEnv({ profile: true })
  const OVERRIDE = '\u202e'
  const venue = fakeVenue('node', 'Node Wallet', async () => [
    { ...holding('node', `ET${OVERRIDE}H`, '2'), chain: 'ethereum' as const },
  ])
  await secrets.put('node', { address: '0xabc' })
  const screen = await open(120, 33, {
    connectors: new Map([['node', venue]]),
    initialVenues: await secrets.listVenues(),
  })
  try {
    await screen.press('/positions\r')
    const rows = await until(screen, 'ALTERED —')

    const said = rows.find((row) => row.includes('hidden characters removed')) ?? ''
    expect(said).toContain('node')
    expect(said).toContain('ETH')
    // Rule 7: whoever answers as the node writes every symbol tula reads there.
    expect(rows.some((row) => row.includes('TULA_ETHEREUM_RPC'))).toBe(true)
    // Nothing is missing, so none of the four states that mean something is.
    for (const other of ['INCOMPLETE', 'REMOVED', 'NOT READ']) {
      expect({ other, said: rows.some((row) => row.includes(other)) }).toEqual({ other, said: false })
    }
    expect(rows.every((row) => !row.includes(OVERRIDE))).toBe(true)
  } finally {
    screen.stop()
    await restore()
  }
}, 120_000)

test('a venue this build dropped is neither connected nor failed', async () => {
  // Its own store: the claim is about a screen with exactly two credentials on
  // it, and the sandbox every other test here shares has leftovers of theirs.
  const restore = await credentialEnv({ profile: true })
  const wallet = fakeVenue('kept', 'Kept Wallet', async () => [holding('kept', 'ETH', '2')])
  await secrets.put('kept', { address: '0xabc' })
  await secrets.put('circle', { apiKey: 'not-real' })
  const screen = await open(120, 33, {
    connectors: new Map([['kept', wallet]]),
    initialVenues: await secrets.listVenues(),
  })
  try {
    await screen.press('/exposure\r')
    const rows = await until(screen, 'REMOVED —')

    const banner = rows.find((row) => row.includes('Connected:')) ?? ''
    expect(banner).toContain('kept')
    expect(banner).not.toContain('circle')
    // Named anyway, because the key is still theirs and still on disk — and
    // named with the way out, which is the only thing to do about it.
    const removed = rows.find((row) => row.includes('Removed: circle')) ?? ''
    expect(removed).toContain('/forget circle')

    const status = screen.visible().find(isStatus) ?? ''
    // The count the banner names, and not one more.
    expect(status).toMatch(/\b1 venue\b/)
    expect(status).toContain('1 removed')
    expect(status).not.toContain('failed')
  } finally {
    screen.stop()
    await restore()
  }
}, 120_000)

/**
 * `disconnect` is a row under every connected venue in `/` and a runnable entry
 * in ctrl+k, so arrowing one row past `status` and pressing Enter — or one
 * stray click in the menu band, where tracking is live for as long as the menu
 * is up — used to delete the venue's credential outright. An exchange shows a
 * secret key once, so that is the same cost as losing it.
 */
test('one Enter cannot forget a venue, and a second Enter keeps it', async () => {
  const wallet = fakeVenue('spare', 'Spare Wallet', async () => [])
  const screen = await open(120, 33, { connectors: new Map([['spare', wallet]]) })
  try {
    await screen.press('/spare connect\r')
    await screen.press('0xabc\r')
    await until(screen, 'Connected Spare Wallet')
    expect(await secrets.listVenues()).toContain('spare')

    await screen.press('/spare disconnect\r')
    const asked = await until(screen, 'Forget Spare Wallet?')
    expect(asked.some((row) => row.includes('Forget Spare Wallet?'))).toBe(true)
    // Named, and named as the address it is — there is no key here to lose.
    expect(asked.some((row) => row.includes('0xabc'))).toBe(true)
    expect(await secrets.listVenues()).toContain('spare')

    // The reflex after a press that seemed to do nothing is to press again.
    await screen.press('\r')
    await until(screen, 'nothing was deleted')
    expect(await secrets.listVenues()).toContain('spare')

    // And typing the name is what actually runs it.
    await screen.press('/spare disconnect\r')
    await until(screen, 'Forget Spare Wallet?')
    await screen.press('spare\r')
    await until(screen, 'Forgot')
    expect(await secrets.listVenues()).not.toContain('spare')
  } finally {
    screen.stop()
  }
}, 120_000)

/**
 * The same press, arrived at the way the defect described: down the opened-out
 * rows of a connected venue in the `/` menu, one row past the one meant.
 */
test('arrowing onto disconnect in the menu asks before it deletes anything', async () => {
  const wallet = fakeVenue('spare', 'Spare Wallet', async () => [])
  const screen = await open(120, 33, { connectors: new Map([['spare', wallet]]) })
  try {
    await screen.press('/spare connect\r')
    await screen.press('0xabc\r')
    await until(screen, 'Connected Spare Wallet')

    await screen.press('/spare ')
    await screen.press('disc')
    await screen.press('\r')
    await until(screen, 'Forget Spare Wallet?')
    expect(await secrets.listVenues()).toContain('spare')

    await screen.press('\x1b')
    await until(screen, 'nothing was deleted')
    expect(await secrets.listVenues()).toContain('spare')
    expectOneFrame(screen)
  } finally {
    await secrets.remove('spare')
    screen.stop()
  }
}, 120_000)

/**
 * Connecting a venue that already holds something is the one path where the
 * screen can lose a credential without anybody asking to delete one. Before
 * this it called `secrets.replace`, which was right only for as long as there
 * was no way to add a second — so the question the flow now opens with is the
 * whole of what stops "add my other wallet" from meaning "forget the first".
 */
test('connecting a second address keeps the first, and says which it is adding to', async () => {
  const wallet = fakeVenue('twins', 'Twin Wallet', async () => [])
  const screen = await open(120, 33, { connectors: new Map([['twins', wallet]]) })
  try {
    await screen.press('/twins connect\r')
    await screen.press('0xaaa\r')
    await until(screen, 'Connected Twin Wallet')

    await screen.press('/twins connect\r')
    const asked = await until(screen, 'already holds')
    // What is there, and what each answer does to it. Neither is a default.
    expect(asked.some((row) => row.includes('0xaaa'))).toBe(true)
    expect(asked.some((row) => row.includes('add another address'))).toBe(true)

    await screen.press('a')
    await screen.press('0xbbb\r')
    // A name, because from two entries on a handle is the only way to say which
    // one a figure came from — and it is optional, never a required field.
    const named = await until(screen, 'Name for this address')
    expect(named.some((row) => row.includes('optional'))).toBe(true)
    await screen.press('cold\r')
    await until(screen, 'Connected Twin Wallet')

    const held = await secrets.listCredentials('twins')
    expect(held.map((e) => e.credentials['address'])).toEqual(['0xaaa', '0xbbb'])
    expect(held.map((e) => e.name)).toEqual([undefined, 'cold'])
    expectOneFrame(screen)
  } finally {
    await secrets.remove('twins')
    screen.stop()
  }
}, 120_000)

/**
 * The gate is for deletions, and only for deletions. A venue holding two
 * addresses answers a bare `disconnect` by asking which — so putting the
 * confirmation in front of that made somebody type a venue's name to agree to
 * a deletion that was never going to happen, and the next thing a gate like
 * that teaches is to type through it faster.
 */
test('a disconnect that will ask which address does not ask to confirm one first', async () => {
  const wallet = fakeVenue('pair', 'Pair Wallet', async () => [])
  const screen = await open(120, 33, { connectors: new Map([['pair', wallet]]) })
  try {
    await screen.press('/pair connect\r')
    await screen.press('0xaaa\r')
    await until(screen, 'Connected Pair Wallet')
    await screen.press('/pair connect\r')
    await until(screen, 'already holds')
    await screen.press('a')
    await screen.press('0xbbb\r')
    await until(screen, 'Name for this address')
    await screen.press('\r')
    await until(screen, 'Connected Pair Wallet')

    await screen.press('/pair disconnect\r')
    const rows = await until(screen, 'needs to say which')
    expect(rows.some((row) => row.includes('Forget Pair Wallet?'))).toBe(false)
    expect(rows.some((row) => row.includes('/pair disconnect 0xaaa'))).toBe(true)
    expect(await secrets.listCredentials('pair')).toHaveLength(2)

    // Naming one is what asks, and the question is about that one alone.
    await screen.press('/pair disconnect 0xbbb\r')
    const asked = await until(screen, 'Forget Pair Wallet?')
    expect(asked.some((row) => row.includes('0xbbb'))).toBe(true)
    expect(asked.some((row) => row.includes('The other 1 stay'))).toBe(true)
    await screen.press('pair\r')
    await until(screen, 'Forgot 0xbbb')
    expect((await secrets.listCredentials('pair')).map((e) => e.credentials['address'])).toEqual([
      '0xaaa',
    ])
  } finally {
    await secrets.remove('pair')
    screen.stop()
  }
}, 120_000)

/**
 * Replacing destroys a credential, so it goes through the gate every other
 * deletion here goes through: the name typed out, and never Enter — Enter is
 * the key that got you to the question, and a press that changes nothing on
 * screen reads as a press that missed.
 */
test('replacing an address needs the venue typed, and one Enter keeps what is stored', async () => {
  const wallet = fakeVenue('rotate', 'Rotate Wallet', async () => [])
  const screen = await open(120, 33, { connectors: new Map([['rotate', wallet]]) })
  try {
    await screen.press('/rotate connect\r')
    await screen.press('0xaaa\r')
    await until(screen, 'Connected Rotate Wallet')

    await screen.press('/rotate connect\r')
    await until(screen, 'already holds')
    await screen.press('1')
    await screen.press('0xbbb\r')
    const gate = await until(screen, 'Type rotate to confirm')
    // The reader is told what goes, not merely asked to type a word.
    expect(gate.some((row) => row.includes('Replacing 0xaaa'))).toBe(true)
    // Nothing is on disk yet: the new address is verified first, so agreeing to
    // the deletion is never a bet on a credential that has not been checked.
    expect((await secrets.listCredentials('rotate')).map((e) => e.credentials['address'])).toEqual([
      '0xaaa',
    ])

    await screen.press('\r')
    await until(screen, 'nothing was replaced')
    expect((await secrets.listCredentials('rotate')).map((e) => e.credentials['address'])).toEqual([
      '0xaaa',
    ])

    await screen.press('/rotate connect\r')
    await until(screen, 'already holds')
    await screen.press('1')
    await screen.press('0xbbb\r')
    await until(screen, 'Type rotate to confirm')
    await screen.press('rotate\r')
    await until(screen, 'Connected Rotate Wallet')
    const held = await secrets.listCredentials('rotate')
    expect(held.map((e) => e.credentials['address'])).toEqual(['0xbbb'])
  } finally {
    await secrets.remove('rotate')
    screen.stop()
  }
}, 120_000)

/**
 * The bullet this task exists to protect: a screen that asks a wallet for
 * anything typed behind dots is the shape of a phishing page, and adding a
 * second address added three new steps to draw. A masked box is what a
 * connector's `secret` field earns; nothing tula asks for on its own account —
 * the choice, the name, the confirmation — may ever look like one.
 */
test('no step of connecting an address-only venue ever masks what is typed', async () => {
  const wallet = fakeVenue('unmasked', 'Unmasked Wallet', async () => [])
  const screen = await open(120, 33, { connectors: new Map([['unmasked', wallet]]) })
  const nothingMasked = () => {
    const masked = screen.visible().filter((row) => row.includes('•'))
    expect(masked).toEqual([])
    // And the promise stays on screen beside every one of those steps.
    expect(screen.visible().some((row) => row.includes('never asks for a seed phrase'))).toBe(true)
  }
  try {
    await screen.press('/unmasked connect\r')
    nothingMasked()
    await screen.press('0xaaa')
    nothingMasked()
    await screen.press('\r')
    await until(screen, 'Connected Unmasked Wallet')

    await screen.press('/unmasked connect\r')
    await until(screen, 'already holds')
    nothingMasked()
    await screen.press('a')
    await screen.press('0xbbb\r')
    await until(screen, 'Name for this address')
    await screen.press('cold')
    nothingMasked()
    await screen.press('\r')
    await until(screen, 'Connected Unmasked Wallet')

    await screen.press('/unmasked connect\r')
    await until(screen, 'already holds')
    await screen.press('1')
    await screen.press('0xccc\r')
    await until(screen, 'Type unmasked to confirm')
    await screen.press('unmask')
    nothingMasked()
    await screen.press('\x1b')
  } finally {
    await secrets.remove('unmasked')
    screen.stop()
  }
}, 120_000)

/**
 * A venue that failed and a table long enough to be previewed. The caveat is
 * appended last, which is exactly where the preview cut: eleven positions and
 * one failed venue drew a table that read as the whole book, `… 6 more lines`,
 * and nothing at all about the venue that was never read.
 */
test('a venue that failed is still named under a table too long to show whole', async () => {
  const assets = ['ETH', 'BTC', 'SOL', 'AVAX', 'LINK', 'UNI', 'AAVE', 'MKR', 'LDO', 'ARB', 'OP']
  const good = fakeVenue('good', 'Good Venue', async () =>
    assets.map((asset) => holding('good', asset, '1.5')),
  )
  const bad = fakeVenue('bad', 'Bad Venue', async () => {
    throw new Error('the node refused the request')
  })
  const screen = await open(120, 40, {
    connectors: new Map([
      ['good', good],
      ['bad', bad],
    ]),
  })
  try {
    await screen.press('/good connect\r')
    await screen.press('0xabc\r')
    await screen.press('/bad connect\r')
    await screen.press('0xdef\r')
    await screen.press('/exposure\r')

    const rows = await until(screen, 'more lines')
    // The preview is doing its job — this is the frame the caveat used to be
    // held back by, not one where everything happened to fit.
    expect(rows.some((row) => row.includes('more lines'))).toBe(true)
    const shown = screen.visible().join('\n')
    expect(shown).toContain('INCOMPLETE')
    expect(shown).toContain('This is not your full exposure')
    expect(shown).toContain('bad:')
    // The frame is still its own shape under all of it: one input box, no ghost.
    expect(ruleRows(screen)).toBe(2)
  } finally {
    await secrets.remove('good')
    await secrets.remove('bad')
    screen.stop()
  }
}, 120_000)

/**
 * The REMOVED block is the tail of `incompleteNote` and the transcript cuts at
 * twelve rows, so the one line that replaces the paragraph from the second view
 * on has to be pinned exactly as the paragraph was. Shortened without that, the
 * only remaining mention of a credential still on disk would sit precisely
 * where the preview cuts.
 */
test('the short line about a dropped venue survives a table too long to show whole', async () => {
  const restore = await credentialEnv({ profile: true })
  const assets = ['ETH', 'BTC', 'SOL', 'AVAX', 'LINK', 'UNI', 'AAVE', 'MKR', 'LDO', 'ARB', 'OP']
  const wallet = fakeVenue('kept', 'Kept Wallet', async () =>
    assets.map((asset) => holding('kept', asset, '1.5')),
  )
  await secrets.put('kept', { address: '0xabc' })
  await secrets.put('circle', { apiKey: 'not-real' })
  const screen = await open(120, 40, {
    connectors: new Map([['kept', wallet]]),
    initialVenues: await secrets.listVenues(),
  })
  try {
    await screen.press('/exposure\r')
    await until(screen, 'Circle Mint was removed')
    await screen.press('/exposure\r')
    const rows = await until(screen, 'still stored')

    // The preview is doing its job — this is the frame the line has to survive,
    // not one where everything happened to fit.
    expect(rows.some((row) => row.includes('more lines'))).toBe(true)
    const shown = screen.visible().join('\n')
    expect(shown).toContain('REMOVED — circle, still stored.')
    expect(shown).toContain('/forget circle')
    // And the paragraph is not printed a second time.
    expect(screen.visible().filter((row) => row.includes('Circle Mint was removed'))).toEqual([])
    expect(ruleRows(screen)).toBe(2)
  } finally {
    screen.stop()
    await restore()
  }
}, 120_000)

/**
 * Mode 1003 reports every movement of the pointer, and a hand resting on the
 * trackpad puts one in front of the next character. The report and the `0`
 * arrived in one chunk, only the report was read, and `/shock ETH -20` was
 * submitted as `/shock ETH -2` — a different scenario, with nothing on screen
 * to say a character had gone.
 */
test('a character that shares a chunk with a mouse report still reaches the line', async () => {
  const screen = await open(120, 33)
  try {
    await screen.press('/shock ETH -2')
    // A report reaches this handler with its escape already stripped — which
    // is why the parser accepts it without one — and what follows it in the
    // same chunk is the digit.
    await screen.press('[<35;10;10M0')
    const rows = screen.visible()
    const line = rows[rows.findIndex(isRule) + 1]?.trim()
    expect(line).toBe('❯ /shock ETH -20')
  } finally {
    screen.stop()
  }
})

/**
 * A venue writes the asset symbol. One CJK character measures one code unit and
 * is drawn two cells wide, so a column padded by length is short by its own
 * width on that row and every column right of it moves — and the row wraps,
 * which is the row Ink counts as one and never takes back.
 */
test('a venue that spells an asset in Chinese still lines its table up', async () => {
  const wide = fakeVenue('wide', 'Wide Venue', async () => [
    holding('wide', 'ETH', '12'),
    holding('wide', '比特币', '2'),
    holding('wide', 'USDC', '1000'),
  ])
  const screen = await open(80, 33, { connectors: new Map([['wide', wide]]) })
  try {
    await screen.press('/wide connect\r')
    await screen.press('0xabc\r')
    await screen.press('/positions\r')
    const rows = await until(screen, '比特币')

    const held = rows.filter((row) => /^\s*wide\s+spot/.test(row))
    expect(held).toHaveLength(3)
    // Every row of the table draws the same number of cells, which is what
    // says every column right of ASSET starts where the rows above start it.
    expect(new Set(held.map(cells)).size).toBe(1)
    // A wide glyph counts two cells, so a table laid out by code point fits the
    // width it measured and runs past the one the terminal has.
    expect(screen.wrapped()).toEqual([])
    expect(ruleRows(screen)).toBe(2)
  } finally {
    await secrets.remove('wide')
    screen.stop()
  }
}, 120_000)

/**
 * The first screen anyone sees of tula. Ink holds raw mode, so a ctrl+c nothing
 * handles raises no SIGINT either: the key everybody has learned did nothing at
 * all, twice, and the tool read as hung at its opening screen.
 */
test('ctrl+c leaves the screen the first run opens on', async () => {
  const restore = await credentialEnv({ profile: false })
  const screen = await open(100, 33, { initialApiKey: undefined })
  try {
    expect(screen.visible().join('\n')).toContain('Sign in with your Anthropic account')
    await screen.press('\x03')
    expect(screen.exited()).toBe(true)
  } finally {
    screen.stop()
    await restore()
  }
})

/**
 * ctrl+d is how a shell is left, and there is a line editor under this one: in a
 * real shell it deletes forward mid-word, so leaving on it would end a session
 * somebody was halfway through typing a command into. Only an empty line leaves.
 */
test('ctrl+d leaves an empty line, and never a half-typed one', async () => {
  const screen = await open(100, 30)
  try {
    await screen.press('/expo')
    await screen.press('\x04')
    expect(screen.exited()).toBe(false)
    // Still there to finish, which is the whole reason it did not leave.
    expect(screen.visible().join('\n')).toContain('/expo')

    // ctrl+c on a line with something on it clears the line rather than leaving,
    // for the same reason — and that is what makes the next ctrl+d empty.
    await screen.press('\x03')
    expect(screen.exited()).toBe(false)

    await screen.press('\x04')
    expect(screen.exited()).toBe(true)
  } finally {
    screen.stop()
  }
})

/**
 * The arrows are the only way back to a command that has scrolled off, and the
 * one that recalls it usually starts with a slash — which re-opens the menu and
 * hands it the next arrow, so history stayed one step deep however often you
 * pressed. `recallHistory` dismisses the menu for exactly that.
 */
test('the up arrow brings a command back, and the down arrow puts it away again', async () => {
  const screen = await open(100, 30)
  const showing = (text: string) => screen.visible().filter((row) => row.includes(text)).length
  try {
    await screen.press('/exposure\r')
    // Echoed into the transcript, once, and the line it was typed on is empty.
    expect(showing('/exposure')).toBe(1)

    await screen.press('\x1b[A')
    // Twice now: the echo above, and the line it has been put back on.
    expect(showing('/exposure')).toBe(2)

    await screen.press('\x1b[B')
    expect(showing('/exposure')).toBe(1)
  } finally {
    screen.stop()
  }
})

test('ctrl+c leaves the connect screen while the key is still being checked', async () => {
  const slow: Connector = {
    ...fakeVenue('slowly', 'Slow Venue', async () => []),
    async verifyScope() {
      await new Promise((r) => setTimeout(r, 5000))
      return { canRead: true, canTrade: false as const, canWithdraw: false as const }
    },
  }
  const screen = await open(120, 33, { connectors: new Map([['slowly', slow]]) })
  try {
    await screen.press('/slowly connect\r')
    expect(screen.visible().join('\n')).toContain('Connect Slow Venue')
    // The wait is a call to the venue behind a deadline, and a screen that
    // cannot be left during it is exactly when somebody reaches for this key.
    await screen.press('0xabc\r')
    expect(screen.visible().join('\n')).toContain('checking the address')
    await screen.press('\x03')
    expect(screen.exited()).toBe(true)
  } finally {
    screen.stop()
  }
}, 60_000)

/**
 * "Sign out" is one row under whatever the cursor was on, and an `sk-ant-` key
 * is shown by the console once — so forgetting it is the same cost as losing
 * it. The question is asked with the safe answer already under the cursor.
 */
test('signing out asks first, and Enter on the question keeps the key', async () => {
  const restore = await credentialEnv({ profile: false })
  await secrets.putProviderKey('sk-ant-notarealkey')
  const screen = await open(100, 33)
  try {
    await screen.press('/login\r')
    await screen.press('\x1b[B')
    await screen.press('\x1b[B')
    expect(screen.visible().join('\n')).toContain('Sign out')
    await screen.press('\r')

    const asked = screen.visible().join('\n')
    expect(asked).toContain('Forget the API key tula has saved?')
    expect(await secrets.getProviderKey()).toBe('sk-ant-notarealkey')

    // The safe answer is the one under the cursor, so the key that got here
    // does the harmless thing.
    await screen.press('\r')
    expect(await secrets.getProviderKey()).toBe('sk-ant-notarealkey')
  } finally {
    screen.stop()
    await restore()
  }
})
