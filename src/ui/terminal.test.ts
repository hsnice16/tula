import { describe, expect, test } from 'bun:test'
import { holdInputModes } from './terminal.js'

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

/**
 * A shell left in the kitty keyboard protocol turns every keystroke into an
 * escape code, which reads as a broken terminal. The app pushes the protocol and
 * nothing pops it on unmount, so the undo pops what was pushed — and nothing
 * more, or it pops a mode the shell set before tula.
 */
describe('the input modes are handed back', () => {
  test('the keyboard protocol left pushed is popped on the way out', () => {
    const { written, stdout } = stub()
    const release = holdInputModes(stdout)
    stdout.write('\x1b[>1u')
    release()
    expect(written).toEqual(['\x1b[>1u', '\x1b[<u'])
  })

  test('the keyboard protocol already popped is not popped a second time', () => {
    const { written, stdout } = stub()
    const release = holdInputModes(stdout)
    stdout.write('\x1b[>1u')
    stdout.write('frame\x1b[<u')
    release()
    expect(written).toEqual(['\x1b[>1u', 'frame\x1b[<u'])
  })

  // A terminal that never answered the query was never pushed to, and a pop
  // there would take an entry belonging to whatever ran before tula.
  test('nothing is popped where nothing was pushed', () => {
    const { written, stdout } = stub()
    const release = holdInputModes(stdout)
    stdout.write('\x1b[?u')
    release()
    expect(written).toEqual(['\x1b[?u'])
  })

  test('it registers for every way out that never reaches a React cleanup', () => {
    const { stdout } = stub()
    // `exit` alone is not enough: Bun, which the binary is compiled with, does
    // not reach it from an uncaught throw.
    const events = ['SIGINT', 'SIGHUP', 'SIGTERM', 'SIGQUIT', 'exit', 'uncaughtException', 'unhandledRejection']
    const count = () => events.map((e) => process.listenerCount(e))
    const before = count()
    const release = holdInputModes(stdout)
    const during = count()
    release()
    expect(during).toEqual(before.map((n) => n + 1))
    expect(count()).toEqual(before)
  })

  test('the exit handler pops, and the write it watched is put back', () => {
    const { written, stdout } = stub()
    const original = stdout.write
    const release = holdInputModes(stdout)
    stdout.write('\x1b[>1u')
    const handlers = process.listeners('exit')
    const handler = handlers[handlers.length - 1] as () => void
    handler()
    expect(written.at(-1)).toBe('\x1b[<u')
    expect(stdout.write).toBe(original)
    release()
    expect(written.filter((w) => w === '\x1b[<u')).toHaveLength(1)
  })

  test('a stream that closed since does not mask the real failure', () => {
    let alive = true
    const stdout = {
      write: () => {
        if (!alive) throw new Error('EPIPE')
        return true
      },
    } as unknown as NodeJS.WriteStream
    const release = holdInputModes(stdout)
    stdout.write('\x1b[>1u')
    alive = false
    expect(() => release()).not.toThrow()
  })

  // Without its own bracketed paste, a shell left in the mode types `200~`
  // around everything pasted into it.
  test('bracketed paste left on is turned off, and left off when Ink turned it off', () => {
    const on = stub()
    const releaseOn = holdInputModes(on.stdout)
    on.stdout.write('\x1b[?2004h')
    releaseOn()
    expect(on.written).toEqual(['\x1b[?2004h', '\x1b[?2004l'])

    const off = stub()
    const releaseOff = holdInputModes(off.stdout)
    off.stdout.write('\x1b[?2004h')
    off.stdout.write('\x1b[?2004l')
    releaseOff()
    expect(off.written).toEqual(['\x1b[?2004h', '\x1b[?2004l'])
  })
})
