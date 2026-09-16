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
    // Circle issues no USDC on Arbitrum at this contract; whatever answers to it is a bridge's.
    expect(assetOn(arbitrum, `0x${'12'.repeat(20)}`, 'USDT')).toBe('arbitrum:USDT')
  })

  test('a contract no table names cannot take a name a known contract or a pinned price answers to', () => {
    const stranger = `0x${'ab'.repeat(20)}`
    const ethereum = chainById('ethereum')
    // A symbol spelled as tula's own scoped name, as a token list could carry it.
    expect(assetOn(ethereum, stranger, 'optimism:usdt')).toBe('ethereum:OPTIMISM.USDT@ababab')
    for (const ticker of ['XDAI', 'USDT0', 'BTC', 'ETH', 'SOL']) {
      expect(assetOn(ethereum, stranger, ticker)).toBe(`ethereum:${ticker}@ababab`)
    }
    // The bridged Gnosis USDC is one contract; another calling itself USDC is not it.
    expect(assetOn(gnosis, stranger, 'USDC')).toBe('gnosis:USDC@ababab')
    expect(assetOn(arbitrum, stranger, 'USDC.e')).toBe('arbitrum:USDC.E@ababab')
  })

  test('the contracts and gas tokens the tables know keep their names', () => {
    expect(assetOn(gnosis, undefined, 'xDAI')).toBe('XDAI')
    expect(assetOn(gnosis, '0xe91d153e0b41518a2ce8dd3d7944fa863463a97d', 'WXDAI')).toBe('XDAI')
    expect(assetOn(gnosis, '0xddafbb505ad214d7b80b1f830fccc89b60fb7a83', 'USDC')).toBe('gnosis:USDC')
    expect(assetOn(arbitrum, '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9', 'USDT0')).toBe('USDT0')
    expect(assetOn(chainById('ethereum'), '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', 'USDC')).toBe('USDC')
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
    const canonical: Record<string, string> = {
      ethereum: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
      arbitrum: '0x82af49447d8a07e3bd95bd0d56f35241523fbab1',
      base: '0x4200000000000000000000000000000000000006',
      optimism: '0x4200000000000000000000000000000000000006',
      scroll: '0x5300000000000000000000000000000000000004',
      linea: '0xe5d7c2a44ffddf6b295a15c148167daaaf5cf34f',
    }
    for (const chain of CHAINS.filter((c) => c.nativeSymbol === 'ETH')) {
      expect(assetOn(chain, canonical[chain.id], 'WETH')).toBe('ETH')
    }
    expect(assetOn(polygon, '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619', 'WETH')).toBe('polygon:WETH')
    expect(assetOn(polygon, weth, 'WETH')).toBe('polygon:WETH@565656')
    expect(assetOn(chainById('linea'), '0x5471ea8f739dd37e9b81be9c5c77754d8aa953e4', 'WAVAX')).toBe('linea:WAVAX')
    expect(assetOn(chainById('linea'), `0x${'78'.repeat(20)}`, 'WAVAX')).toBe('linea:WAVAX@787878')
    expect(assetOn(chainById('avalanche'), '0xb31f66aa3c1e785363f0875a1b74e27b85fd66c7', 'WAVAX')).toBe('AVAX')
    expect(assetOn(polygon, '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270', 'WMATIC')).toBe('POL')
  })

  test('a contract calling itself a wrap, other than the chain’s own, nets with neither the gas token nor its price', () => {
    const fake = `0x${'56'.repeat(20)}`
    expect(assetOn(arbitrum, fake, 'WETH')).toBe('arbitrum:WETH@565656')
    expect(assetOn(chainById('avalanche'), fake, 'WAVAX')).toBe('avalanche:WAVAX@565656')
    expect(assetOn(gnosis, fake, 'WXDAI')).toBe('gnosis:WXDAI@565656')
    expect(assetOn(polygon, fake, 'WPOL')).toBe('polygon:WPOL@565656')
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

  /**
   * Table-driven over BRIDGED itself rather than a handful of tickers: the guard
   * used to be consulted only for a ticker that also wraps, is issued, or ends
   * `.e`, which left ten of these — GNO, LINK, UNI, USDBC and the rest — handing
   * an impostor the bare ticker to net and price as the real asset.
   */
  test('an impostor on a chain that has a bridge of that ticker never takes the bare ticker', () => {
    const fake = `0x${'77'.repeat(20)}`
    for (const [at, ticker] of Object.entries(BRIDGED)) {
      const chain = CHAINS.find((c) => c.eip155 === Number(at.split(':')[0]))
      if (!chain) continue
      const got = assetOn(chain, fake, ticker)
      expect({ chain: chain.id, ticker, got }).toEqual({
        chain: chain.id,
        ticker,
        got: `${chain.id}:${ticker}@777777`,
      })
    }
  })

  test('the real bridge contract still scopes to its chain', () => {
    for (const [at, ticker] of Object.entries(BRIDGED)) {
      const [eip, address] = at.split(':')
      const chain = CHAINS.find((c) => c.eip155 === Number(eip))
      if (!chain || !address) continue
      expect({ at, got: assetOn(chain, address, ticker) }).toEqual({ at, got: `${chain.id}:${ticker}` })
    }
  })
})
