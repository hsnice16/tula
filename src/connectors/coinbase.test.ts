import { afterEach, describe, expect, test } from 'bun:test'
import {
  createPublicKey,
  createSign,
  createVerify,
  generateKeyPairSync,
  verify as edVerify,
} from 'node:crypto'
import { readFileSync } from 'node:fs'
import { whatBreaksFirst } from '../core/risk.js'
import { buildJwt, coinbaseConnector, derToJose, loadKey, normalizeKey, perpAsset } from './coinbase.js'

const ec = generateKeyPairSync('ec', {
  namedCurve: 'prime256v1',
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
})

const ed = generateKeyPairSync('ed25519', {
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
})

const KEY_NAME = 'organizations/abc/apiKeys/def'

/** Rebuild DER from r||s so node's verifier can check what we produced. */
function joseToDer(jose: Buffer): Buffer {
  const trim = (b: Buffer) => {
    let i = 0
    while (i < b.length - 1 && b[i] === 0) i++
    const v = b.subarray(i)
    return (v[0] ?? 0) & 0x80 ? Buffer.concat([Buffer.from([0]), v]) : v
  }
  const r = trim(jose.subarray(0, 32))
  const s = trim(jose.subarray(32))
  const body = Buffer.concat([
    Buffer.from([0x02, r.length]), r,
    Buffer.from([0x02, s.length]), s,
  ])
  return Buffer.concat([Buffer.from([0x30, body.length]), body])
}

function parts(jwt: string) {
  const [header, payload, signature] = jwt.split('.')
  return {
    header: JSON.parse(Buffer.from(header ?? '', 'base64url').toString()),
    payload: JSON.parse(Buffer.from(payload ?? '', 'base64url').toString()),
    signature: Buffer.from(signature ?? '', 'base64url'),
    signingInput: `${header}.${payload}`,
  }
}

describe('normalizeKey', () => {
  test('rebuilds PEM after the input has flattened its newlines', () => {
    const flattened = ec.privateKey.replace(/\n/g, ' ')
    expect(loadKey(flattened).asymmetricKeyType).toBe('ec')
  })

  test('accepts a key with escaped newlines, as JSON files carry them', () => {
    const escaped = ec.privateKey.replace(/\n/g, '\\n')
    expect(loadKey(escaped).asymmetricKeyType).toBe('ec')
  })

  test('leaves a well-formed key alone', () => {
    expect(normalizeKey(ec.privateKey).trim()).toBe(ec.privateKey.trim())
  })

  test('an unreadable key explains what to paste rather than throwing raw', () => {
    expect(() => loadKey('not-a-key')).toThrow(/BEGIN and END lines/)
  })
})

describe('derToJose', () => {
  test('produces a fixed 64 bytes whatever the DER lengths were', () => {
    for (let i = 0; i < 40; i++) {
      const der = createSign('SHA256').update(`payload-${i}`).sign(ec.privateKey)
      expect(derToJose(der)).toHaveLength(64)
    }
  })

  test('refuses anything that is not a DER sequence', () => {
    expect(() => derToJose(Buffer.from([0x01, 0x02]))).toThrow(/signature format/)
  })
})

describe('buildJwt', () => {
  test('signs ES256 in JOSE r||s form, verifiable with the public key', () => {
    const jwt = buildJwt(KEY_NAME, ec.privateKey, 'GET', '/api/v3/brokerage/accounts')
    const { header, payload, signature, signingInput } = parts(jwt)

    expect(header.alg).toBe('ES256')
    expect(header.kid).toBe(KEY_NAME)
    expect(header.nonce).toMatch(/^[a-f0-9]{32}$/)
    expect(payload.iss).toBe('cdp')
    expect(payload.sub).toBe(KEY_NAME)
    expect(payload.uri).toBe('GET api.coinbase.com/api/v3/brokerage/accounts')
    expect(payload.exp - payload.nbf).toBe(120)

    expect(signature).toHaveLength(64)
    const ok = createVerify('SHA256')
      .update(signingInput)
      .verify({ key: createPublicKey(ec.publicKey) }, joseToDer(signature))
    expect(ok).toBe(true)
  })

  test('signs EdDSA when the key is Ed25519', () => {
    const jwt = buildJwt(KEY_NAME, ed.privateKey, 'GET', '/api/v3/brokerage/key_permissions')
    const { header, signature, signingInput } = parts(jwt)
    expect(header.alg).toBe('EdDSA')
    expect(edVerify(null, Buffer.from(signingInput), createPublicKey(ed.publicKey), signature)).toBe(
      true,
    )
  })

  test('the uri binds the token to one method and path', () => {
    const a = parts(buildJwt(KEY_NAME, ec.privateKey, 'GET', '/one')).payload.uri
    const b = parts(buildJwt(KEY_NAME, ec.privateKey, 'GET', '/two')).payload.uri
    expect(a).not.toBe(b)
  })

  test('a fresh nonce each time, so a token cannot be replayed', () => {
    const a = parts(buildJwt(KEY_NAME, ec.privateKey, 'GET', '/x')).header.nonce
    const b = parts(buildJwt(KEY_NAME, ec.privateKey, 'GET', '/x')).header.nonce
    expect(a).not.toBe(b)
  })
})

/**
 * Built from Coinbase's documented schemas — a CDP key is required, so neither
 * response could be captured. Each fixture names the page it was built from.
 */
const ACCOUNTS = JSON.parse(
  readFileSync(new URL('../../fixtures/coinbase/accounts.json', import.meta.url), 'utf8'),
) as { accounts: Array<{ available_balance: { value: string }; hold: { value: string } }> }

const BREAKDOWN = JSON.parse(
  readFileSync(new URL('../../fixtures/coinbase/portfolio-breakdown.json', import.meta.url), 'utf8'),
) as unknown

const CREDS = { keyName: KEY_NAME, signingKey: ec.privateKey }
const originalFetch = globalThis.fetch
const reached: string[] = []

/** `pages` is what /accounts answers, in order; anything past it is a bug. */
function stub(pages: unknown[], extra: Record<string, unknown> = {}) {
  reached.length = 0
  let page = 0
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input)
    reached.push(url)
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })
    for (const [fragment, body] of Object.entries(extra)) {
      if (url.includes(fragment)) return json(body)
    }
    if (url.includes('/key_permissions')) {
      return json({
        can_view: true,
        can_trade: false,
        can_transfer: false,
        portfolio_uuid: '11111111-2222-3333-4444-555555555555',
      })
    }
    if (url.includes('/accounts')) return json(pages[Math.min(page++, pages.length - 1)])
    if (url.includes('/portfolios/')) return json({ breakdown: { perp_positions: [] } })
    return new Response('not found', { status: 404 })
  }) as unknown as typeof fetch
}

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('coinbase balances', () => {
  test('what is held is a row of its own, not folded into what you can move', async () => {
    stub([ACCOUNTS])
    const positions = await coinbaseConnector.fetchPositions(CREDS)
    const btc = positions.filter((p) => p.asset === 'BTC')
    expect(btc.find((p) => p.kind === 'spot')?.quantity.toString()).toBe('0.4')
    expect(btc.find((p) => p.kind === 'pending')?.quantity.toString()).toBe('0.1')
  })

  test('an account holding nothing is not a row', async () => {
    stub([ACCOUNTS])
    const positions = await coinbaseConnector.fetchPositions(CREDS)
    expect(positions.some((p) => p.asset === 'ETH')).toBe(false)
  })

  test('a second page of accounts is read, not silently dropped', async () => {
    stub([
      { accounts: [{ currency: 'BTC', available_balance: { value: '1', currency: 'BTC' } }], has_next: true, cursor: 'c1' },
      { accounts: [{ currency: 'SOL', available_balance: { value: '9', currency: 'SOL' } }], has_next: false },
    ])
    const assets = (await coinbaseConnector.fetchPositions(CREDS)).map((p) => p.asset)
    expect(assets).toContain('BTC')
    expect(assets).toContain('SOL')
  })

  test('a cursor that never clears fails rather than reporting a partial book', async () => {
    stub([{ accounts: [{ currency: 'BTC', available_balance: { value: '1', currency: 'BTC' } }], has_next: true, cursor: 'c' }])
    await expect(coinbaseConnector.fetchPositions(CREDS)).rejects.toThrow(/20 pages/)
  })
})

describe('coinbase perpetuals', () => {
  test('a perp is exposure to the asset, not just the cash beside it', async () => {
    stub([ACCOUNTS], { '/portfolios/': BREAKDOWN })
    const positions = await coinbaseConnector.fetchPositions(CREDS)
    const btc = positions.find((p) => p.kind === 'perp' && p.asset === 'BTC')
    expect(btc?.quantity.toString()).toBe('0.75')
    expect(btc?.liquidation?.price?.toString()).toBe('51000')
    expect(btc?.liquidation?.leverage?.toString()).toBe('5')
  })

  test('a short is negative however Coinbase signed net_size', async () => {
    stub([ACCOUNTS], { '/portfolios/': BREAKDOWN })
    const eth = (await coinbaseConnector.fetchPositions(CREDS)).find((p) => p.kind === 'perp' && p.asset === 'ETH')
    expect(eth?.quantity.toString()).toBe('-12')
  })

  // Coinbase sends 0 for "no liquidation price", and 0 read as a price puts a
  // position a hundred percent away from a fall it is nowhere near.
  test('a zero liquidation price is unknown, not a price', async () => {
    stub([ACCOUNTS], { '/portfolios/': BREAKDOWN })
    const sol = (await coinbaseConnector.fetchPositions(CREDS)).find((p) => p.kind === 'perp' && p.asset === 'SOL')
    expect(sol?.liquidation?.price).toBeUndefined()
    // Still ranked, because a position that can be liquidated at an unknown
    // distance must not vanish from the table that answers "what breaks first".
    expect(whatBreaksFirst([sol!], new Map())).toHaveLength(1)
  })

  test('a perp product resolves to the asset it tracks', () => {
    expect(perpAsset('BTC-PERP-INTX')).toBe('BTC')
    expect(perpAsset('ETH-PERP-INTX')).toBe('ETH')
  })
})

// Written to be broken by progress: closing one of these fails its test, so the
// line claiming tula does not read it has to go in the same change.
describe('coinbase declared gaps', () => {
  test('CFTC futures are still unread — delete the gap when they are', async () => {
    stub([ACCOUNTS], { '/portfolios/': BREAKDOWN })
    await coinbaseConnector.fetchPositions(CREDS)
    expect(reached.some((url) => url.includes('/cfm/'))).toBe(false)
  })

  test('only the key’s own portfolio is read — delete the gap when it is not', async () => {
    stub([ACCOUNTS], { '/portfolios/': BREAKDOWN })
    await coinbaseConnector.fetchPositions(CREDS)
    // The list endpoint is the only way to learn a portfolio the key is not
    // scoped to, so reaching it is what closing this gap would look like.
    expect(reached.some((url) => /\/portfolios(\?|$)/.test(url))).toBe(false)
  })
})
