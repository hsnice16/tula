import { describe, expect, test } from 'bun:test'
import { EventEmitter } from 'node:events'
import { mouseReport, mouseReports, trackMouse } from './mouse.js'

const sgr = (button: number, column: number, row: number, end: 'M' | 'm' = 'M') =>
  `\x1b[<${button};${column};${row}${end}`

describe('one report at a time', () => {
  test('a wheel notch carries its direction', () => {
    expect(mouseReport(sgr(64, 10, 5))).toEqual({ kind: 'wheel', step: -1 })
    expect(mouseReport(sgr(65, 10, 5))).toEqual({ kind: 'wheel', step: 1 })
  })

  test('a press and its release are told apart by the terminal, not the button', () => {
    expect(mouseReport(sgr(0, 4, 2))).toEqual({ kind: 'press', column: 4, row: 2 })
    expect(mouseReport(sgr(0, 4, 2, 'm'))).toEqual({ kind: 'release', column: 4, row: 2 })
  })

  test('movement with no button held is a move, with one is a drag', () => {
    expect(mouseReport(sgr(35, 7, 3))).toEqual({ kind: 'move', column: 7, row: 3 })
    expect(mouseReport(sgr(32, 7, 3))).toEqual({ kind: 'drag', column: 7, row: 3 })
  })

  test('ordinary typing is not a report', () => {
    expect(mouseReport('a')).toBeNull()
    expect(mouseReport('\x1b')).toBeNull()
  })
})

describe('a chunk holding several', () => {
  // The defect: mode 1003 reports every movement, and a hand crossing the
  // screen produces them faster than stdin is drained. Matched one-per-chunk,
  // a swept run failed to parse and was typed into the line verbatim.
  test('a swept run is parsed, not typed', () => {
    const swept = [sgr(35, 10, 5), sgr(35, 11, 5), sgr(35, 12, 5)].join('')
    const { reports, rest } = mouseReports(swept)
    expect(reports).toHaveLength(3)
    expect(reports.map((r) => (r.kind === 'move' ? r.column : -1))).toEqual([10, 11, 12])
    expect(rest).toBe('')
  })

  test('mixed kinds in one chunk keep their order', () => {
    const { reports } = mouseReports(sgr(64, 1, 1) + sgr(0, 2, 2) + sgr(0, 2, 2, 'm'))
    expect(reports.map((r) => r.kind)).toEqual(['wheel', 'press', 'release'])
  })

  test('a report split across two chunks is held, not typed', () => {
    const whole = sgr(35, 10, 5)
    const first = mouseReports(whole.slice(0, 6))
    expect(first.reports).toHaveLength(0)
    expect(first.partial).toBe(whole.slice(0, 6))

    const second = mouseReports(first.partial + whole.slice(6))
    expect(second.reports).toEqual([{ kind: 'move', column: 10, row: 5 }])
    expect(second.partial).toBe('')
  })

  test('a lone escape is the Escape key, not the front of a report', () => {
    // Held, it would swallow the key that closes the palette.
    expect(mouseReports('\x1b').partial).toBe('')
  })

  test('typing is left alone', () => {
    const { reports, rest, partial } = mouseReports('kraken')
    expect(reports).toHaveLength(0)
    expect(rest).toBe('kraken')
    expect(partial).toBe('')
  })
})

describe('the terminal is handed back', () => {
  const stub = () => {
    const written: string[] = []
    const stdout = {
      write: (s: string) => {
        written.push(s)
        return true
      },
    } as unknown as NodeJS.WriteStream
    return { written, stdout }
  }

  test('the undo turns both modes off', () => {
    const { written, stdout } = stub()
    const off = trackMouse(stdout)
    expect(written[0]).toBe('\x1b[?1003h\x1b[?1006h')
    off()
    expect(written[1]).toBe('\x1b[?1006l\x1b[?1003l')
  })

  test('it registers for signals that never reach a React cleanup', () => {
    // Closing the window is SIGHUP and `kill` is SIGTERM; neither unwinds
    // anything, so without these the user's shell keeps reporting the mouse
    // long after tula is gone.
    const { stdout } = stub()
    // `exit` is not enough on its own: Bun, which the binary is compiled with,
    // does not reach it from an uncaught throw.
    const events = ['SIGHUP', 'SIGTERM', 'exit', 'uncaughtException', 'unhandledRejection']
    const count = () => events.map((e) => process.listenerCount(e))
    const before = count()
    const off = trackMouse(stdout)
    const during = count()
    off()
    const after = count()

    expect(during).toEqual(before.map((n) => n + 1))
    // And removes them again, or opening a list repeatedly leaks listeners.
    expect(after).toEqual(before)
  })

  test('the undo runs once, however many times it is called', () => {
    const { written, stdout } = stub()
    const off = trackMouse(stdout)
    off()
    off()
    expect(written.filter((w) => w.includes('1003l'))).toHaveLength(1)
  })

  test('a stream that closed since does not mask the real failure', () => {
    // The order a crash produces: the terminal was there when the list opened
    // and is gone by the time the process is unwinding. Throwing here would
    // replace the error the user needs to read with an EPIPE from the cleanup.
    let alive = true
    const stdout = new EventEmitter() as unknown as NodeJS.WriteStream
    stdout.write = (() => {
      if (!alive) throw new Error('EPIPE')
      return true
    }) as NodeJS.WriteStream['write']
    const off = trackMouse(stdout)
    alive = false
    expect(() => off()).not.toThrow()
  })
})
