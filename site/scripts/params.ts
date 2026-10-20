/**
 * Writes `lib/params/hyperliquid.json` and `lib/params/aave.json`, the venue
 * parameters the two calculator pages start from: each Hyperliquid perp's max
 * leverage and margin tiers, and each Aave v3 reserve's liquidation threshold
 * and eMode categories, in the markets the binary reads.
 *
 * Run by hand (`bun run params`), never by the build: AGENTS.md says why. It
 * refuses to write anything it cannot vouch for, so a venue that answers oddly
 * fails the run instead of landing in the snapshot.
 */
import { writeFileSync } from 'node:fs'
import { OPENING } from '../lib/calc'

const HYPERLIQUID = 'https://api.hyperliquid.xyz/info'
const AAVE = 'https://api.v3.aave.com/graphql'

/**
 * The pools `src/connectors/aave.ts` reads, by address. Restated rather than
 * imported because nothing under `site/` may import from `src/`; a market the
 * API answers for that is not in here is one tula does not read, and is left out.
 */
const MARKETS: Record<string, string> = {
  '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2@1': 'Ethereum Core',
  '0x4e033931ad43597d96D6bcc25c280717730B58B1@1': 'Ethereum Prime',
  '0x0AA97c284e98396202b6A04024F5E2c65026F3c0@1': 'Ethereum EtherFi',
  '0xAe05Cd22df81871bc7cC2a04BeCfb516bFe332C8@1': 'Ethereum Horizon',
  '0x794a61358D6845594F94dc1DB02A252b5b4814aD@42161': 'Arbitrum One',
  '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5@8453': 'Base',
  '0x794a61358D6845594F94dc1DB02A252b5b4814aD@137': 'Polygon',
  '0x794a61358D6845594F94dc1DB02A252b5b4814aD@10': 'Optimism',
  '0x794a61358D6845594F94dc1DB02A252b5b4814aD@43114': 'Avalanche',
  '0xb50201558B00496A145fE76f7424749556E326D8@100': 'Gnosis',
  '0x11fCfe756c05AD438e312a7fd934381537D3cFfe@534352': 'Scroll',
  '0xc47b8C00b0f69a36fa203Ffeac0334874574a8Ac@59144': 'Linea',
}

// The API answers in lowercase; the table keeps the connector's checksummed spelling.
const BY_ADDRESS = new Map(Object.entries(MARKETS).map(([key, name]) => [key.toLowerCase(), name]))
const CHAIN_IDS = [...new Set(Object.keys(MARKETS).map((key) => Number(key.split('@')[1])))]
const ORDER = Object.values(MARKETS)

function check(ok: boolean, what: string): asserts ok {
  if (!ok) throw new Error(`refusing to write the snapshot: ${what}`)
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) throw new Error(`${url} answered ${res.status}`)
  return (await res.json()) as T
}

interface HlMeta {
  universe: {
    name: string
    maxLeverage: number
    marginTableId: number
    isDelisted?: boolean
    onlyIsolated?: boolean
    marginMode?: string
  }[]
  marginTables: [number, { marginTiers: { lowerBound: string; maxLeverage: number }[] }][]
}

async function hyperliquid() {
  const meta = await post<HlMeta>(HYPERLIQUID, { type: 'meta' })
  const tables = new Map(meta.marginTables)
  const perps = meta.universe
    .filter((a) => !a.isDelisted)
    .map((a) => {
      // Hyperliquid's docs: an id below 50 is a single tier at that leverage,
      // and is not listed in `marginTables`.
      const table = tables.get(a.marginTableId)
      check(
        table !== undefined || a.marginTableId < 50,
        `${a.name} names margin table ${a.marginTableId}, which meta does not list`,
      )
      const tiers = (table?.marginTiers ?? [{ lowerBound: '0', maxLeverage: a.maxLeverage }]).map(
        (t) => ({ from: Number(t.lowerBound), maxLeverage: t.maxLeverage }),
      )
      check(tiers[0]?.from === 0, `${a.name}'s first tier does not start at 0`)
      tiers.forEach((t, i) => {
        check(
          Number.isInteger(t.maxLeverage) && t.maxLeverage > 0,
          `${a.name} has max leverage ${t.maxLeverage}`,
        )
        check(
          i === 0 || t.from > (tiers[i - 1]?.from ?? Number.NaN),
          `${a.name}'s tiers do not ascend`,
        )
      })
      const isolatedOnly =
        a.onlyIsolated === true || (a.marginMode !== undefined && a.marginMode !== 'normal')
      return { asset: a.name, tiers, ...(isolatedOnly ? { isolatedOnly } : {}) }
    })
    .sort((a, b) => a.asset.localeCompare(b.asset))
  check(
    perps.some((p) => p.asset === OPENING.hyperliquid.asset),
    `Hyperliquid lists no ${OPENING.hyperliquid.asset} perp, which the calculator opens on`,
  )
  return perps
}

interface Token {
  symbol: string
  name: string
  address: string
}

interface AaveAnswer {
  errors?: { message: string }[]
  data: {
    markets: {
      address: string
      chain: { chainId: number }
      reserves: {
        underlyingToken: Token
        supplyInfo: { liquidationThreshold: { value: string }; canBeCollateral: boolean }
        isFrozen: boolean
        isPaused: boolean
      }[]
      eModeCategories: {
        id: number
        label: string
        liquidationThreshold: { value: string }
        reserves: { underlyingToken: Token; canBeCollateral: boolean }[]
      }[]
    }[]
  } | null
}

const TOKEN = 'underlyingToken { symbol name address }'
const QUERY = `{ markets(request: { chainIds: [${CHAIN_IDS.join(',')}] }) {
  address chain { chainId }
  reserves { ${TOKEN} supplyInfo { liquidationThreshold { value } canBeCollateral } isFrozen isPaused }
  eModeCategories { id label liquidationThreshold { value } reserves { ${TOKEN} canBeCollateral } }
} }`

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

/**
 * A Pendle PT's maturity, from a label that spells one — "Jul 2025",
 * "September 2025", "7MAY2026", "5FEB" — or null. A category for a matured PT
 * admits nothing anybody can still be holding against a loan.
 */
function maturity(label: string, today: Date): Date | null {
  if (!/PT/.test(label)) return null
  const spelled = label
    .toUpperCase()
    .match(/(\d{1,2})?\s*(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\s*(\d{4})?/)
  if (!spelled) return null
  const year = spelled[3] ? Number(spelled[3]) : today.getUTCFullYear()
  const day = spelled[1] ? Number(spelled[1]) : 28
  return new Date(Date.UTC(year, MONTHS.indexOf(spelled[2] ?? ''), day))
}

/** The API's labels are governance ids as often as names: `rsETH__ETH_wstETH_ETHx`. */
const tidy = (label: string) => label.replace(/__/g, ' / ').replace(/_/g, ' ').trim()

async function aave(today: Date) {
  const answer = await post<AaveAnswer>(AAVE, { query: QUERY })
  if (!answer.data)
    throw new Error(`the Aave API refused: ${answer.errors?.[0]?.message ?? 'no data'}`)
  const markets = answer.data.markets.flatMap((m) => {
    const name = BY_ADDRESS.get(`${m.address.toLowerCase()}@${m.chain.chainId}`)
    if (!name) return []
    // Two reserves can share a symbol — Circle's USDC and a bridge's — so the
    // bridged one is named by the qualifier its token name carries: "USD Coin
    // (USDC.e)" is USDC.e, "USD Coin (PoS)" USDC (PoS). The name is then the
    // reserve's key, which keeps contract addresses out of the snapshot.
    const twice = (symbol: string) =>
      m.reserves.filter((r) => r.underlyingToken.symbol === symbol).length > 1
    const label = (t: Token) => {
      const qualifier = twice(t.symbol) ? t.name.match(/\(([^)]+)\)$/)?.[1] : undefined
      if (!qualifier) return t.symbol
      return qualifier.includes(t.symbol) ? qualifier : `${t.symbol} (${qualifier})`
    }
    // A zero threshold secures nothing. A frozen or zero-LTV reserve stays: it
    // still secures the positions already in it, and those are the ones worth
    // checking.
    const reserves = m.reserves
      .filter((r) => !r.isPaused)
      .map((r) => ({
        asset: label(r.underlyingToken),
        threshold: Number(r.supplyInfo.liquidationThreshold.value),
        ...(r.isFrozen || !r.supplyInfo.canBeCollateral ? { existingOnly: true } : {}),
      }))
      .filter((r) => r.threshold > 0)
      .sort((a, b) => a.asset.localeCompare(b.asset))
    const emodes = m.eModeCategories
      .filter((e) => e.label.trim() !== '' && (maturity(e.label, today) ?? today) >= today)
      .map((e) => ({
        id: e.id,
        label: tidy(e.label),
        threshold: Number(e.liquidationThreshold.value),
        collateral: e.reserves
          .filter((r) => r.canBeCollateral)
          .map((r) => label(r.underlyingToken))
          .sort(),
      }))
      .filter((e) => e.threshold > 0 && e.collateral.length > 0)
    for (const r of reserves) {
      check(r.threshold <= 1, `${name} lists ${r.asset} at a threshold of ${r.threshold}`)
    }
    for (const e of emodes) {
      check(e.threshold <= 1, `${name}'s eMode ${e.label} has a threshold of ${e.threshold}`)
    }
    const names = m.reserves.map((r) => label(r.underlyingToken))
    check(new Set(names).size === names.length, `${name} lists one name for two reserves`)
    return [{ name, chainId: m.chain.chainId, reserves, emodes }]
  })
  const missing = ORDER.filter((n) => !markets.some((m) => m.name === n))
  check(missing.length === 0, `the Aave API did not answer for ${missing.join(', ')}`)
  const sorted = markets.sort((a, b) => ORDER.indexOf(a.name) - ORDER.indexOf(b.name))
  // The first market is the one the calculator opens on.
  check(
    sorted[0]?.reserves.some((r) => r.asset === OPENING.aave.asset) === true,
    `${sorted[0]?.name} lists no ${OPENING.aave.asset}, which the calculator opens on`,
  )
  return sorted
}

const today = new Date()
const [perps, markets] = await Promise.all([hyperliquid(), aave(today)])
const asOf = today.toISOString().slice(0, 10)
const write = (file: string, data: object) =>
  writeFileSync(
    new URL(`../lib/params/${file}`, import.meta.url),
    `${JSON.stringify({ asOf, ...data }, null, 2)}\n`,
  )
write('hyperliquid.json', { perps })
write('aave.json', { markets })
console.log(`lib/params: ${perps.length} perps, ${markets.length} Aave markets, as of ${asOf}`)
