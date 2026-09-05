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
const CAVEAT = /placing trades will come later/i

const CLAIMS = [
  'site/app/security/page.tsx',
  // Not layout.tsx: the site's meta description, its card and its llms.txt all
  // render one sentence held here, so this is the file the caveat has to be in.
  'site/lib/site.ts',
  'site/app/page.tsx',
  'README.md',
  'SECURITY.md',
  'ROADMAP.md',
  'src/cli/commands.ts',
  'src/agent/agent.ts',
  // The last thing printed after somebody pipes a script into their shell, and
  // the surface this list was not covering: it stated the promise flat — "it
  // cannot place an order" — which is the one form the caveat exists to prevent.
  'install.sh',
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
  // The README's paraphrase of the attestation promise. install.sh installs and
  // says so when the GitHub CLI is absent; "refuses rather than warns" is the
  // retracted claim wearing different words.
  'and refuses rather than warns',
  'the installer verifies it and refuses on failure',
  // The whole "tula: command not found" answer, addressed to the one channel
  // that had not caused it: brew and npm run no install script and write no
  // profile, and the reader of either was told their shell was merely stale.
  'the install script has just written a line to a profile',
  // Five lines follow the PATH note — the usage pair and the read-only notice —
  // so the reader sent to the last line found the security URL, not their fix.
  'its last line says which of the two you got',
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
    // Both sides lowercased: one of these had come back capitalised at the head
    // of a sentence, and a case-sensitive sweep read straight past it.
    test(`${path} carries none of them`, () => {
      const text = flat(path).toLowerCase()
      for (const phrase of RETRACTED) expect(text).not.toContain(phrase.toLowerCase())
    })
  }
})

/**
 * npm is the one channel `gh attestation verify` cannot check: the release job
 * unpacks the attested archive and republishes the binary in a tarball of npm's
 * own. Offering both channels under one promise is a promise wrong about one.
 *
 * The page now puts each channel behind a tab, so the caveat is only ever read
 * by somebody who chose npm — which is the argument for pinning it here rather
 * than trusting it to survive a rewrite of prose nobody else has to scroll past.
 */
describe('the install page keeps its channels apart', () => {
  const page = flat('site/app/install/page.tsx')

  /**
   * The page used to say npm proved nothing about who built the binary and send
   * the reader to another channel for that. `release.yml` publishes it with
   * `npm publish --provenance` under `id-token: write`, so the tarball carries
   * sigstore provenance of its own — the claim steered people away from a check
   * they had. What is true is narrower: the GitHub attestation covers the
   * release archive, and npm repacks it into something that attestation cannot
   * describe.
   */
  test('npm is named as the channel the GitHub attestation does not cover', () => {
    expect(page).toContain('npm install -g @hsnice16/tula')
    expect(page).toContain(
      'the GitHub attestation the other two channels carry does not cover this tarball',
    )
    expect(page).toContain('npm audit signatures')
    // The retracted version, by name: it read as "npm proves nothing".
    expect(page).not.toContain('No build attestation')
    expect(page).not.toContain('For proof of origin, use the install script or Homebrew')
    // And the workflow has to keep doing what the page now says it does.
    const release = flat('.github/workflows/release.yml')
    expect(release).toContain('--provenance')
    expect(release).toContain('id-token: write')
  })

  /**
   * tula now watches for releases and can replace its own binary, which is a
   * pair of powers people are right to want a promise about. The promise is the
   * same on every channel and it is pinned here rather than trusted to prose:
   * the day it stops being true, three lines on the page become a lie about
   * software that downloads and runs code on somebody's machine.
   *
   * `update()` is where it is kept — `/update` alone only ever prints a plan.
   */
  test('each channel promises an update is never installed unasked', () => {
    expect(page.match(/never installs one without asking/g)).toHaveLength(3)
  })

  test('and the command really does need a second word to install anything', () => {
    const command = flat('src/update/command.ts')
    expect(command).toContain("if (sub !== 'install')")
    expect(command).toContain('await applyUpdate(')
  })

  /**
   * Two of the three channels must decline to self-update at all: a binary that
   * swapped itself would leave brew or npm naming a version that is not running.
   */
  test('the page says so, and channel.ts is what makes it true', () => {
    expect(page).toContain('it does not install one at all')
    expect(flat('src/update/channel.ts')).toContain('if (!running.startsWith(tree + sep)) return null')
  })

  /**
   * The confirm section is below the tabs, so it answers for whichever channel
   * the reader took — and each of the three fails to be on PATH for a reason of
   * its own. Every fix it names is held to the file that makes it true, because
   * the wrong one sends somebody to edit a profile no channel of theirs wrote.
   */
  test('the not-found answer covers all three channels', () => {
    // Only a versioned formula is keg_only, which is why brew needs the link
    // step at all — and why the plain install needs no answer here.
    expect(page).toContain('is <Code>keg_only</Code>')
    expect(flat('scripts/homebrew-formula.sh')).toContain(
      '*@*) PATH_RULE=" keg_only :versioned_formula" ;;',
    )

    // npm puts a launcher on PATH because the package declares one.
    expect(page).toContain('npm prefix -g')
    expect(JSON.parse(read('package.json')).bin).toHaveProperty('tula')

    // A shell the installer does not edit falls through to the same note as
    // TULA_NO_MODIFY_PATH, which is why the page names three outcomes, not four.
    const installer = flat('install.sh')
    expect(installer).toContain("*) printf '' ;;")

    // The page quotes the notes verbatim so the reader can scan for one, which
    // only works while these are the three the installer can print.
    for (const note of ['added to', 'already in', 'add it yourself']) {
      expect(installer).toContain(`PATH_NOTE="${note}`)
      expect(page).toContain(`<Code>${note}</Code>`)
    }

    // "Near the end", never "the last line": the report goes on after it.
    expect(installer.indexOf('[ -n "$PATH_NOTE" ]')).toBeLessThan(
      installer.indexOf('tula --help every command'),
    )
  })

  /**
   * The installer needs no GitHub CLI and never has. The page said so only by
   * implication until somebody with no `gh` read it and concluded they were
   * locked out — and the fallback the page offered them was another `gh`
   * command. Whatever else that section says, it says this.
   */
  test('the page says provenance needs a CLI most readers will not have', () => {
    expect(page).toContain('Most people do not have the GitHub CLI, and nothing here requires it')
  })

  test('and that is still what the release actually does to it', () => {
    expect(read('scripts/npm-pack.sh')).toContain('tar -xzf "$RELEASE/tula-v$VERSION-$name.tar.gz"')
  })

  // The installer unpacks into a mktemp dir under a trap, so the reader running
  // the verify line has no archive unless the page tells them to fetch one —
  // and a verification that fails for a missing file reads like a rejected one.
  test('the verify block downloads the archive it verifies', () => {
    // The page spends a whole legend on why these two flags matter, so the one
    // download it asks somebody to make by hand carries them too.
    expect(page).toContain("curl --proto '=https' --tlsv1.2 -fLO")
    expect(read('install.sh')).toContain("curl --proto '=https' --tlsv1.2 -fLO $BASE/$ARCHIVE")
  })
})

/**
 * The formula's `test do` block runs on someone else's machine, at `brew test`
 * and on every tap audit, and it is the one claim in this repository no local
 * gate executes. It had already drifted: it asserted "cannot place an order"
 * long after `/about` was reworded to "places no order for the moment", so the
 * Homebrew channel would have failed its own test on release day.
 */
describe('the Homebrew formula tests a string the binary prints', () => {
  test('every assert_match over `tula about` appears in the about copy', () => {
    const formula = read('scripts/homebrew-formula.sh')
    const asserted = [...formula.matchAll(/assert_match "([^"]+)", shell_output\("#\{bin\}\/tula about"\)/g)]
    expect(asserted.length).toBeGreaterThan(0)
    const about = flat('src/cli/commands.ts')
    for (const match of asserted) expect(about).toContain(match[1] ?? '')
  })
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
  // one of them lives where every connector arrives.
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
