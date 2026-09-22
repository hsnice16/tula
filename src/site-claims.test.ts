import { describe, expect, test } from 'bun:test'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { DEPLOYMENTS } from './connectors/aave.js'
import { CHAINS } from './connectors/chains.js'
import { CONNECTORS } from './connectors/registry.js'
import { RETIRED_VENUES } from './connectors/types.js'
import { REPO_URL } from './version.js'

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

/** The pages written for a search, each linked from the footer's Guides row. */
const GUIDES = [
  'site/app/liquidation-risk/page.tsx',
  'site/app/exposure/page.tsx',
  'site/app/hyperliquid/page.tsx',
  'site/app/aave/page.tsx',
  'site/app/kraken/page.tsx',
  'site/app/binance/page.tsx',
  'site/app/coinbase/page.tsx',
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
  // Unqualified, over a tree that names `/0/private/WithdrawMethods` — and a
  // reader who greps for that word finds it in the file the sentence promised
  // it was not in. What is true is narrower: no endpoint that moves funds.
  'no withdrawal or transfer endpoint',
  // Kraken exposes exactly one, and `verifyScope` has called it since the venue
  // shipped: a refusal from an endpoint gated on Withdraw Funds is the proof
  // that turns the key away.
  "Kraken exposes no endpoint that reports a key's permissions",
  // install.sh passes `--signer-workflow`, and SECURITY.md says that pin is not
  // optional. A contributor reading this would re-add a flag that is there, or
  // drop it as redundant. What is true is release.yml's own account of the
  // residual risk: the workflow is pinned and the ref it ran from is not.
  'accepts any archive carrying one for this repository',
  // Two channels are `vars.`-gated and skip rather than fail, and release.yml
  // carries a step whose whole purpose is to warn that they did.
  'nothing is published half-done',
  'the same attested binary',
  'the same attested archive',
  // npm reads a 0.x minor as breaking, so `npm update` stays on the old one.
  'npm update',
  'memos and protocol descriptions are attacker-controlled',
  'memo fields',
  'Expect an acknowledgement within 72 hours',
  'Nothing else is contacted to build the view',
  // The one-chain release's wordings. Chain scope was published on six surfaces
  // and pinned by nothing, so every one of them went on saying Ethereum for a
  // wave after Arbitrum One and Base shipped.
  'a public Ethereum node and token list',
  'Ethereum only',
  'Aave on Arbitrum / Base',
  'across all four of its markets',
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
  // The check ran once a day until it moved to every shell start.
  'once a day',
  // Binance's futures permission grants futures *trading*, so `verifyScope`
  // refuses any key that could read them: the page advertised a capability the
  // connector's own comment said was unreachable, and README said the opposite.
  'USD-M futures',
  // Aave removed stable-rate borrowing in v3.2. A gap that names a product the
  // venue no longer offers cannot hide a liquidation.
  'stable-rate debt',
  // Hyperliquid documents the 95% trigger for portfolio margin only. The
  // unified ratio's 95% is the app's wording, and saying the docs publish it
  // would be citing a source that does not say it.
  'Unified Account Ratio passes 95%.',
  // Kraken proves trade access now, so no surface may send a reader away
  // believing only withdrawal is checked.
  'read balances but never withdraw',
] as const

describe('the caveat travels with the claim', () => {
  for (const path of CLAIMS) {
    test(`${path} says trading is coming`, () => {
      expect(flat(path)).toMatch(CAVEAT)
    })
  }
})

describe('retracted wordings stay retracted', () => {
  // AGENTS.md and CONTRIBUTING.md are swept but not in CLAIMS: they are
  // instructions to a contributor, not a promise to a user, so they carry the
  // retracted list without owing the reader the trading caveat. Both still
  // described mechanisms the workflow does not have — a contributor acting on
  // one would restore a check that is there, or drop it as redundant.
  for (const path of [...CLAIMS, 'site/app/install/page.tsx', ...GUIDES, 'AGENTS.md', 'CONTRIBUTING.md']) {
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
 * The page puts each channel behind a tab, so the caveat is only ever read
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
      'npm repackages the binary, so the GitHub attestation does not cover it',
    )
    expect(page).toContain('npm audit signatures')
    // The retracted version, by name: it read as "npm proves nothing".
    expect(page).not.toContain('No build attestation')
    expect(page).not.toContain('For proof of origin, use the install script or Homebrew')
    // And the workflow has to keep doing what the page says it does.
    const release = flat('.github/workflows/release.yml')
    expect(release).toContain('--provenance')
    expect(release).toContain('id-token: write')
  })

  /**
   * tula watches for releases and can replace its own binary, which is a
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

  /**
   * The page spends a legend on three flags — HTTPS only including on redirect,
   * nothing below TLS 1.2, and stop on an HTTP error rather than pipe the error
   * page into a shell. The install line carries them where the reader can see
   * them; the fetches the script then makes on its own are the ones nobody
   * reads, and they are the ones pulling the binary. One of them dropping a
   * flag would be invisible from the page making the promise.
   */
  test('every fetch install.sh makes carries the flags the page legends', () => {
    // An invocation is `curl` followed by a flag: the commented example in the
    // header is not one, and neither is `need curl`. The line printed for the
    // reader to run by hand is one, and has to carry them too.
    const calls = [...read('install.sh').matchAll(/^[^#\n]*\bcurl\s+(-.*)$/gm)].map((m) => m[1] ?? '')
    expect(calls.length).toBeGreaterThan(3)
    for (const flags of calls) {
      expect({ flags, https: flags.includes("--proto '=https'") }).toEqual({ flags, https: true })
      expect({ flags, tls: flags.includes('--tlsv1.2') }).toEqual({ flags, tls: true })
      // `-f` rides in a cluster: -fsSL, -fSL, -fLO.
      expect({ flags, failFast: /\s-[a-zA-Z]*f/.test(flags) }).toEqual({ flags, failFast: true })
    }
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

/**
 * The venue roster is one of the site's load-bearing claims and was pinned by
 * nothing: `llms.txt` states it in prose and `lib/site.ts` carries it as the
 * keyword list, and both went on naming Circle Mint after the build stopped
 * offering it. A page that lists a venue tula will not connect sends somebody to
 * make a key for it, which is the connect screen's failure moved onto the web.
 */
describe('the site publishes the venues this build ships', () => {
  const SHIPPED = [...CONNECTORS.keys()]

  /** The two surfaces that state the whole roster; the rest name a venue in passing. */
  const ROSTER = ['site/app/llms.txt/route.ts', 'site/lib/site.ts'] as const

  test('the roster is the one the build registers, so no sweep runs over an empty list', () => {
    expect(SHIPPED.length).toBeGreaterThan(5)
    expect(RETIRED_VENUES.length).toBeGreaterThan(0)
  })

  for (const path of ROSTER) {
    test(`${path} names every venue that ships, so a new one cannot go unpublished`, () => {
      const text = read(path).toLowerCase()
      for (const venue of SHIPPED) {
        expect({ venue, named: text.includes(venue) }).toEqual({ venue, named: true })
      }
    })

    test(`${path} names no venue tula dropped, so a removed one stops being offered`, () => {
      const text = read(path).toLowerCase()
      for (const venue of RETIRED_VENUES) {
        expect({ venue, named: text.includes(venue) }).toEqual({ venue, named: false })
      }
    })
  }
})

/**
 * Chain scope, held to `src/connectors/chains.ts`.
 *
 * The roster above pins which venues ship; nothing pinned which chains they are
 * read on, and that is exactly what rotted. Arbitrum One and Base landed and six
 * surfaces went on publishing one chain — the README's own Status table carried
 * a row reading "Aave on Arbitrum / Base — not yet", `SECURITY.md` named a
 * single node in the list of everything tula contacts, and `AGENTS.md` told the
 * next agent to set a variable that is now an alias.
 *
 * So the claim is a rendering of `CHAINS`, not a sentence somebody keeps in
 * step: adding a chain to the registry changes the phrase and every surface
 * fails until it is written down, and removing one fails the same way.
 */
describe('the docs publish the chains this build reads', () => {
  /** "Ethereum, Arbitrum One and Base" — how prose lists them, not how code joins them. */
  const listed = (names: readonly string[]): string =>
    names.length < 2
      ? (names[0] ?? '')
      : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`

  const CHAIN_PHRASE = listed(CHAINS.map((c) => c.name))

  /** Every surface stating what tula reads or what it contacts. */
  const SURFACES = [
    'README.md',
    'SECURITY.md',
    'AGENTS.md',
    'site/app/security/page.tsx',
    'site/app/llms.txt/route.ts',
    'site/app/aave/page.tsx',
  ] as const

  test('there are chains to sweep for, so no assertion below runs over an empty list', () => {
    expect(CHAINS.length).toBeGreaterThan(1)
    expect(CHAIN_PHRASE).toContain(' and ')
  })

  for (const path of SURFACES) {
    test(`${path} names every chain and no chain beyond them`, () => {
      expect({ path, phrase: CHAIN_PHRASE, present: flat(path).includes(CHAIN_PHRASE) }).toEqual({
        path,
        phrase: CHAIN_PHRASE,
        present: true,
      })
    })
  }

  /**
   * The variables are the half a reader acts on, and the one-chain name is still
   * live as Ethereum's alias — so this is a set on both sides. A new chain whose
   * variable nobody wrote down fails, and so does a variable left behind by a
   * chain that went.
   */
  test('AGENTS.md names the RPC variable of every chain, and none that is not one', () => {
    const stated = new Set(flat('AGENTS.md').match(/TULA_[A-Z]+_RPC/g) ?? [])
    expect([...stated].sort()).toEqual([...new Set(CHAINS.flatMap((c) => c.rpcEnv))].sort())
  })

  /**
   * `SECURITY.md` is the page a reader checks before pointing this at their net
   * worth, and its promise is that the list is everything. A node contacted but
   * unlisted is the failure; a node listed but no longer contacted is the same
   * page describing a build that does not exist.
   *
   * Per chain, not as one set, because a fallback is only disclosed if the
   * reader can tell which chain would reach it — and a URL that moved from one
   * chain's line to another's would pass a set comparison unchanged.
   */
  for (const chain of CHAINS) {
    test(`SECURITY.md lists every ${chain.name} node, and no node beyond them`, () => {
      const line = flat('SECURITY.md').match(
        new RegExp(`- ${chain.name} — ((?:\`https://[^\`]+\`(?:, )?)+)`),
      )
      expect(line).not.toBeNull()
      const listed = [...(line?.[1]?.match(/https:\/\/[^`]+/g) ?? [])].sort()
      expect(listed).toEqual([...chain.defaultRpcs].sort())
    })
  }

  /**
   * Ethereum's Core, Prime, EtherFi and Horizon, plus one deployment on every
   * other chain. The count is the part of the Aave claim a reader can check
   * against their own account, and the part that drifts when a market is added.
   */
  test('the market count is the number of deployments in the build', () => {
    const WORDS: Record<number, string> = {
      ...{ 4: 'four', 5: 'five', 6: 'six', 7: 'seven', 8: 'eight', 9: 'nine', 10: 'ten' },
      ...{ 11: 'eleven', 12: 'twelve', 13: 'thirteen', 14: 'fourteen' },
    }
    const word = WORDS[DEPLOYMENTS.length]
    expect({ markets: DEPLOYMENTS.length, word }).toEqual({
      markets: DEPLOYMENTS.length,
      word: expect.any(String),
    })
    for (const path of ['README.md', 'site/app/llms.txt/route.ts', 'site/app/aave/page.tsx']) {
      expect({ path, states: flat(path).includes(`across ${word} markets`) }).toEqual({
        path,
        states: true,
      })
    }
  })
})

describe('the security page names enforcement that exists', () => {
  const page = read('site/app/security/page.tsx')
  const guard = read('scripts/guard.sh')

  /**
   * The property, not the sentence and not the guard's regex re-typed. Both of
   * those were pinned here, and between them they said only that two strings
   * were still where somebody left them — while the page promised "no withdrawal
   * or transfer endpoint, in any connector" over a tree that names
   * `/0/private/WithdrawMethods`, which is the string a sceptical reader greps.
   *
   * What holds is that every endpoint a connector names either moves nothing or
   * is listed below with the reason it cannot, and that the guard still fails on
   * one that is neither.
   */
  test('no connector names an endpoint that moves funds', () => {
    // Reads, despite the word in its name. One entry apiece, reviewed on the
    // venue's own documentation — a new one is a decision, not an exemption.
    const READS_ANYWAY: Record<string, string> = {
      '/0/private/WithdrawMethods':
        'lists the methods a key could withdraw by and moves nothing. Kraken gates it on ' +
        'Withdraw Funds, so a success is how verifyScope proves the key holds that ' +
        'permission — and refuses it.',
    }

    // Leading segment of a path component: `WithdrawMethods` matches, and so
    // would `WithdrawStatus`, which is the point — each has to be looked at.
    const MOVES =
      /^(withdraw|payout|transfer|refund|order|addorder|cancelorder|cancelall|editorder|exchange)/i
    const named = new Set<string>()
    for (const file of readdirSync('src/connectors')) {
      if (!file.endsWith('.ts') || file.endsWith('.test.ts')) continue
      for (const match of read(`src/connectors/${file}`).matchAll(/['"](\/[^'"\s]*)['"]/g)) {
        const literal = match[1] ?? ''
        if (literal.split(/[/?]/).some((segment) => MOVES.test(segment))) named.add(literal)
      }
    }

    expect([...named].filter((literal) => !(literal in READS_ANYWAY))).toEqual([])
    // A reason for an endpoint nothing calls any more is a reason nobody rereads.
    for (const literal of Object.keys(READS_ANYWAY)) {
      expect({ literal, named: named.has(literal) }).toEqual({ literal, named: true })
    }

    // And the page states the promise flatly, because funds leaving a venue is
    // the one thing that never becomes possible later.
    expect(page).toContain('No code path can move funds off a venue')
    expect(page).toContain('no endpoint that moves funds, in any connector')
    // The guard is what fails a build that adds one, and guard-test.sh plants
    // both shapes on every run rather than trusting the regex to still match.
    const guardTest = read('scripts/guard-test.sh')
    expect(guardTest).toContain("const p = '/0/private/AddOrder'")
    expect(guardTest).toContain("const p = '/sapi/v1/capital/withdraw/apply'")
  })

  /**
   * The exemption above rests on where it is called from, not on its name: an
   * endpoint gated on Withdraw Funds is proof of the permission at connect and
   * nothing tula should reach for on a read.
   */
  test('the one withdraw-named endpoint is reached only from verifyScope', () => {
    const kraken = read('src/connectors/kraken.ts')
    const body = kraken.slice(
      kraken.indexOf('async verifyScope('),
      kraken.indexOf('async fetchPositions('),
    )
    expect(body).toContain('WITHDRAW_METHODS')
    const uses = kraken.split('WITHDRAW_METHODS').length - 1
    // The declaration, and the one call inside verifyScope.
    expect({ uses, inVerifyScope: body.split('WITHDRAW_METHODS').length - 1 }).toEqual({
      uses: 2,
      inVerifyScope: 1,
    })
  })

  test('the order promise is a check the build runs', () => {
    expect(page).toContain('the build fails if an order endpoint appears')
    expect(guard).toContain('an order, withdrawal or transfer endpoint is referenced in src/')
    expect(read('package.json')).toContain('scripts/guard-test.sh')
  })

  test('the model-context promise is the guard that enforces it', () => {
    expect(page).toContain('the agent layer cannot import a connector or the store')
    // The property, not the sentence it is reported in. This pinned two `report`
    // strings and so pinned the weakest possible check: two greps of src/agent's
    // own text, which a re-export, a reach through a module that holds
    // credentials, a specifier built at runtime, or renaming the directory each
    // walked straight past. What has to survive a rewording is where the walk
    // starts and what it refuses to reach.
    expect(guard).toContain('for f in src/agent/')
    expect(guard).toContain('src/secrets/* | src/connectors/*')

    // And that it still fires. guard-test.sh plants each of those four ways
    // through and fails unless guard.sh names them; CI runs it beside guard.sh
    // for exactly this reason, so the promise rests on a run, not on a regex
    // somebody read once.
    const guardTest = read('scripts/guard-test.sh')
    expect(guardTest).toContain("export { load } from '../secrets/store.js'")
    expect(guardTest).toContain("import type { Session } from '../cli/session.js'")
    expect(guardTest).toContain('await import(process.env')
    expect(guardTest).toContain('mv src/agent')
  })

  /**
   * A helper named in a promise can go unwritten while the promise stands, so
   * what has to survive a rewording is the check the guard runs — and that
   * `guard-test.sh` still plants a leak it has to catch.
   */
  test('the promise that a credential never reaches a log is a check, not a habit', () => {
    expect(read('SECURITY.md')).toContain(
      'no module that holds a credential may hand one to a log, an\n   error, a file or another process',
    )
    expect(guard).toContain('a credential reaches a log, an error, a file or another process in')
    expect(guard).toContain('src/secrets can log, spawn or reach the network')
    const guardTest = read('scripts/guard-test.sh')
    expect(guardTest).toContain('console.log(c)')
    expect(guardTest).toContain("process.env['LEAK']")
  })

  /**
   * Which permission a venue cannot prove is a fact about the connector —
   * `unprovable` — and three surfaces restate it in prose. README said Kraken
   * "exposes no endpoint that reports a key's permissions" for as long as
   * `verifyScope` had been proving `canWithdraw` three ways off one, which
   * under-sold the only check that turns a key away.
   */
  test('the venues named as unprovable are the ones the build cannot prove', () => {
    const cannotProve = [...CONNECTORS.values()]
      .filter((connector) => (connector.unprovable ?? []).length > 0)
      .map((connector) => [connector.venue.id, [...(connector.unprovable ?? [])].sort()])
    expect(cannotProve).toEqual([['stripe', ['trade', 'withdraw']]])

    // Stripe is the only one left, so no surface may name another venue as the
    // one tula cannot check — least of all Kraken, which now reports the lot.
    for (const path of ['README.md', 'site/app/security/page.tsx', 'site/app/llms.txt/route.ts']) {
      expect({ path, says: flat(path).includes('Kraken proves a key cannot') }).toEqual({
        path,
        says: false,
      })
    }
    expect(flat('site/app/llms.txt/route.ts')).toContain('Stripe, for both powers')
  })

  test('the one private key tula loads is named, and confined by the guard', () => {
    expect(page).toContain('Coinbase CDP key')
    expect(guard).toContain('key material is handled outside src/connectors/coinbase.ts')
  })

  test('the store promise matches the mode the store requires', () => {
    expect(page).toContain('mode 600')
    expect(read('src/secrets/store.ts')).toContain('REQUIRED_MODE = 0o600')
  })

  /**
   * The history file is a second file of the reader's own words beside the
   * keys, and every promise made about it is a check somewhere: the mode and
   * the refusals in the module, the one caller and the store kept out of reach
   * in the guard — planted against in guard-test.sh — and the lines never kept
   * in tests that type them and read the file.
   */
  test('the history promise is the module, the guard and the tests behind it', () => {
    const policy = flat('SECURITY.md')
    expect(policy).toContain('What a stored line reveals is an address and questions about your book')
    expect(policy).toContain('`TULA_NO_HISTORY=1` keeps nothing at all')
    expect(flat('site/app/security/page.tsx')).toContain('TULA_NO_HISTORY=1 keeps nothing')

    const history = read('src/history/history.ts')
    expect(history).toContain('REQUIRED_MODE = 0o600')
    expect(history).toContain('O_NOFOLLOW')
    expect(history).toContain("Boolean(process.env['TULA_NO_HISTORY'])")
    expect(history).not.toMatch(/from '\.\.\/secrets\//)

    expect(guard).toContain('reaches the history write, which only src/ui/app.tsx may call')
    expect(guard).toContain('WALKING="src/history"')
    const guardTest = read('scripts/guard-test.sh')
    expect(guardTest).toContain("import { recordHistory } from '../history/history.js'")
    expect(guardTest).toContain('the history writer importing the credential store')

    expect(read('src/history/history.test.ts')).toContain('.githooks/scan-staged')
    const screen = read('src/ui/screen.test.ts')
    expect(screen).toContain("expect(lines).toEqual(['/noted connect', '/noted disconnect', '/help'])")
    expect(read('src/cli/oneshot.test.ts')).toContain("existsSync(join(dir, 'history.jsonl'))")
  })

  // The page saying so is the whole mitigation: there is no encryption to point
  // at, and a reader who assumes there is will back up the file without a care.
  test('the page says the file is not encrypted', () => {
    expect(page).toContain('Not encrypted at rest')
    expect(flat('SECURITY.md')).toContain('deliberately not encrypted')
  })

  // The card named three kinds of on-chain text tula does not read, and missed
  // both of the kinds it does. The caps are what make the claim true, and every
  // one of them lives where the text enters.
  test('the outside text the surfaces name is bounded where it enters', () => {
    expect(read('src/cli/session.ts')).toContain('MAX_SYMBOL')
    // The error cap moved to core/errors.ts, so whatever received the text can
    // apply it as it enters rather than every render site remembering to.
    expect(read('src/core/errors.ts')).toContain('MAX_REMOTE')
    expect(read('src/connectors/evm.ts')).toContain('MAX_SYMBOL_BYTES')
    expect(flat('README.md')).toContain('capped and flattened')
    expect(flat('AGENTS.md')).toContain('flattened to one line')
  })

  /**
   * A surface naming fewer sources than the build has is reassuring somebody
   * with a list it knows is incomplete — the rule this file already applied to
   * `SECURITY.md` alone, while the page, README and AGENTS.md each named two
   * symbol sources and only a venue's error text. One release added both of the
   * missing ones, so all three were wrong at once and the suite stayed green.
   *
   * Each source is required of the prose only while it is in the build: the
   * evidence is what a reader would grep for, so a source that goes takes its
   * requirement with it rather than leaving a caveat about nothing.
   */
  describe('every surface names the whole untrusted-text surface', () => {
    const SOURCES = [
      {
        source: 'the token list a wallet read names its ERC-20s by',
        evidence: ['src/connectors/wallet.ts', 'symbol: token.symbol'],
        named: 'the configured token list names it',
      },
      {
        source: 'the symbol an Aave reserve contract returns over an RPC node',
        evidence: ['src/connectors/evm.ts', 'MAX_SYMBOL_BYTES'],
        named: 'Aave reserve contract returns it',
      },
      {
        // A price source is not a venue — `connectors/types.ts` says so — and
        // its error reaches the screen and the model by the same `remote()`.
        source: "a price source's own error text",
        evidence: ['src/prices/cryptocompare.ts', 'remote(body.Message)'],
        named: 'a venue or a price source',
      },
      {
        // The one that is nobody's venue. It went into the build with the cap
        // and reached only two of the four surfaces below, because this list
        // was not extended with it — which is the exact release shape the
        // docstring above describes, happening again.
        source: "the model provider's own error text",
        evidence: ['src/agent/agent.ts', 'remote(err.message)'],
        named: 'the model provider',
      },
      {
        // Its deployer chooses it, and it becomes the venue label on every row
        // that dex holds — a label, so no symbol cap reaches it.
        source: "a Hyperliquid builder dex's name",
        evidence: ['src/connectors/hyperliquid.ts', 'DEX_NAME.test('],
        named: 'Hyperliquid builder dex name',
      },
    ] as const

    for (const { source, evidence } of SOURCES) {
      const [module, proof] = evidence
      test(`${source} is in the build`, () => {
        expect({ module, reaches: read(module).includes(proof) }).toEqual({ module, reaches: true })
      })
    }

    for (const path of ['site/app/security/page.tsx', 'README.md', 'SECURITY.md', 'AGENTS.md']) {
      test(`${path} names every one of them`, () => {
        const text = flat(path)
        for (const { source, named } of SOURCES) {
          expect({ path, source, names: text.includes(named) }).toEqual({ path, source, names: true })
        }
      })
    }
  })

  test('SECURITY.md names the same injection surface as the page', () => {
    const policy = flat('SECURITY.md')
    expect(policy).toContain('as an Aave reserve contract returns it')
    // A price source is not a venue — `connectors/types.ts` says so — and its
    // error reaches the screen and the model by the same path, so the claim
    // has to name both or it under-describes its own surface.
    expect(policy).toContain('The text of an error from a venue or a price source')
    expect(policy).toContain('src/core/errors.ts')
    expect(policy).toContain('src/cli/session.ts')
    expect(policy).toContain('No memo, NFT metadata or protocol description is read at all')
  })

  /**
   * The site names the model vendor in one place on purpose — egress, where the
   * reader needs the specific destination — and AGENTS.md says which pages do.
   * It said two and named the install page, which names neither the vendor nor
   * `ANTHROPIC_API_KEY`, so the rule described a page that did not exist.
   */
  test('the pages that name the model vendor are the pages AGENTS.md says do', () => {
    // The three directories guard.sh holds to the same language rule as src/,
    // which is the whole of the site's own source.
    const naming = ['app', 'components', 'lib']
      .flatMap((dir) =>
        readdirSync(`site/${dir}`, { recursive: true })
          .filter((entry) => typeof entry === 'string' && /\.tsx?$/.test(entry))
          .map((entry) => `site/${dir}/${entry}`),
      )
      .filter((path) => read(path).includes('Anthropic'))
    expect(naming).toEqual(['site/app/security/page.tsx'])
    expect(flat('AGENTS.md')).toContain('One page names Anthropic and needs to: the security page')
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

  /**
   * The automatic check is `pendingUpdate()`, and the shell is its only caller —
   * so `tula exposure` in a cron job never contacts GitHub. Four surfaces once
   * stated the cadence with nothing beside it, which reads as something the
   * binary does wherever it runs, and it is the one egress claim a reader can
   * check only by watching their own network.
   */
  test('the startup GitHub check is claimed only where it runs', () => {
    const callers = readdirSync('src', { recursive: true })
      .filter((entry) => typeof entry === 'string' && /\.tsx?$/.test(entry))
      .map((entry) => `src/${entry}`)
      .filter((path) => !path.endsWith('.test.ts') && !path.endsWith('.test.tsx'))
      .filter((path) => path !== 'src/update/check.ts' && read(path).includes('pendingUpdate('))
    expect(callers).toEqual(['src/ui/app.tsx'])

    for (const path of [
      'README.md',
      'SECURITY.md',
      'site/app/security/page.tsx',
      'site/app/install/page.tsx',
    ]) {
      // A surface that stopped making the claim would otherwise pass by saying
      // nothing, and this list is the set of surfaces that owe the reader it.
      const spans = flat(path).match(/.{0,160}each time.{0,160}opens.{0,160}/g) ?? []
      expect({ path, claims: spans.length > 0 }).toEqual({ path, claims: true })
      for (const span of spans) {
        expect({ path, span, saysWhere: /shell/i.test(span) }).toEqual({
          path,
          span,
          saysWhere: true,
        })
      }
    }
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

  /**
   * The verify command is pinned to a workflow, not just to a repository: every
   * workflow holding `attestations: write` can mint a signature, so `--repo`
   * alone accepts one from any change somebody proposes to CI. Both docs that
   * explain the dry run described the weaker check and would send a contributor
   * to remove the flag as redundant.
   */
  test('the attestation is pinned to the workflow, everywhere that describes it', () => {
    expect(read('install.sh')).toContain(
      "--signer-workflow \"$REPO/.github/workflows/release.yml\"",
    )
    expect(flat('SECURITY.md')).toContain('`--signer-workflow` is not optional')
    // The residual risk release.yml names, and the one the two contributor docs
    // now name instead of a check install.sh does not skip.
    for (const path of ['CONTRIBUTING.md', 'AGENTS.md', '.github/workflows/release.yml']) {
      expect({ path, states: flat(path).includes('the ref it ran from') }).toEqual({
        path,
        states: true,
      })
    }
  })

  /**
   * `release.yml` publishes npm and Homebrew from jobs that skip when their
   * `vars.` gate is unset, and carries a step whose only job is to warn that a
   * green release published to fewer channels than the install page names.
   * CONTRIBUTING said the opposite of all of it.
   */
  test('the release doc describes the channels the workflow actually gates', () => {
    const workflow = read('.github/workflows/release.yml')
    const contributing = flat('CONTRIBUTING.md')
    for (const gate of ['vars.PUBLISH_NPM', 'vars.PUBLISH_HOMEBREW']) {
      expect({ gate, inWorkflow: workflow.includes(gate) }).toEqual({ gate, inWorkflow: true })
      expect({ gate, inDoc: contributing.includes(gate) }).toEqual({ gate, inDoc: true })
    }
    expect(workflow).toContain('environment: release')
    expect(contributing).toContain('`release` environment')
    expect(workflow).toContain('git merge-base --is-ancestor')
    expect(contributing).toContain('ancestor of')
  })

  test('the attestation claim matches what install.sh does without the GitHub CLI', () => {
    expect(flat('site/app/security/page.tsx')).toContain(
      'without it, it says that was not proven',
    )
    expect(read('install.sh')).toContain('UNVERIFIED=1')
  })

  // Matched by shape, not by spelling. RETRACTED holds this claim as the exact
  // string "and refuses rather than warns", and install.sh's own header carried
  // it for four releases as "and the script refuses rather than warns" — the
  // retracted promise with two words in the middle, passing the sweep by a near
  // miss, which is the failure mode that sweep exists to catch. Scoped to the
  // surfaces describing the installer: elsewhere the same words are true about
  // something else — an over-scoped key is refused rather than warned about.
  test('no surface about the installer says it refuses what it cannot verify', () => {
    for (const path of ['install.sh', 'README.md', 'site/app/install/page.tsx']) {
      expect(flat(path)).not.toMatch(/refus\w*[^.]{0,40}\b(rather than|instead of)\s+warn/i)
      expect(flat(path)).not.toMatch(/refus\w*[^.]{0,30}\bcannot verify/i)
    }
  })
})

/**
 * README sends a reader to SECURITY.md for every host tula contacts and what
 * each sees. A host requested and not named there is the failure; one named and
 * requested by nothing describes a build that does not exist.
 *
 * Every `https://` literal in a module that reaches the network is classed as
 * requested or printed — a help link, a line of a message, a citation — and one
 * that is neither fails, so a new kind of URL is a decision rather than a miss.
 * The chain registry is read as data: its nodes sit in arrays, not constants.
 */
describe('SECURITY.md names every host the binary contacts', () => {
  const hostOf = (url: string): string => new URL(url).host

  const requested = new Set<string>()
  const unclassed: string[] = []
  for (const dir of ['src/connectors', 'src/prices', 'src/agent', 'src/update']) {
    for (const file of readdirSync(dir)) {
      const path = `${dir}/${file}`
      if (!file.endsWith('.ts') || file.endsWith('.test.ts') || path === 'src/connectors/chains.ts') continue
      const text = read(path)
      const hosts = new Map([...text.matchAll(/^(?:export )?const (\w+) = '([a-z0-9.-]+)'$/gm)].map((m) => [m[1], m[2]]))
      for (const [n, line] of text.split('\n').entries()) {
        if (!line.includes('https://')) continue
        const trimmed = line.trim()
        if (/^(\*|\/\/|\/\*)/.test(trimmed) || /\burl: '/.test(line) || /^'\s{2,}/.test(trimmed)) continue
        const constant = /^(?:export )?const \w+ = '(https:\/\/[^']+)'$/.exec(trimmed)?.[1]
        const inline = /request\(['`](https:\/\/[^'`$]+)/.exec(line)?.[1]
        const hosted = hosts.get(/request\(`https:\/\/\$\{(\w+)\}/.exec(line)?.[1] ?? '')
        const url = constant ?? inline ?? (hosted ? `https://${hosted}` : undefined)
        if (url) requested.add(hostOf(url))
        else unclassed.push(`${path}:${n + 1}`)
      }
    }
  }
  for (const chain of CHAINS) {
    for (const url of [...chain.defaultRpcs, chain.defaultTokenList]) requested.add(hostOf(url))
  }
  if (read('src/update/check.ts').includes('request(`${REPO_URL}')) requested.add(hostOf(REPO_URL))

  const policy = read('SECURITY.md')
  const egress = policy.slice(policy.indexOf('## Where your data goes'), policy.indexOf('## Verifying a release'))
  const named = new Set([...egress.matchAll(/`https:\/\/([^/`\s]+)[^`]*`/g)].map((m) => m[1] ?? ''))

  test('the sweep finds the hosts it has to, so an empty collector cannot pass', () => {
    for (const host of ['api.hyperliquid.xyz', 'api.coinbase.com', 'api.anthropic.com', 'github.com', 'tokens.uniswap.org']) {
      expect({ host, requested: requested.has(host) }).toEqual({ host, requested: true })
    }
    expect(egress).toContain('Everything tula contacts')
  })

  test('every https:// literal in those modules is either requested or printed', () => {
    expect(unclassed).toEqual([])
  })

  test('every host requested is named', () => {
    expect([...requested].filter((host) => !named.has(host)).sort()).toEqual([])
  })

  test('every host named is requested', () => {
    expect([...named].filter((host) => !requested.has(host)).sort()).toEqual([])
  })
})

/**
 * `## [Unreleased]` ships as the release notes verbatim, so it is a surface a
 * user reads and not a working file. Only that section is held here: below it is
 * history, and a claim true of the release it describes must not start failing
 * because the build moved on.
 */
describe('the release notes agree with the build they describe', () => {
  const notes = read('CHANGELOG.md')

  /**
   * The notes describing the build in this tree: `Unreleased` while work is
   * going on, and the newest dated section once `release-cut.sh` has closed it.
   *
   * The first with a body, rather than `Unreleased` by name. The cut empties
   * that section and *then* runs this gate, so reading it by name made every
   * assertion below pass over nothing on the one commit they most need to
   * check — the release itself. It failed loudly here only because the sweep
   * that counts what it found was written the same day.
   */
  const unreleased =
    notes
      .split(/^## \[/m)
      .slice(1)
      .map((part) => `## [${part}`)
      .find((part) => part.replace(/^## \[[^\n]*\n/, '').trim() !== '') ?? ''

  test('there are notes to read, so nothing below runs over nothing', () => {
    expect(unreleased.length).toBeGreaterThan(0)
  })

  /**
   * The notes listed Stripe among the venues that cannot prove a free figure
   * and, further down, carried the entry that had just stopped it doing that —
   * two paragraphs of one release contradicting each other about one venue.
   * `hides: 'availability'` is the declaration that makes a free figure
   * unprovable, so the venues are read off the connectors rather than retyped.
   */
  test('the venues that cannot prove a free figure are the ones that declare it', () => {
    const declared = [...CONNECTORS.values()]
      .filter((c) => c.coverage?.doesNotRead.some((gap) => gap.hides === 'availability'))
      .map((c) => c.venue.name)
      .sort()
    expect(declared).toEqual(['Kraken'])

    const claim = 'Where the venue does not report enough to prove a free figure'
    const start = unreleased.indexOf(claim)
    // A release that no longer makes the claim owes nothing here.
    if (start < 0) return
    const sentence = unreleased.slice(start, unreleased.indexOf('. ', start))
    const named = [...CONNECTORS.values()]
      .map((c) => c.venue.name)
      .filter((name) => sentence.includes(name))
      .sort()
    expect({ named, sentence }).toEqual({ named: declared, sentence })
  })

  /**
   * `aave-core` was cited as a label a reader would see. The build gives
   * Ethereum's Core market the bare `aave` id; the string exists in one
   * synthetic test row and nowhere a user could ever meet it.
   */
  test('every Aave market label the notes quote is one the build emits', () => {
    const connector = read('src/connectors/aave.ts')
    // Non-vacuity is proven against the whole file, not against this release: a
    // release need not mention Aave, and requiring one to would make the next
    // release that does not the thing that fails. What must not happen is the
    // pattern quietly matching nothing anywhere.
    expect((notes.match(/`aave-[a-z]+`/g) ?? []).length).toBeGreaterThan(0)
    const quoted = [...new Set((unreleased.match(/`aave-[a-z]+`/g) ?? []).map((m) => m.slice(1, -1)))]
    for (const label of quoted) {
      const suffix = label.slice('aave-'.length)
      expect({ label, emitted: connector.includes(`\${AAVE.id}-${suffix}`) }).toEqual({
        label,
        emitted: true,
      })
    }
  })
})

/**
 * What a crawler is actually told, which no file in `site/` states. Next emits
 * the layout's metadata and a page's own as separate tags rather than merging
 * them, so agreement between them is a property of the export alone.
 *
 * `site/out` is gitignored: it exists after `cd site && bun run build` and
 * nowhere else. These skip rather than fail without it, so a clean checkout and
 * CI's binary job stay green. The site job runs this file again after its build,
 * which is the one place the export exists and so the one place they are not
 * silently skipped.
 */
const OUT = 'site/out'
const EXPORTED = existsSync(OUT)
  ? readdirSync(OUT, { recursive: true }).map(String).filter((f) => f.endsWith('.html'))
  : []

/** Every directive the page carries, from however many tags carry them. */
const robotsOf = (page: string) =>
  new Set(
    [...read(`${OUT}/${page}`).matchAll(/<meta name="robots" content="([^"]*)"/g)].flatMap((m) =>
      (m[1] ?? '').split(',').map((d) => d.trim().toLowerCase()),
    ),
  )

describe.skipIf(EXPORTED.length === 0)('the exported pages tell a crawler one thing', () => {
  test('the sweep below reads the whole export, not a directory that built empty', () => {
    expect(EXPORTED).toContain('404.html')
    expect(EXPORTED).toContain('index.html')
  })

  // The 404 carries two robots tags on purpose — Next's own `noindex` for the
  // route, and the page's, which not-found.tsx restates so they say the same
  // thing. Drop the page's and the layout's `index, follow` is emitted beside
  // Next's instead: two tags that contradict each other, a third state the
  // source cannot be read for and nothing else here would notice.
  test('no page carries a robots tag contradicting another on the same page', () => {
    const opposed = [
      ['index', 'noindex'],
      ['follow', 'nofollow'],
    ] as const
    for (const page of EXPORTED) {
      const said = robotsOf(page)
      const both = opposed.filter(([a, b]) => said.has(a) && said.has(b)).map(([a]) => a)
      expect({ page, tagged: said.size > 0, both }).toEqual({ page, tagged: true, both: [] })
    }
  })

  // The reason not-found.tsx sets `alternates: { canonical: null }` and leaves
  // `url` off its card: one file answers for every address on the domain there
  // is nothing at, so an address of its own is one it does not have — and a
  // mistyped link unfurled in a chat would name it as a page that exists.
  test('no page a crawler is told to skip publishes an address of its own', () => {
    const skipped = EXPORTED.filter((page) => robotsOf(page).has('noindex'))
    expect(skipped).toContain('404.html')
    for (const page of skipped) {
      expect({ page, url: read(`${OUT}/${page}`).includes('og:url') }).toEqual({ page, url: false })
    }
  })
})

/**
 * A search lands a stranger on one guide page, cold. Each sentence there that
 * says what tula does is held to the code that does it, so a page cannot go on
 * describing a build that changed underneath it.
 */
describe('the guide pages state what the build does', () => {
  const guide = (route: string) => flat(`site/app/${route}/page.tsx`)
  const gaps = (venue: string) =>
    (CONNECTORS.get(venue)?.coverage?.doesNotRead ?? []).map((gap) => gap.what.toLowerCase())
  const reads = (venue: string) => (CONNECTORS.get(venue)?.coverage?.reads ?? []).join(' ')

  test('each is in the footer’s Guides row and never in the header', () => {
    const site = flat('site/lib/site.ts')
    for (const path of GUIDES) {
      const route = path.slice('site/app/'.length, -'/page.tsx'.length)
      const at = site.indexOf(`href: '/${route}'`)
      const entry = at === -1 ? '' : site.slice(at, site.indexOf('}', at))
      expect({ route, guide: entry.includes("group: 'guide'") }).toEqual({ route, guide: true })
      expect({ route, header: entry.includes('inHeader: false') }).toEqual({ route, header: true })
    }
    expect(read('site/components/Footer.tsx')).toContain("n.group === 'guide'")
    expect(read('site/components/Nav.tsx')).toContain('NAV.filter((n) => n.inHeader)')
  })

  test('/hyperliquid: the modes, the 95% trigger and the partial read are the connector’s', () => {
    const page = guide('hyperliquid')
    const source = flat('src/connectors/hyperliquid.ts')
    expect(source).toContain("export type AccountMode = 'standard' | 'unified' | 'portfolio'")
    for (const mode of ['Standard.', 'Unified account.', 'Portfolio margin.']) expect(page).toContain(mode)
    expect(source).toContain("RATIO_THRESHOLD = new Decimal('0.95')")
    expect(page).toContain('passes 95%')
    for (const name of ['Unified Account Ratio', 'Portfolio Margin Ratio']) {
      expect(source).toContain(`name: '${name}'`)
      expect(page).toContain(name)
    }
    expect(read('src/core/format.ts')).toContain("'at least '")
    expect(page).toContain('“at least”')
    for (const phrase of ['every builder-deployed dex', 'every sub-account']) {
      expect(reads('hyperliquid')).toContain(phrase)
      expect(page).toContain(phrase)
    }
    expect(gaps('hyperliquid').some((what) => what.includes('hyperevm'))).toBe(true)
    expect(page).toContain('HyperEVM')
  })

  test('/aave: the move formula, eMode and the gaps are the build’s', () => {
    const page = guide('aave')
    expect(read('src/core/risk.ts')).toContain('ONE.div(healthFactor).minus(ONE)')
    expect(page).toContain('1 − 1/HF')
    expect(reads('aave')).toContain('eMode')
    expect(page).toContain('eMode')
    for (const gap of ['aave v4', 'safety module', 'isolation mode']) {
      expect({ gap, declared: gaps('aave').some((what) => what.includes(gap)) }).toEqual({ gap, declared: true })
      expect({ gap, stated: page.toLowerCase().includes(gap) }).toEqual({ gap, stated: true })
    }
  })

  test('/liquidation-risk: the order, the unknowns and the unread level are the engine’s', () => {
    const page = guide('liquidation-risk')
    expect(read('src/core/risk.ts')).toContain('Nearest to liquidation first. Unknowns sort last')
    expect(page).toContain('nearest first')
    expect(page).toContain('sorts last, as unknown, never as safe')
    expect(gaps('kraken')).toContain('the account margin level')
    expect(page).toContain('Kraken’s account margin level')
    expect(reads('coinbase')).toContain('the liquidation price and leverage Coinbase publishes')
    expect(page).toContain('liquidation price Coinbase publishes')
  })

  test('/exposure: the Equity rule and the bridged-token rule are the engine’s', () => {
    const page = guide('exposure')
    expect(flat('src/core/exposure.ts')).toContain('never its notional')
    expect(page).toContain('never its notional')
    expect(flat('CHANGELOG.md')).toContain(
      'Hyperliquid calls Account Equity and Bybit, OKX and Deribit call equity',
    )
    expect(page).toContain('Hyperliquid calls it Account Equity; Bybit, OKX and Deribit call it equity')
    expect(read('src/connectors/symbols.ts')).toContain(
      "'137:0x2791bca1f2de4661ed88a30c99a7a9449aa84174': 'USDC.E'",
    )
    expect(page).toContain('USDC.e on Polygon')
  })

  for (const venue of ['kraken', 'binance', 'coinbase'] as const) {
    test(`/${venue} asks for the key its connector names`, () => {
      const key = CONNECTORS.get(venue)?.readOnlyKey
      expect(key).toBeDefined()
      expect(guide(venue)).toContain(key ?? '')
    })
  }

  const STATED_GAPS = {
    kraken: ['the account margin level', 'kraken futures positions', 'drawn credit lines'],
    binance: [
      'the margin level a cross-margin account is liquidated at',
      'futures',
      'portfolio margin',
      'sub-account',
    ],
    coinbase: ['portfolios other than', 'cftc-regulated futures'],
  } as const

  for (const [venue, stated] of Object.entries(STATED_GAPS)) {
    test(`/${venue} names as unread only what its connector declares`, () => {
      const page = guide(venue).toLowerCase()
      for (const gap of stated) {
        expect({ gap, declared: gaps(venue).some((what) => what.includes(gap)) }).toEqual({ gap, declared: true })
        expect({ gap, stated: page.includes(gap) }).toEqual({ gap, stated: true })
      }
    })
  }

  test('the refusals the exchange pages state are the ones connect makes', () => {
    const types = read('src/connectors/types.ts')
    expect(types).toContain("scope.canTrade === true && 'trade'")
    expect(types).toContain("scope.canWithdraw === true && 'withdraw'")
    expect(read('src/connectors/kraken.ts')).toContain("TRADE_PERMISSIONS = ['modify-trades', 'close-trades']")
    expect(guide('kraken')).toContain('A key that can trade or withdraw is refused')
    expect(read('src/connectors/binance.ts')).toContain('Refusing this key: it can move your funds')
    expect(guide('binance')).toContain('A key that can trade, withdraw or move your funds is refused')
    const coinbase = read('src/connectors/coinbase.ts')
    for (const field of ['can_view', 'can_trade', 'can_transfer']) {
      expect(coinbase).toContain(`permissions.${field} === true`)
    }
    expect(guide('coinbase')).toContain('View, Trade and Transfer')
    expect(guide('coinbase')).toContain('A key that can trade or transfer is refused')
  })
})
