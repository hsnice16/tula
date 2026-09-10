/**
 * Venue conformance: the beliefs tula holds about a venue's data, re-checked
 * against that venue.
 *
 * A rule inferred from a snapshot is true on the day it is written and nothing
 * re-reads it afterwards. Kraken's four-character X/Z prefix rule held when it
 * was written; Kraken has since listed XAUT, ZORA, ZETA and six more that begin
 * X or Z and are not prefixed at all, and tula renamed Tether Gold to AUT — a
 * holding priced as something else entirely. The right answer, `altname`, was in
 * the same response the whole time. No test could have caught it: every fixture
 * in the repo was captured before those listings existed.
 *
 * So this is not a test. It talks to real public endpoints, it will disagree
 * with the repo on any week a venue lists something new, and **a venue listing a
 * new token is not a broken build**. It prints what drifted and what we now
 * believe, and exits 0 either way. A red X here would be a red X somebody learns
 * to ignore, which is worse than no check.
 *
 *   bun run conformance
 *
 * Named `.live.ts` rather than `.test.ts` on purpose: Bun's test glob is
 * `*.test.*` and `*.spec.*`, so this suffix is outside `bun test` and outside
 * `bun run check` with no configuration and no exclude list to fall out of date
 * — the mechanism `tasks/the-shell/09-injection-defense.md` settled for its eval.
 *
 * Public endpoints only. Nothing here reads a credential or takes an address.
 */

import { readFileSync } from 'node:fs'
import Decimal from 'decimal.js'
import { DEPLOYMENTS } from '../src/connectors/aave.js'
import { CHAINS, tokenListUrl, UNCOVERED_CHAINS, type Chain } from '../src/connectors/chains.js'
import { unscale } from '../src/connectors/hyperliquid.js'
import { normalizeAsset, type AssetNames } from '../src/connectors/kraken.js'
import { chainTokens, contested, type TokenEntry } from '../src/connectors/wallet.js'
import { request } from '../src/core/http.js'

/**
 * `holds` — the belief in the code is still the venue's behaviour.
 * `drifted` — the venue changed and the code still copes; the numbers moved.
 * `contradicted` — the venue changed and something in the code is now wrong.
 * `unreachable` — nothing was learned. Never silently a pass.
 */
type Verdict = 'holds' | 'drifted' | 'contradicted' | 'unreachable'

interface Finding {
  verdict: Verdict
  belief: string
  lines: string[]
}

const MARK: Record<Verdict, string> = {
  holds: '  OK  ',
  drifted: 'DRIFT ',
  contradicted: 'WRONG ',
  unreachable: ' N/A  ',
}

/** Long enough for a slow venue, short enough that a hung one still reports. */
const DEADLINE_MS = 30_000

async function getJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await request(url, init, DEADLINE_MS)
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`)
  return (await res.json()) as T
}

const postInfo = <T,>(body: unknown): Promise<T> =>
  getJson<T>('https://api.hyperliquid.xyz/info', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

/**
 * GitHub answers a 301 for this repository and `request()` refuses a redirect by
 * default — it exists to stop a credential being re-sent to whatever a
 * `Location` names. These two carry no credential and no address.
 */
const followed: RequestInit = { redirect: 'follow' }

/** At most `n`, with the count of what is not shown. A report nobody scrolls is a report. */
function some(items: string[], n = 12): string {
  const shown = items.slice(0, n).join(', ')
  return items.length > n ? `${shown}, and ${items.length - n} more` : shown
}

// ---------------------------------------------------------------- Kraken

interface KrakenAsset {
  altname?: string
  status?: string
}

/**
 * `normalizeAsset` reads `altname` and falls back to the prefix rule for a code
 * the asset list did not carry. Both halves are checked: that the field is still
 * there for every enabled asset — the day it is not, the fallback silently
 * renames everything it gets wrong — and how far apart the two answers now are.
 */
async function kraken(): Promise<Finding[]> {
  const body = await getJson<{ error?: string[]; result?: Record<string, KrakenAsset> }>(
    'https://api.kraken.com/0/public/Assets',
  )
  if (body.error?.length) throw new Error(body.error.join('; '))
  const assets = body.result ?? {}
  const enabled = Object.entries(assets).filter(([, a]) => a.status === 'enabled')

  const names: AssetNames = new Map(
    Object.entries(assets).flatMap(([code, a]) => (a.altname ? [[code, a.altname] as const] : [])),
  )

  const findings: Finding[] = []

  const unnamed = enabled.filter(([, a]) => !a.altname).map(([code]) => code)
  findings.push({
    verdict: unnamed.length === 0 ? 'holds' : 'contradicted',
    belief: 'every enabled Kraken asset publishes an altname',
    lines: [
      `${Object.keys(assets).length} assets listed, ${enabled.length} enabled.`,
      unnamed.length === 0
        ? 'Every enabled asset carries one, so nothing falls back to the prefix rule.'
        : `No altname for ${unnamed.length}: ${some(unnamed)}. Each of those is renamed by the ` +
          'prefix rule instead, which is what mislabelled nine assets before.',
    ],
  })

  // The two answers, side by side. Every entry here is an asset the prefix rule
  // alone would spell wrong, so the count is what the altname read is worth.
  const disagree = enabled
    .filter(([code]) => normalizeAsset(code).asset !== normalizeAsset(code, names).asset)
    .map(([code]) => `${code} -> ${normalizeAsset(code, names).asset}`)
  findings.push({
    verdict: disagree.length >= 9 ? 'holds' : 'drifted',
    belief: 'the X/Z prefix rule is a fallback, not the answer — altname is',
    lines: [
      `${disagree.length} enabled assets are spelled differently by the two: ${some(disagree)}.`,
      'It was 9 when the connector was written (XAUT, ZORA, ZETA and six more).',
      disagree.length >= 9
        ? 'The gap has not closed, so reading altname is still load-bearing.'
        : 'FEWER than before. Check the list above before concluding the rule is safe again — ' +
          'a shrinking gap is more likely a listing withdrawn than a rule becoming true.',
    ],
  })

  // Two codes that normalize to one asset and kind net into a single row. For
  // XETH beside ETH that is right; for anything else it is one balance reported
  // as the sum of two, so the set is reported rather than asserted away.
  const byAsset = new Map<string, string[]>()
  for (const [code] of enabled) {
    const { asset, kind } = normalizeAsset(code, names)
    const key = `${asset} (${kind})`
    byAsset.set(key, [...(byAsset.get(key) ?? []), code])
  }
  const merged = [...byAsset].filter(([, codes]) => codes.length > 1)
  findings.push({
    verdict: merged.length <= 4 ? 'holds' : 'drifted',
    belief: 'Kraken codes that net into one row are the legacy pairs and nothing else',
    lines: [
      merged.length === 0
        ? 'No two enabled codes share an asset and kind.'
        : merged.map(([key, codes]) => `${codes.join(' + ')} -> ${key}`).join('; '),
      'It was 4 (ETH spot, USDT0 spot, DOT staked, KSM staked). Anything new here is two ' +
        'balances reported as one, which is the failure netting exists to prevent.',
    ],
  })

  return findings
}

// ------------------------------------------------------------------ Aave

const ADDRESS_BOOK = 'https://api.github.com/repos/bgd-labs/aave-address-book/contents/src'
const ADDRESS_BOOK_RAW = 'https://raw.githubusercontent.com/bgd-labs/aave-address-book/main/src'

/**
 * The address book names a deployment by chain: `AaveV3Base.sol`, and Ethereum's
 * four markets as `AaveV3Ethereum` plus a suffix each. Testnets are excluded by
 * name — a Sepolia pool is not a market anybody has money in.
 */
const bookFilesFor = (chain: string, names: string[]): string[] => {
  const prefix = `AaveV3${chain.charAt(0).toUpperCase()}${chain.slice(1)}`
  return names.filter((n) => n.startsWith(prefix) && /\.sol$/.test(n) && !/Sepolia|Testnet|Fuji/.test(n))
}

async function aave(): Promise<Finding[]> {
  const listing = await getJson<{ name: string }[]>(ADDRESS_BOOK, followed)
  const names = listing.map((e) => e.name)
  const findings: Finding[] = []

  // The declared gap says V4 holds real deposits on Ethereum and tula reaches
  // none of it. Asserted as the gap still being *true*, not as V4 not existing:
  // the day V4 Ethereum leaves this list the declaration is the thing that has
  // gone stale, and `coverage.doesNotRead` has to be re-argued either way.
  const v4 = names.filter((n) => /^AaveV4.*\.sol$/.test(n))
  const v4Ethereum = v4.includes('AaveV4Ethereum.sol')
  findings.push({
    verdict: v4Ethereum ? 'holds' : 'drifted',
    belief: 'Aave V4 is live on Ethereum and tula deliberately does not read it',
    lines: [
      v4.length === 0 ? 'No V4 deployment in the address book.' : `V4 deployments: ${v4.join(', ')}.`,
      v4Ethereum
        ? 'The gap declared in aave.ts coverage.doesNotRead is still the true state: a migrated ' +
          'account reads as an empty book, and nothing on screen says so.'
        : 'V4 Ethereum is NOT in the address book any more. The declared gap describes something ' +
          'that is no longer there — re-argue it before trusting the coverage manifest.',
    ],
  })

  // One check per chain tula actually reads, because "the pool moved" and "there
  // is a market here we never call" are different failures and only the second
  // scales with the chain list. `DEPLOYMENTS` is the connector's own list, so
  // adding a chain there brings it under this check without editing this file.
  const covered = [...new Set(DEPLOYMENTS.map((d) => d.chain))]
  for (const chain of covered) {
    const ours = new Map(
      DEPLOYMENTS.filter((d) => d.chain === chain).map((d) => [d.pool.toLowerCase(), d.market]),
    )
    const published = new Map<string, string>()
    for (const file of bookFilesFor(chain, names)) {
      const res = await request(`${ADDRESS_BOOK_RAW}/${file}`, followed, DEADLINE_MS)
      if (!res.ok) continue
      const pool = /IPool internal constant POOL = IPool\((0x[0-9a-fA-F]{40})\)/.exec(await res.text())
      if (pool?.[1]) published.set(pool[1].toLowerCase(), file.replace(/\.sol$/, ''))
    }

    const gone = [...ours].filter(([p]) => !published.has(p))
    const unread = [...published].filter(([p]) => !ours.has(p))
    findings.push({
      verdict:
        published.size === 0 ? 'unreachable' : gone.length > 0 ? 'contradicted' : unread.length > 0 ? 'drifted' : 'holds',
      belief: `the Aave v3 markets tula reads on ${chain} are the ones the address book names`,
      lines: [
        `tula holds ${ours.size} (${[...ours.values()].join(', ')}); the book names ${published.size}.`,
        gone.length > 0
          ? `NOT in the address book: ${gone.map(([p, m]) => `${m} ${p}`).join(', ')}. A pool ` +
            'address that moved is a market tula calls and gets nothing back from, reported as ' +
            'an account holding nothing.'
          : 'Every pool address the connector holds is still the address the book publishes.',
        unread.length > 0
          ? `Markets tula does NOT read: ${unread.map(([, n]) => n).join(', ')}. Anyone supplying ` +
            'to one reads as an empty book, with no INCOMPLETE, because nothing failed. That is ' +
            'the defect the instance list exists to close.'
          : 'No market on this chain is missing from the list.',
      ],
    })
  }

  const elsewhere = names
    .filter((n) => /^AaveV3[A-Z]/.test(n) && !/Sepolia|Testnet|Fuji/.test(n))
    .map((n) => n.replace(/^AaveV3|\.sol$/g, ''))
    .filter((n) => !covered.some((c) => n.toLowerCase().startsWith(c)))
  findings.push({
    verdict: 'holds',
    belief: 'the chains tula reads are a subset, and the rest are declared rather than hidden',
    lines: [
      `tula reads ${covered.join(', ')}. ${elsewhere.length} other v3 deployments: ${some(elsewhere, 10)}.`,
      `Uncovered by every chain-reading connector: ${UNCOVERED_CHAINS}.`,
      'This is a scope statement, not a bug — but a book short by a chain says nothing on its ' +
        'own, because nothing failed, so the number above is what the disclosure has to cover.',
    ],
  })

  return findings
}

// ---------------------------------------------------------- Hyperliquid

interface PerpDex {
  name?: string
  fullName?: string
}

interface HlMeta {
  universe?: { name: string; szDecimals: number; maxLeverage: number; marginTableId: number }[]
  marginTables?: [number, { description?: string; marginTiers?: { maxLeverage: number }[] }][]
}

async function hyperliquid(): Promise<Finding[]> {
  const findings: Finding[] = []

  // The leading entry is null — the first-party book, which has no builder.
  const dexes = (await postInfo<(PerpDex | null)[]>({ type: 'perpDexs' })).filter(
    (d): d is PerpDex => d !== null,
  )
  const live = dexes.map((d) => d.name ?? '?')
  const captured = JSON.parse(
    readFileSync(new URL('../fixtures/hyperliquid/perp-dexs.json', import.meta.url), 'utf8'),
  ) as { builders?: PerpDex[] }
  const known = new Set((captured.builders ?? []).map((b) => b.name))
  const added = live.filter((n) => !known.has(n))

  findings.push({
    verdict: dexes.length === 0 ? 'drifted' : added.length > 0 ? 'drifted' : 'holds',
    belief: 'builder-deployed perp dexes exist and tula reads none of them',
    lines: [
      `${dexes.length} builder dexes now; the fixture captured ${known.size}.`,
      added.length > 0
        ? `New since capture: ${some(added)}. Re-capture fixtures/hyperliquid/perp-dexs.json.`
        : 'No dex has been added since the fixture was captured.',
      dexes.length === 0
        ? 'The list is empty, so the declared gap describes nothing. Re-argue it.'
        : 'clearinghouseState is never sent a dex parameter, so a position on any of these is ' +
          'invisible — declared in hyperliquid.ts as hiding a liquidation.',
    ],
  })

  const meta = await postInfo<HlMeta>({ type: 'meta' })
  const universe = meta.universe ?? []
  // `unscale` unwinds a `k` prefix as a thousand-multiple. It is a rule read off
  // the venue's naming, exactly like Kraken's prefix rule, so it gets the same
  // treatment: the coins it fires on are listed rather than assumed.
  const scaled = universe.filter((c) => unscale(c.name, new Decimal(1)).scale !== 1)
  const lowercase = universe.filter((c) => c.name !== c.name.toUpperCase() && !/^k[A-Z0-9]+$/.test(c.name))
  findings.push({
    verdict: scaled.length === 0 ? 'contradicted' : lowercase.length > 0 ? 'drifted' : 'holds',
    belief: 'a k-prefix on a Hyperliquid perp means one thousand of the asset, and nothing else does',
    lines: [
      `${universe.length} perps listed. unscale() unwinds ${scaled.length}: ` +
        `${some(scaled.map((c) => c.name))}.`,
      scaled.length === 0
        ? 'It fires on none of them. Either the venue renamed its scaled markets or the pattern ' +
          'stopped matching — a 1000x error in a liquidation distance either way.'
        : 'Each is divided back to the single asset so it nets and prices with the same coin held ' +
          'elsewhere.',
      lowercase.length > 0
        ? `Coins with a lower-case letter that unscale() does NOT treat as scaled: ` +
          `${some(lowercase.map((c) => c.name))}. Check none of them is a multiple.`
        : 'No other coin is spelled with a lower-case letter, so nothing else looks scaled.',
    ],
  })

  // Leverage is the account mode that reaches the risk view: it bounds how far a
  // position can be from its liquidation price. A tier table tula never reads is
  // fine; a tier table that stopped existing would mean maxLeverage is not it.
  const tables = meta.marginTables ?? []
  const maxLeverage = Math.max(0, ...universe.map((c) => c.maxLeverage))
  findings.push({
    verdict: tables.length > 0 ? 'holds' : 'drifted',
    belief: 'Hyperliquid states leverage per market, in tiers, and tula reads the venue’s own liquidation price rather than deriving one',
    lines: [
      `${tables.length} margin tables; the highest maxLeverage on any perp is ${maxLeverage}x.`,
      'tula stores liquidationPx as the venue sends it and never recomputes it from leverage, ' +
        'so a tier change moves the number tula reports without changing what tula does.',
      tables.length === 0 ? 'No tables at all — the shape of this response changed.' : '',
    ].filter(Boolean),
  })

  return findings
}

// ------------------------------------------------------------ Token list

async function tokenList(): Promise<Finding[]> {
  const findings: Finding[] = []
  const lists = new Map<string, TokenEntry[]>()
  for (const chain of CHAINS) {
    const url = tokenListUrl(chain)
    if (lists.has(url)) continue
    const body = await getJson<{ tokens?: TokenEntry[] }>(url)
    lists.set(url, body.tokens ?? [])
  }

  const read: Chain[] = []
  const counts: string[] = []
  let covered = 0
  for (const chain of CHAINS) {
    const entries = lists.get(tokenListUrl(chain)) ?? []
    const kept = chainTokens(entries, chain)
    counts.push(`${chain.name} ${kept.length}`)
    covered += kept.length
    if (kept.length > 0) read.push(chain)
  }
  const total = [...lists.values()].reduce((n, e) => n + e.length, 0)

  findings.push({
    verdict: read.length < CHAINS.length ? 'contradicted' : 'holds',
    belief: 'every chain tula reads still has tokens in the list it filters by EIP-155 id',
    lines: [
      `${total} entries across the feed(s); ${covered} survive the per-chain, address and ` +
        `receipt-token filters — ${counts.join(', ')}.`,
      read.length < CHAINS.length
        ? `NO tokens survive for ${CHAINS.filter((c) => !read.includes(c)).map((c) => c.name).join(', ')}. ` +
          'Either the feed changed shape or a chain id stopped matching, and that chain then ' +
          'reads as a wallet holding nothing but its native balance — no failure, no INCOMPLETE.'
        : `${total - covered} entries belong to chains tula does not read. Uncovered: ` +
          `${UNCOVERED_CHAINS}.`,
    ],
  })

  // The front page publishes a wallet holding per row, and which tokens a wallet
  // read can produce is a fact about somebody else's feed — so it belongs here
  // rather than in `src/site-example.test.ts`, which may not reach the network.
  // The failure it catches has happened: `OP` stood as a wallet row while the
  // default feed carries OP on Optimism alone, which is a chain tula does not
  // read. Every figure in that block was recomputed by a passing test.
  const symbols = new Set(CHAINS.flatMap((c) => chainTokens(lists.get(tokenListUrl(c)) ?? [], c)).map((t) => t.symbol.toUpperCase()))
  const page = readFileSync('site/app/page.tsx', 'utf8')
  const block = page.slice(page.indexOf('ASSET'), page.indexOf('</Session>'))
  const published = [
    ...new Set(
      block
        .split('\n')
        .map((line) => line.trim().split(/\s+/))
        .filter((cells) => cells.length > 3 && cells.includes('wallet'))
        .map((cells) => (cells[0] as string).toUpperCase()),
    ),
  ]
  const missing = published.filter((symbol) => !symbols.has(symbol))
  findings.push({
    verdict: published.length === 0 ? 'unreachable' : missing.length > 0 ? 'contradicted' : 'holds',
    belief: 'every wallet holding the front page publishes is one a wallet read could actually return',
    lines:
      published.length === 0
        ? ['No wallet row was found in the page transcript, so nothing here was checked.']
        : [
            `${published.length} published under wallet: ${published.join(' ')}.`,
            missing.length > 0
              ? `NOT on the feed for any chain tula reads: ${missing.join(' ')}. The page is a ` +
                'picture of output this build cannot produce — move the row to a venue that ' +
                'lists it, or publish a token the feed carries.'
              : 'Each is on the feed for at least one of the chains read.',
          ],
  })

  // A symbol is not an identity. Two mainnet tokens called LIT — Litentry and
  // Lighter — is the case wallet.ts qualifies rather than nets.
  const perChain = CHAINS.map((chain) => {
    const clashes = [...contested(chainTokens(lists.get(tokenListUrl(chain)) ?? [], chain))].sort()
    return `${chain.name}: ${clashes.length === 0 ? 'none' : clashes.join(' ')}`
  })
  const any = perChain.some((line) => !line.endsWith('none'))
  findings.push({
    verdict: any ? 'holds' : 'drifted',
    belief: 'more than one token answers to the same symbol, and the connector qualifies rather than nets them',
    lines: [
      perChain.join(' · '),
      any
        ? 'Each is reported qualified, because netting them would produce a figure that is ' +
          'nobody’s balance.'
        : 'No symbol is claimed twice anywhere. It was LIT on Ethereum when this was written; if ' +
          'that is genuinely gone, the qualifying path is now untested by real data.',
    ],
  })

  return findings
}

// --------------------------------------------------------------- the run

interface Section {
  name: string
  run: () => Promise<Finding[]>
}

const SECTIONS: Section[] = [
  { name: 'Kraken · asset naming', run: kraken },
  { name: 'Aave · which deployments we read', run: aave },
  { name: 'Hyperliquid · perp dexes and scaling', run: hyperliquid },
  { name: 'Token list · chain coverage and collisions', run: tokenList },
]

async function main(): Promise<void> {
  const out: string[] = [
    'Venue conformance — what tula believes, re-checked against the venue.',
    `Run at ${new Date().toISOString()}. Public endpoints only; no credential is read.`,
    '',
  ]
  const tally: Record<Verdict, number> = { holds: 0, drifted: 0, contradicted: 0, unreachable: 0 }

  for (const section of SECTIONS) {
    out.push(`── ${section.name}`)
    let findings: Finding[]
    try {
      findings = await section.run()
    } catch (err) {
      findings = [
        {
          verdict: 'unreachable',
          belief: 'the venue could be asked at all',
          lines: [err instanceof Error ? err.message : String(err), 'Nothing was learned here.'],
        },
      ]
    }
    for (const f of findings) {
      tally[f.verdict] += 1
      out.push(`[${MARK[f.verdict]}] ${f.belief}`)
      for (const line of f.lines) out.push(`           ${line}`)
    }
    out.push('')
  }

  out.push(
    `${tally.holds} hold · ${tally.drifted} drifted · ${tally.contradicted} contradicted · ${tally.unreachable} unreachable`,
    '',
    // Said in the report rather than left to whoever finds it: the exit code is
    // the thing somebody would otherwise read the wrong meaning into.
    'This run always exits 0. A venue listing a new token is not a broken build, and a check',
    'that goes red for one is a check people learn to ignore. Read the lines above; act on a',
    'WRONG by changing the code, on a DRIFT by deciding whether the belief still earns its place.',
  )

  const report = out.join('\n')
  console.log(report)

  const summary = process.env['GITHUB_STEP_SUMMARY']
  if (summary) {
    const { appendFileSync } = await import('node:fs')
    appendFileSync(summary, `## Venue conformance\n\n\`\`\`text\n${report}\n\`\`\`\n`)
  }
}

await main()
