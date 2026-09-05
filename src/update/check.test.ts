import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { REPO_URL } from '../version.js'
import { pendingUpdate } from './check.js'

const NEW = '9.9.9'
const DAY = 24 * 60 * 60 * 1000

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

  test('a second start the same day asks nothing', async () => {
    serve(`v${NEW}`)
    const now = Date.now()
    await pendingUpdate(now)
    serve(`v${NEW}`)
    expect(await pendingUpdate(now + DAY / 2)).toBeNull()
    expect(calls).toEqual([])
  })

  test('a start a day later asks again', async () => {
    serve(`v${NEW}`)
    const now = Date.now()
    await pendingUpdate(now)
    serve(`v${NEW}`)
    await pendingUpdate(now + DAY + 1)
    expect(calls).toHaveLength(1)
  })

  /**
   * Told once. A line repeated every morning about a version somebody has
   * already decided not to install is the thing that gets a check switched off.
   */
  test('the same version is announced once, not every day', async () => {
    serve(`v${NEW}`)
    const now = Date.now()
    expect(await pendingUpdate(now)).not.toBeNull()
    serve(`v${NEW}`)
    expect(await pendingUpdate(now + DAY + 1)).toBeNull()
    expect(calls).toHaveLength(1)
  })

  /**
   * Recorded whether or not there was an answer, so an unreachable GitHub costs
   * one attempt a day rather than one on every start.
   */
  test('an unreachable GitHub still counts as today’s attempt', async () => {
    globalThis.fetch = (async (input: string | URL | Request): Promise<Response> => {
      calls.push(typeof input === 'string' ? input : input.toString())
      throw new Error('offline')
    }) as typeof fetch
    calls = []
    const now = Date.now()
    expect(await pendingUpdate(now)).toBeNull()
    expect(Date.parse((await state()).checkedAt)).toBe(now)
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
