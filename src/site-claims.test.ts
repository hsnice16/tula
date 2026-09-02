import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

/**
 * Every surface that tells a user what tula will not do, held to saying the same
 * thing. These claims drifted once: the site promised the build refused an order
 * endpoint the guard never looked for, said tula "never handles key material"
 * while a connector loaded an EC private key, and said the installer refuses
 * what it cannot verify when without the GitHub CLI it installs and warns.
 *
 * Read as text, never imported: `site/` is a separate package whose dependency
 * tree must not join the binary's, and the markdown is not code at all.
 */

const read = (path: string) => readFileSync(path, 'utf8')

/**
 * Prose is hard-wrapped in the markdown and re-wrapped by the formatter in the
 * TSX, so a claim is a claim wherever the line happens to break.
 */
const flat = (path: string) => read(path).replace(/\s+/g, ' ')

/**
 * The one sentence the whole roadmap turns on. Trading is coming, so a surface
 * that says "cannot place an order" full stop is a surface that will be lying
 * on release day — and a security promise withdrawn later reads as though it
 * was never true.
 */
const CAVEAT = /placing trades will come later|trading will come later|will come later/i

const CLAIMS = [
  'site/app/security/page.tsx',
  'site/app/layout.tsx',
  'site/app/page.tsx',
  'README.md',
  'SECURITY.md',
  'ROADMAP.md',
  'src/cli/commands.ts',
  'src/agent/agent.ts',
] as const

/**
 * Wordings that were false when they were published. A near-miss edit brings
 * them back, so they are named rather than described.
 */
const RETRACTED = [
  'never handles key material',
  'No field accepts a private key',
  'or hold a private key',
  'no code path can move your money',
  'refuses a binary it cannot verify',
  'the same attested binary',
  'the same attested archive',
  'memos and protocol descriptions are attacker-controlled',
  'memo fields',
  'Expect an acknowledgement within 72 hours',
  'Nothing else is contacted to build the view',
] as const

describe('the caveat travels with the claim', () => {
  for (const path of CLAIMS) {
    test(`${path} says trading is coming`, () => {
      expect(flat(path)).toMatch(CAVEAT)
    })
  }
})

describe('retracted wordings stay retracted', () => {
  // AGENTS.md is swept but not in CLAIMS: it is instructions to a contributor,
  // not a promise to a user, so it carries the retracted list without owing the
  // reader the trading caveat. It still described the threat list that went.
  for (const path of [...CLAIMS, 'site/app/install/page.tsx', 'AGENTS.md']) {
    test(`${path} carries none of them`, () => {
      const text = flat(path)
      for (const phrase of RETRACTED) expect(text).not.toContain(phrase)
    })
  }
})

describe('the security page names enforcement that exists', () => {
  const page = read('site/app/security/page.tsx')
  const guard = read('scripts/guard.sh')

  test('the withdrawal promise is a check, not a hope', () => {
    expect(page).toContain('no withdrawal or transfer endpoint, in any connector')
    expect(guard).toContain('WithdrawCancel|Withdraw|withdraw|withdrawals')
    expect(guard).toContain('payouts|transfers')
  })

  test('the order promise is a check the build runs', () => {
    expect(page).toContain('the build fails if an order endpoint appears')
    expect(guard).toContain('an order, withdrawal or transfer endpoint is referenced in src/')
    expect(read('package.json')).toContain('scripts/guard-test.sh')
  })

  test('the model-context promise is the guard that enforces it', () => {
    expect(page).toContain('the agent layer cannot import a connector or the store')
    expect(guard).toContain('the agent layer imports the secret store')
    expect(guard).toContain('the agent layer imports a connector')
  })

  test('the one private key tula loads is named, and confined by the guard', () => {
    expect(page).toContain('Coinbase CDP key')
    expect(guard).toContain('key material is handled outside src/connectors/coinbase.ts')
  })

  test('the store promise matches the mode the store requires', () => {
    expect(page).toContain('mode 600')
    expect(read('src/secrets/store.ts')).toContain('REQUIRED_MODE = 0o600')
  })

  // The page saying so is the whole mitigation: there is no encryption to point
  // at, and a reader who assumes there is will back up the file without a care.
  test('the page says the file is not encrypted', () => {
    expect(page).toContain('Not encrypted at rest')
    expect(flat('SECURITY.md')).toContain('deliberately not encrypted')
  })

  // The card named three kinds of on-chain text tula does not read, and missed
  // both of the kinds it does. The caps are what make the claim true, and every
  // one of them lives where all seven connectors arrive.
  test('the card names both kinds of outside text, and both are bounded', () => {
    expect(page).toContain('as an Aave reserve contract returns it')
    expect(page).toContain('error text when one fails')
    const session = read('src/cli/session.ts')
    expect(session).toContain('MAX_SYMBOL')
    expect(session).toContain('MAX_REASON')
    expect(read('src/connectors/evm.ts')).toContain('MAX_SYMBOL_BYTES')
  })

  // The page and the policy file describe the same surface or one of them is
  // reassuring somebody with a list the other knows is incomplete.
  test('README and AGENTS.md name the second surface, not just the first', () => {
    for (const f of ['README.md', 'AGENTS.md']) {
      expect(flat(f)).toContain('error text')
      expect(flat(f)).toContain('capped and flattened')
    }
  })

  test('SECURITY.md names the same injection surface as the page', () => {
    const policy = flat('SECURITY.md')
    expect(policy).toContain('as an Aave reserve contract returns it')
    expect(policy).toContain("The text of a venue's error")
    expect(policy).toContain('src/cli/session.ts')
    expect(policy).toContain('No memo, NFT metadata or protocol description is read at all')
  })

  test('the policy promises a reply it can keep', () => {
    const policy = flat('SECURITY.md')
    expect(policy).not.toContain('within 72 hours')
    expect(policy).toContain('maintained by one person')
  })

  test('SECURITY.md lists the two destinations tula picks for you', () => {
    const policy = flat('SECURITY.md')
    expect(policy).toContain('ethereum-rpc.publicnode.com')
    expect(policy).toContain('tokens.uniswap.org')
    expect(policy).toContain('defaults rather than choices')
  })

  // Whole filename, not a version parsed out of it: a pre-release version has a
  // hyphen and so does every target suffix following it.
  test('the verify command names an archive of this very version', () => {
    const version = JSON.parse(read('package.json')).version
    for (const f of ['SECURITY.md', 'README.md', 'site/app/install/page.tsx']) {
      for (const named of read(f).match(/tula-v[\w.-]+\.tar\.gz/g) ?? []) {
        expect(named.startsWith(`tula-v${version}-`)).toBe(true)
      }
    }
  })

  // A hand-set boolean beside the version string had already drifted from it.
  test('the pre-release label is derived from the version, not restated', () => {
    expect(read('src/version.ts')).toContain("IS_PRE_RELEASE = APP_VERSION.includes('-')")
    const version = JSON.parse(read('package.json')).version
    expect(read('src/version.ts')).toContain(`APP_VERSION = '${version}'`)
  })

  test('the attestation claim matches what install.sh does without the GitHub CLI', () => {
    expect(flat('site/app/security/page.tsx')).toContain(
      'where it is not, it says plainly that provenance was not proven',
    )
    expect(read('install.sh')).toContain('UNVERIFIED=1')
  })
})
