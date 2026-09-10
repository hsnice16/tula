import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * The one-shot CLI, run as a process, because the thing under test is what a
 * terminal hands it: `process.stdin.isTTY`. Every other test here calls
 * `dispatchCommand` directly, which is past the point where that is decided.
 *
 * What it is guarding: deleting a credential is not undoable from inside tula —
 * an exchange shows a secret key once — and the shell asks for the venue's name
 * to be typed before it does. `tula forget kraken` skipped that gate entirely.
 */
async function configWith(store: Record<string, unknown>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tula-oneshot-'))
  await chmod(dir, 0o700)
  const path = join(dir, 'credentials.json')
  await writeFile(path, JSON.stringify(store, null, 2))
  await chmod(path, 0o600)
  return dir
}

const run = (dir: string, args: string[], input = '') =>
  spawnSync('bun', ['run', 'src/index.ts', ...args], {
    encoding: 'utf8',
    input,
    env: { ...process.env, TULA_CONFIG_DIR: dir, TULA_NO_UPDATE_CHECK: '1' },
  })

/** The venues in the file, which is every key the store does not reserve. */
const stored = async (dir: string): Promise<string[]> =>
  Object.keys(JSON.parse(await readFile(join(dir, 'credentials.json'), 'utf8'))).filter(
    (key) => !key.startsWith('__'),
  )

describe('deleting a credential from the command line', () => {
  test('a piped run is refused rather than read as a yes', async () => {
    const dir = await configWith({ kraken: { apiKey: 'k', apiSecret: 's' } })
    const { stdout, stderr, status } = run(dir, ['forget', 'kraken'])
    expect(status).toBe(1)
    expect(stderr + stdout).toContain('--yes')
    // The whole point: the key is still there.
    expect(await stored(dir)).toEqual(['kraken'])
  })

  test('the same refusal covers the other spelling of the same act', async () => {
    const dir = await configWith({ kraken: { apiKey: 'k', apiSecret: 's' } })
    const { stdout, stderr, status } = run(dir, ['kraken', 'disconnect'])
    expect(status).toBe(1)
    expect(stderr + stdout).toContain('--yes')
    expect(await stored(dir)).toEqual(['kraken'])
  })

  test('--yes is what deletes it, so the delete is always something typed', async () => {
    const dir = await configWith({ kraken: { apiKey: 'k', apiSecret: 's' } })
    const { stdout, status } = run(dir, ['forget', 'kraken', '--yes'])
    expect(status).toBe(0)
    expect(stdout).toContain('Removed kraken')
    expect(await stored(dir)).toEqual([])
  })

  test('a venue that holds nothing to delete is not gated into a false alarm', async () => {
    const dir = await configWith({ kraken: { apiKey: 'k', apiSecret: 's' } })
    const { stdout, status } = run(dir, ['forget', 'binance'])
    expect(status).toBe(0)
    expect(stdout).toContain('Nothing stored for "binance"')
    expect(await stored(dir)).toEqual(['kraken'])
  })

  test('a command that deletes nothing is not made to ask about it', async () => {
    const dir = await configWith({ kraken: { apiKey: 'k', apiSecret: 's' } })
    const { stdout, status } = run(dir, ['about'])
    expect(status).toBe(0)
    expect(stdout).toContain('Venues in build')
  })
})

/** The entries stored for one venue, by the name each was given. */
const named = async (dir: string, venue: string): Promise<(string | undefined)[]> => {
  const store = JSON.parse(await readFile(join(dir, 'credentials.json'), 'utf8')) as Record<
    string,
    { name?: string }[]
  >
  return (store[venue] ?? []).map((e) => e.name)
}

/**
 * A venue may now hold several accounts, and both of the acts that touch one of
 * them have to say which. Connecting is the path that could quietly overwrite;
 * forgetting is the path that could quietly take more than was asked for.
 */
describe('one account of several, from the command line', () => {
  const twoWallets = {
    __version: 2,
    wallet: [
      { id: 'aaaaaaaa', name: 'hot', credentials: { address: '0xHot' } },
      { id: 'bbbbbbbb', name: 'cold', credentials: { address: '0xCold' } },
    ],
  }

  // Unattended, the safe answer is the one that deletes nothing — and the
  // question must not be asked at all, because `ask()` off a terminal reads the
  // pipe and would eat the address a script was feeding in.
  test('a piped connect adds to what is stored and never offers to replace it', async () => {
    const dir = await configWith(twoWallets)
    const { stdout, stderr } = run(dir, ['connect', 'wallet'], 'not-an-address\n')
    const out = stdout + stderr
    expect(out).toContain('already holds 2')
    expect(out).toContain('Adding to them')
    expect(out).not.toContain('to replace that one')
    // The piped line reached the address prompt rather than the question above
    // it: this is the refusal that only comes from having read the address.
    expect(out.toLowerCase()).toContain('address')
    expect(await named(dir, 'wallet')).toEqual(['hot', 'cold'])
  })

  test('naming one account to forget is still refused without a terminal to confirm on', async () => {
    const dir = await configWith(twoWallets)
    const { stdout, stderr, status } = run(dir, ['wallet', 'disconnect', 'cold'])
    expect(status).toBe(1)
    expect(stdout + stderr).toContain('--yes')
    expect(await named(dir, 'wallet')).toEqual(['hot', 'cold'])
  })
})

describe('a command line is not the shell', () => {
  test('a mistyped command says it was not a command, and names the nearest one', async () => {
    const dir = await configWith({})
    const { stdout, stderr, status } = run(dir, ['exposre'])
    expect(status).toBe(1)
    // The whole usage block with nothing to say which word was wrong is a dead
    // end: the shell has said "did you mean" since the first release.
    expect(stdout + stderr).toContain('exposre')
    expect(stdout + stderr).toContain('exposure')
  })

  test('a remedy is spelled the way it would be typed here, not as a slash command', async () => {
    const dir = await configWith({})
    const { stdout, stderr } = run(dir, ['stripe', 'positions'])
    const out = stdout + stderr
    expect(out).toContain('tula connect stripe')
    // Pasted into a real shell, `/stripe connect` is a path that does not exist.
    expect(out).not.toContain('/stripe connect')
  })

  test('a stored venue tula no longer reads did not fail — nothing was attempted', async () => {
    const dir = await configWith({ circle: { apiKey: 'x' } })
    const { stdout, stderr } = run(dir, ['exposure'])
    const out = stdout + stderr
    expect(out).toContain('REMOVED')
    expect(out).not.toContain('venue(s) failed')
  })

  test('and the way out of it is typed here, not pasted as a slash command', async () => {
    const dir = await configWith({ circle: { apiKey: 'x' } })
    const { stdout, stderr } = run(dir, ['exposure'])
    const out = stdout + stderr
    // The sentence lives in `src/connectors/types.ts`, which had `/forget
    // circle` written into it — so the one surface that cannot run a slash
    // command was the one printing one, about a key that can move money. A
    // connector may not ask `src/cli` how to spell it (guard.sh walks the
    // imports), so the caller hands the spelling in.
    expect(out).toContain('tula forget circle')
    expect(out).not.toContain('/forget circle')
  })
})

/**
 * `src/index.ts` already refuses to take a price-source API key on the command
 * line, because a shell history and a process list both keep it. The connect
 * prompt was telling people to pipe a venue's key in on the same command line.
 */
describe('a secret is never piped in', () => {
  test('a piped key is refused, with the reason, rather than stored', async () => {
    const dir = await configWith({})
    const { stdout, stderr, status } = run(dir, ['connect', 'kraken'], 'key\nsecret\n')
    const out = stdout + stderr
    expect(status).toBe(1)
    expect(out).toContain('history')
    expect(out).not.toContain('printf')
    expect(await stored(dir)).toEqual([])
  })

  test('a public address is not a secret, so it still connects unattended', async () => {
    const dir = await configWith({})
    const { stdout, stderr } = run(dir, ['connect', 'wallet'], 'not-an-address\n')
    const out = stdout + stderr
    // Read, and refused on what it was: the address, not the terminal.
    expect(out).not.toContain('interactive terminal')
    expect(out.toLowerCase()).toContain('address')
  })
})
