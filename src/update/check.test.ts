import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { REPO_URL } from '../version.js'
import { pendingUpdate } from './check.js'

const NEW = '9.9.9'

let config: string
let calls: string[]
const realFetch = globalThis.fetch

/** Answers the redirect with `tag`, and counts what was asked for. */
function serve(tag: string | null): void {
  calls = []
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input.toString()
    calls.push(url)
    const landed = new Response(null, { status: 200 })
    if (tag) Object.defineProperty(landed, 'url', { value: `${REPO_URL}/releases/tag/${tag}` })
    return landed
  }) as typeof fetch
}

const state = async () => JSON.parse(await readFile(join(config, 'state.json'), 'utf8'))

beforeEach(async () => {
  config = await mkdtemp(join(tmpdir(), 'tula-check-'))
  process.env['TULA_CONFIG_DIR'] = config
  delete process.env['TULA_NO_UPDATE_CHECK']
})

afterEach(async () => {
  globalThis.fetch = realFetch
  delete process.env['TULA_CONFIG_DIR']
  delete process.env['TULA_NO_UPDATE_CHECK']
  await rm(config, { recursive: true, force: true })
})

describe('the startup check', () => {
  test('on a machine that has never run tula, it asks and reports', async () => {
    serve(`v${NEW}`)
    const found = await pendingUpdate()
    expect(found?.version).toBe(NEW)
    expect(found?.release).toBe(`${REPO_URL}/releases/tag/v${NEW}`)
  })

  /** The off switch has to come before the request, not after it. */
  test('TULA_NO_UPDATE_CHECK makes no request at all', async () => {
    serve(`v${NEW}`)
    process.env['TULA_NO_UPDATE_CHECK'] = '1'
    expect(await pendingUpdate()).toBeNull()
    expect(calls).toEqual([])
  })

  test('every start asks', async () => {
    serve(`v${NEW}`)
    await pendingUpdate()
    serve(`v${NEW}`)
    await pendingUpdate()
    expect(calls).toHaveLength(1)
  })

  /**
   * Told once. A line repeated on every start about a version somebody has
   * already decided not to install is the thing that gets a check switched off.
   */
  test('the same version is announced once, not on every start', async () => {
    serve(`v${NEW}`)
    expect(await pendingUpdate()).not.toBeNull()
    serve(`v${NEW}`)
    expect(await pendingUpdate()).toBeNull()
    expect(calls).toHaveLength(1)
  })

  test('a newer release after the announced one is announced too', async () => {
    serve(`v${NEW}`)
    await pendingUpdate()
    serve('v9.9.10')
    expect((await pendingUpdate())?.version).toBe('9.9.10')
  })

  /** Nothing to record when nothing was said, so an offline start leaves no file. */
  test('an unreachable GitHub is silence, and writes nothing', async () => {
    globalThis.fetch = (async (input: string | URL | Request): Promise<Response> => {
      calls.push(typeof input === 'string' ? input : input.toString())
      throw new Error('offline')
    }) as typeof fetch
    calls = []
    expect(await pendingUpdate()).toBeNull()
    expect(calls).toHaveLength(1)
    expect(await state().catch(() => null)).toBeNull()
  })

  test('a release older than this build is not an update', async () => {
    serve('v0.0.1')
    expect(await pendingUpdate()).toBeNull()
  })

  test('a repository with nothing published is no answer', async () => {
    serve(null)
    expect(await pendingUpdate()).toBeNull()
  })

  /** An unreadable state file is a check that did not happen, not a crash. */
  test('junk in state.json does not stop the session starting', async () => {
    await writeFile(join(config, 'state.json'), 'not json{')
    serve(`v${NEW}`)
    expect((await pendingUpdate())?.version).toBe(NEW)
  })
})
