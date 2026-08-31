import { describe, expect, test } from 'bun:test'
import {
  createPublicKey,
  createSign,
  createVerify,
  generateKeyPairSync,
  verify as edVerify,
} from 'node:crypto'
import { buildJwt, derToJose, loadKey, normalizeKey } from './coinbase.js'

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
