import { describe, expect, test } from 'bun:test'
import { CHAINS, chainById } from './chains.js'
import { assetOn, BRIDGED } from './symbols.js'

const arbitrum = chainById('arbitrum')
const polygon = chainById('polygon')
const gnosis = chainById('gnosis')

describe('a token is its issue, not its ticker', () => {
  test('one bridge contract is one asset whichever venue spells it', () => {
    // Aave's Arbitrum market answers `USDC` from the contract Arbitrum's list
    // calls `USDC.e`; read by ticker, the wallet and Aave rows never met.
    const bridged = '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8'
    expect(assetOn(arbitrum, bridged, 'USDC')).toBe('arbitrum:USDC.E')
    expect(assetOn(arbitrum, bridged, 'USDC.e')).toBe('arbitrum:USDC.E')
  })

  test('the issuer’s token and a bridge’s on one chain are two assets, so an Aave market listing both keeps both', () => {
    const native = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831'
    expect(assetOn(arbitrum, native, 'USDC')).toBe('USDC')
    expect(assetOn(arbitrum, '0xff970a61a04b1ca14834a43f5de4533ebddb5cc8', 'USDC')).not.toBe('USDC')
  })

  test('a ticker an issuer claims, on a contract its list does not name, is not the issuer’s', () => {
    // Circle issues no USDC on Gnosis; whatever answers to it there is a bridge's.
    expect(assetOn(gnosis, `0x${'12'.repeat(20)}`, 'USDC')).toBe('gnosis:USDC')
  })

  test('a `.e` token is a bridge’s by its own name, even where nothing here lists the contract', () => {
    expect(assetOn(polygon, `0x${'34'.repeat(20)}`, 'LINK.e')).toBe('polygon:LINK.E')
  })

  test('USDT0 is one issue on every chain it is on, and not Tether’s USDT', () => {
    const names = [
      assetOn(arbitrum, '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9', 'USD₮0'),
      assetOn(polygon, '0xc2132d05d31c914a87c6611c10748aeb04b58e8f', 'USDT'),
      assetOn(chainById('optimism'), '0x01bff41798a0bcf287b996046ca68b395dbc1071', 'USDT0'),
    ]
    expect(new Set(names)).toEqual(new Set(['USDT0']))
  })

  test('WETH is ether on the chains ether is gas on, and a bridge’s everywhere else', () => {
    const weth = `0x${'56'.repeat(20)}`
    for (const chain of CHAINS.filter((c) => c.nativeSymbol === 'ETH')) expect(assetOn(chain, weth, 'WETH')).toBe('ETH')
    expect(assetOn(polygon, weth, 'WETH')).toBe('polygon:WETH')
    expect(assetOn(chainById('linea'), `0x${'78'.repeat(20)}`, 'WAVAX')).toBe('linea:WAVAX')
    expect(assetOn(chainById('avalanche'), `0x${'78'.repeat(20)}`, 'WAVAX')).toBe('AVAX')
  })

  test('a ticker no issuer here claims keeps netting across chains', () => {
    expect(assetOn(arbitrum, `0x${'9a'.repeat(20)}`, 'uni')).toBe('UNI')
    expect(assetOn(polygon, undefined, 'POL')).toBe('POL')
  })

  test('every bridge contract named here sits on a chain in the build', () => {
    for (const at of Object.keys(BRIDGED)) {
      expect(CHAINS.some((c) => c.eip155 === Number(at.split(':')[0]))).toBe(true)
    }
  })
})
