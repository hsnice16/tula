import { describe, expect, test } from 'bun:test'
import { normalizeAsset, sign } from './kraken.js'

describe('sign', () => {
  // Kraken's published worked example. If this drifts, every private call
  // fails as EAPI:Invalid signature, which reads as a bad key instead.
  test('matches the documented vector', () => {
    const body = new URLSearchParams()
    body.set('nonce', '1616492376594')
    body.set('ordertype', 'limit')
    body.set('pair', 'XBTUSD')
    body.set('price', '37500')
    body.set('type', 'buy')
    body.set('volume', '1.25')

    const secret =
      'kQH5HW/8p1uGOVjbgWA7FunAmGO8lsSUXNsu3eow76sz84Q18fWxnyRzBHCd3pd5nE9qa99HAZtuZuj6F1huXg=='

    expect(sign('/0/private/AddOrder', body, secret)).toBe(
      '4/dpxb3iT4tp/ZCVEwSnEsLxx0bqyhLpdfOpc6fn7OR8+UClSV5n9E6aSS8MPtnRfp32bAb0nmbRn6H8ndwLUQ==',
    )
  })

  test('rejects a secret that is not base64', () => {
    const body = new URLSearchParams({ nonce: '1' })
    expect(() => sign('/0/private/Balance', body, 'not-base64!')).toThrow()
  })
})

describe('normalizeAsset', () => {
  test('strips legacy four-character X and Z prefixes', () => {
    expect(normalizeAsset('XXBT')).toEqual({ asset: 'BTC', kind: 'spot' })
    expect(normalizeAsset('XETH')).toEqual({ asset: 'ETH', kind: 'spot' })
    expect(normalizeAsset('ZUSD')).toEqual({ asset: 'USD', kind: 'spot' })
    expect(normalizeAsset('XXDG')).toEqual({ asset: 'DOGE', kind: 'spot' })
  })

  test('leaves three-character codes alone', () => {
    expect(normalizeAsset('XRP')).toEqual({ asset: 'XRP', kind: 'spot' })
    expect(normalizeAsset('XTZ')).toEqual({ asset: 'XTZ', kind: 'spot' })
    expect(normalizeAsset('USDT')).toEqual({ asset: 'USDT', kind: 'spot' })
  })

  test('reads yield suffixes as staked', () => {
    expect(normalizeAsset('ETH.S')).toEqual({ asset: 'ETH', kind: 'staked' })
    expect(normalizeAsset('XBT.M')).toEqual({ asset: 'BTC', kind: 'staked' })
    expect(normalizeAsset('DOT.B')).toEqual({ asset: 'DOT', kind: 'staked' })
  })
})
