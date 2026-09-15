import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { chmod, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  clearHistory,
  findInHistory,
  HISTORY_LIMIT,
  historyPath,
  readHistory,
  recordable,
  recordHistory,
  SCAN_STAGED,
} from './history.js'

let dir = ''
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tula-history-'))
  await chmod(dir, 0o700)
  process.env['TULA_CONFIG_DIR'] = dir
  delete process.env['TULA_NO_HISTORY']
})
afterEach(async () => {
  delete process.env['TULA_CONFIG_DIR']
  delete process.env['TULA_NO_HISTORY']
  await rm(dir, { recursive: true, force: true })
})

const onDisk = async () => (await readFile(historyPath(), 'utf8')).trim().split('\n').map((row) => JSON.parse(row))

/**
 * Assembled at run time: this file is scanned by the same hook it mirrors, and
 * a credential-shaped literal here is a commit it would refuse.
 */
const shaped = {
  anthropic: `sk-${'ant'}-api03-${'x'.repeat(24)}`,
  stripe: `rk_${'live'}_${'A1'.repeat(10)}`,
  hex64: 'ab'.repeat(32),
  assigned: `KRAKEN_API_${'SECRET'}=${'Qz9'.repeat(10)}`,
  unbroken: `${'Kq7+'.repeat(22)}==`,
  words: Array.from({ length: 12 }, () => 'abandon').join(' '),
}

describe('what is recorded', () => {
  test('commands and questions alike, and an address', () => {
    expect(recordable('/shock ETH -20%')).toBe(true)
    expect(recordable('what breaks first if eth drops 20%?')).toBe(true)
    expect(recordable(`/wallet disconnect 0x${'ab12'.repeat(10)}`)).toBe(true)
  })

  test('a line starting with a space is not', () => {
    expect(recordable(' /positions')).toBe(false)
  })

  // Somebody pasting a key onto the wrong line is the case this file must not
  // make permanent, whichever shape the key has.
  test('nothing the commit hook would refuse as a credential', () => {
    for (const [shape, line] of Object.entries(shaped)) {
      expect({ shape, recorded: recordable(line) }).toEqual({ shape, recorded: false })
      expect({ shape, recorded: recordable(`is this right ${line}`) }).toEqual({ shape, recorded: false })
    }
  })

  // A paste keeps its line breaks, so a phrase copied from wherever it was
  // written down reaches the line in that shape.
  test('a seed phrase in any shape it is written down in', () => {
    const seed = ['abandon', 'ability', 'able', 'about', 'above', 'absent', 'absorb', 'abstract', 'absurd', 'abuse', 'access', 'accident']
    const long = [...seed, ...seed]
    const shapes = {
      lines: seed.join('\n'),
      windows: seed.join('\r\n'),
      tabs: seed.join('\t'),
      spaced: seed.join('  '),
      numbered: seed.map((w, at) => `${at + 1}. ${w}`).join('\n'),
      capitalised: seed.map((w) => w[0]?.toUpperCase() + w.slice(1)).join(' '),
      commas: seed.join(', '),
      twentyFour: long.join('\n'),
      afterQuestion: `is this my backup?\n${seed.join(' ')}`,
    }
    for (const [shape, line] of Object.entries(shapes)) {
      expect({ shape, recorded: recordable(line) }).toEqual({ shape, recorded: false })
    }
  })

  test('a long question of ordinary words over several lines is still kept', () => {
    const question = [
      'show every venue where funding turned against my short book',
      'over the last three days, then rank which one breaks first',
      'and tell me what would need to change to stay safe',
    ].join('\n')
    expect(recordable(question)).toBe(true)
  })

  /**
   * The two lists are held to each other rather than one copied from the other
   * once: a pattern added to the hook and not here is a key the file keeps.
   */
  test('every credential pattern the hook refuses is refused here', async () => {
    const hook = await readFile('.githooks/scan-staged', 'utf8')
    const secrets = /SECRETS='([^']*)'/.exec(hook)?.[1]?.split('\n') ?? []
    const greps = [...hook.matchAll(/grep -o(i?)E (?:'([^']*)'|"((?:[^"\\]|\\.)*)")/g)].map((m) => ({
      ere: m[2] ?? (m[3] ?? '').replaceAll('\\"', '"'),
      ignoreCase: m[1] === 'i',
    }))
    const hooked = [...secrets.map((ere) => ({ ere, ignoreCase: false })), ...greps]
      // An address is public, and naming the wallet a question is about is
      // what a line here is for.
      .filter(({ ere }) => ere !== '0x[a-f0-9]{40,}')
    expect(hooked.length).toBeGreaterThan(10)
    expect([...SCAN_STAGED].sort((a, b) => a.ere.localeCompare(b.ere))).toEqual(
      hooked.sort((a, b) => a.ere.localeCompare(b.ere)),
    )
  })
})

describe('the file', () => {
  test('is created 600 under the config directory', async () => {
    await recordHistory('/exposure')
    expect(historyPath().startsWith(dir)).toBe(true)
    expect((await stat(historyPath())).mode & 0o777).toBe(0o600)
    expect(await onDisk()).toEqual(['/exposure'])
  })

  test('keeps an immediate repeat once, and a repeat after something else', async () => {
    for (const line of ['/exposure', '/exposure', '/breaks', '/exposure']) await recordHistory(line)
    expect(await readHistory()).toEqual(['/exposure', '/breaks', '/exposure'])
  })

  test('holds the newest entries up to its cap and no more', async () => {
    const lines = Array.from({ length: HISTORY_LIMIT + 5 }, (_, at) => `/shock ETH -${at}%`)
    await writeFile(historyPath(), lines.slice(0, -1).map((l) => `${JSON.stringify(l)}\n`).join(''), { mode: 0o600 })
    await recordHistory(lines.at(-1) ?? '')
    const kept = await readHistory()
    expect(kept).toHaveLength(HISTORY_LIMIT)
    expect(kept.at(-1)).toBe(lines.at(-1))
    expect(kept[0]).toBe(lines[5])
    expect((await stat(historyPath())).mode & 0o777).toBe(0o600)
  })

  test('writes nothing when a line is not to be kept', async () => {
    await recordHistory(' /positions')
    await recordHistory(shaped.anthropic)
    expect(await readHistory()).toEqual([])
  })

  test('drops on read what it would refuse to write', async () => {
    await writeFile(historyPath(), `${JSON.stringify('/exposure')}\n${JSON.stringify(shaped.hex64)}\n`, { mode: 0o600 })
    expect(await readHistory()).toEqual(['/exposure'])
  })

  test('TULA_NO_HISTORY=1 keeps nothing at all', async () => {
    process.env['TULA_NO_HISTORY'] = '1'
    await recordHistory('/exposure')
    expect(await readHistory()).toEqual([])
  })

  // `/history` says ↑ and ctrl+r reach only this session's lines while it is set.
  test('TULA_NO_HISTORY=1 hands back nothing a file saved earlier holds', async () => {
    await recordHistory('/exposure')
    process.env['TULA_NO_HISTORY'] = '1'
    expect(await readHistory()).toEqual([])
  })

  test('two shells writing at the cap both keep their line', async () => {
    const lines = Array.from({ length: HISTORY_LIMIT }, (_, at) => `/shock ETH -${at}%`)
    await writeFile(historyPath(), lines.map((l) => `${JSON.stringify(l)}\n`).join(''), { mode: 0o600 })
    await Promise.all([recordHistory('/exposure'), recordHistory('/breaks')])
    expect((await readHistory()).slice(-2).sort()).toEqual(['/breaks', '/exposure'])
  })

  test('the file is cut back to the cap only once it holds twice that', async () => {
    const lines = Array.from({ length: 2 * HISTORY_LIMIT }, (_, at) => `/shock ETH -${at}%`)
    await writeFile(historyPath(), lines.map((l) => `${JSON.stringify(l)}\n`).join(''), { mode: 0o600 })
    await recordHistory('/exposure')
    expect(await onDisk()).toEqual([...lines.slice(-(HISTORY_LIMIT - 1)), '/exposure'])
    expect((await stat(historyPath())).mode & 0o777).toBe(0o600)
  })

  test('/history clear takes the file away and says how much it held', async () => {
    await recordHistory('/exposure')
    await recordHistory('/breaks')
    expect(await clearHistory()).toBe(2)
    expect(await readHistory()).toEqual([])
  })
})

describe('refused, never repaired', () => {
  test('a file anyone else can read', async () => {
    await writeFile(historyPath(), `${JSON.stringify('/exposure')}\n`, { mode: 0o644 })
    await chmod(historyPath(), 0o644)
    await expect(readHistory()).rejects.toThrow('chmod 600')
    await expect(recordHistory('/breaks')).rejects.toThrow('chmod 600')
    expect((await stat(historyPath())).mode & 0o777).toBe(0o644)
  })

  test('a link, read or written through', async () => {
    const target = join(dir, 'elsewhere')
    await writeFile(target, '', { mode: 0o600 })
    await symlink(target, historyPath())
    await expect(readHistory()).rejects.toThrow('not a regular file')
    await expect(recordHistory('/breaks')).rejects.toThrow('not a regular file')
    expect(await readFile(target, 'utf8')).toBe('')
  })

  test('a directory anyone can write to', async () => {
    await chmod(dir, 0o777)
    await expect(recordHistory('/breaks')).rejects.toThrow('chmod 700')
  })
})

describe('searching it', () => {
  const entries = ['/shock ETH -20%', '/breaks', '/shock BTC -10%', '/shock BTC -10%', '/exposure']

  test('finds the newest match first and steps older past a repeat of the one shown', () => {
    const first = findInHistory(entries, 'shock', entries.length - 1, -1)
    expect(entries[first]).toBe('/shock BTC -10%')
    const older = findInHistory(entries, 'shock', first - 1, -1, entries[first])
    expect(entries[older]).toBe('/shock ETH -20%')
    expect(findInHistory(entries, 'shock', older - 1, -1, entries[older])).toBe(-1)
  })

  test('is case-sensitive, as Readline is', () => {
    expect(findInHistory(entries, 'eth', entries.length - 1, -1)).toBe(-1)
  })
})
