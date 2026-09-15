import type { Chain } from './chains.js'

/**
 * One canonical spelling per asset, shared by every connector that reads a
 * chain.
 *
 * It lived inside the Aave connector, so a wallet holding WETH and an Aave
 * market supplying WETH produced two rows that never netted — one asset shown
 * as two, which is the whole failure this tool exists to close. A venue also
 * decides its own case: Hyperliquid answers `PURR` for the spot market and
 * `purr` for the same coin elsewhere, and two rows came back for one balance.
 */

/**
 * A wrap nets with the gas token it wraps, one-for-one and trustlessly — and
 * only on the chain where that token is gas. WPOL was `WMATIC` before the
 * rename, one contract.
 *
 * Nothing else is on this list, and the omissions are the point: wstETH, weETH
 * and the Unit-bridged UBTC/UETH are not one-for-one with what they are named
 * after, and WBTC carries custodian risk. Netting any of them would report a
 * peg or a custodian as though it could not break.
 */
const WRAPS: Readonly<Record<string, string>> = {
  WETH: 'ETH',
  WPOL: 'POL',
  WMATIC: 'POL',
  WAVAX: 'AVAX',
  WXDAI: 'XDAI',
}

/**
 * Upper-cases first: a venue's casing is presentation, and letting it through
 * splits one holding into two rows that can never net.
 */
export function canonical(symbol: string): string {
  const upper = symbol.trim().toUpperCase()
  return WRAPS[upper] ?? upper
}

const key = (chain: Chain, address: string): string => `${chain.eip155}:${address.toLowerCase()}`

/**
 * The issuer's own contracts for the tickers a bridge also issues under. A
 * contract carrying one of these tickers anywhere else is a bridge's claim on
 * the asset, not the asset.
 *
 * USDC is Circle's contract-address page, which lists Linea where CoinGecko
 * still files it as bridged; USDT is Tether's supported-protocols page; the
 * rest are the chains CoinGecko files under the issuer's own coin.
 */
export const ISSUED: Readonly<Record<string, ReadonlySet<string>>> = Object.fromEntries(
  Object.entries({
    USDC: [
      '1:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      '42161:0xaf88d065e77c8cc2239327c5edb3a432268e5831',
      '8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
      '137:0x3c499c542cef5e3811e1192ce70d8cc03d5c3359',
      '10:0x0b2c639c533813f4aa9d7837caf62653d097ff85',
      '43114:0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e',
      '59144:0x176211869ca2b568f2a7d4ee941e073a821ee1ff',
    ],
    USDT: ['1:0xdac17f958d2ee523a2206206994597c13d831ec7', '43114:0x9702230a8ea53601f5cd2dc00fdbc13d4df4a8c7'],
    DAI: ['1:0x6b175474e89094c44da98b954eedeac495271d0f'],
    BUSD: ['1:0x4fabb145d64652a948d72533023f6e7a623c7c53'],
    WBTC: [
      '1:0x2260fac5e5542a773aa44fbcfedf7c193bc2c599',
      '8453:0x0555e30da8f98308edb960aa94c0db47230d2b9c',
      '43114:0x0555e30da8f98308edb960aa94c0db47230d2b9c',
      '10:0x68f180fcce6836688e9084f035309e29bf0a2095',
    ],
    WSTETH: ['1:0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0'],
    WEETH: [
      '1:0xcd5fe23c85820f7b72d0926fc9b05b43e359b7ee',
      '8453:0x04c0599ae5a44757c0af6f9ec3b93da8976c150a',
      '10:0x5a7facb970d094b6c7ff1df0ea68d99e6e73cbff',
      '43114:0xa3d68b74bf0528fdd07263c60d6488749044914b',
      '534352:0x01f0a31698c4d065659b9bdc21b3610292a1c506',
      '59144:0x1bf74c010e6320bab11e2e5a532b5ac15e0b8aa6',
    ],
  }).map(([ticker, contracts]) => [ticker, new Set(contracts)]),
)

/**
 * Bridge-issued contracts CoinGecko files under a coin of their own, by the
 * ticker their bridge spells them with. A venue does not agree on that
 * spelling — Aave's Arbitrum market answers `USDC` from the contract Arbitrum's
 * list calls `USDC.e` — so the contract names it and both reads meet.
 */
export const BRIDGED: Readonly<Record<string, string>> = {
  '42161:0xff970a61a04b1ca14834a43f5de4533ebddb5cc8': 'USDC.E',
  '137:0x2791bca1f2de4661ed88a30c99a7a9449aa84174': 'USDC.E',
  '10:0x7f5c764cbc14f9669b88837ca1490cca17c31607': 'USDC.E',
  '43114:0xa7d7079b0fead91f3e65f86e8915cb59c1a4c664': 'USDC.E',
  '100:0x2a22f9c3b484c3629090feed35f17ff8f88f76f0': 'USDC.E',
  '100:0xddafbb505ad214d7b80b1f830fccc89b60fb7a83': 'USDC',
  '534352:0x06efdbff2a14a7c8e15944d1f4a48f9f95f663a4': 'USDC',
  '8453:0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca': 'USDBC',
  '10:0x94b008aa00579c1307b0ef2c499ad98a8ce58e58': 'USDT',
  '100:0x4ecaba5870353805a9f068101a40e0f32ed605c6': 'USDT',
  '534352:0xf55bec9cafdbe8730f096aa55dad6d22d44099df': 'USDT',
  '59144:0xa219439258ca9da29e9cc4ce5596924745e12b93': 'USDT',
  '42161:0xda10009cbd5d07dd0cecc66161fc93d7c9000da1': 'DAI',
  '10:0xda10009cbd5d07dd0cecc66161fc93d7c9000da1': 'DAI',
  '8453:0x50c5725949a6f0c72e6c4a641f24049a917db0cb': 'DAI',
  '137:0x8f3cf7ad23cd3cadbd9735aff958023239c6a063': 'DAI',
  '100:0x44fa8e6f47987339850636f88629646662444217': 'DAI',
  '59144:0x4af15ec2a0bd43db75dd04e62faa3b8ef36b00d5': 'DAI',
  '43114:0xd586e7f844cea2f87f50152665bcbc2c279d8d70': 'DAI.E',
  '42161:0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f': 'WBTC',
  '137:0x1bfd67037b42cf73acf2047067bd4f2c47d9bfd6': 'WBTC',
  '100:0x8e5bbbb09ed1ebde8674cda39a0c169401db4252': 'WBTC',
  '534352:0x3c1bca5a656e69edcd0d4e36bebb3fcdaca60cf1': 'WBTC',
  '59144:0x3aab2285ddcddad8edf438c1bab47e1a9d05a9b4': 'WBTC',
  '43114:0x50b7545627a5162f82a992c33b87adc75187b218': 'WBTC.E',
  '137:0x7ceb23fd6bc0add59e62ac25578270cff1b9f619': 'WETH',
  '100:0x6a023ccd1ff6f2045c3309768ead9e68f978f6e1': 'WETH',
  '43114:0x49d5c2bdffac6ce2bfdb6640f4f80f226bc10bab': 'WETH.E',
  '59144:0x5471ea8f739dd37e9b81be9c5c77754d8aa953e4': 'WAVAX',
  '42161:0x5979d7b546e38e414f7e9822514be443a4800529': 'WSTETH',
  '8453:0xc1cba3fcea344f92d9239c08c0568f6f2f0ee452': 'WSTETH',
  '137:0x03b54a6e9a984069379fae1a4fc4dbae93b3bccd': 'WSTETH',
  '10:0x1f32b1c2345538c0c6f582fcb022739c4a194ebb': 'WSTETH',
  '100:0x6c76971f98945ae98dd7d4dfca8711ebea946ea6': 'WSTETH',
  '534352:0xf610a9dfb7c89644979b4a0f27063e9e7d7cda32': 'WSTETH',
  '59144:0xb5bedd42000b71fdde22d3ee8a79bd49a568fc8f': 'WSTETH',
  '42161:0x35751007a407ca6feffe80b3cb397736d2cf4dbe': 'WEETH',
  '10:0x9c9e5fd8bbc25984b178fdce6117defa39d2db39': 'BUSD',
  '43114:0x9c9e5fd8bbc25984b178fdce6117defa39d2db39': 'BUSD',
  '100:0xdd96b45877d0e8361a4ddb732da741e97f3191ff': 'BUSD',
  '59144:0x7d43aabc515c356145049227cee54b608342c0ad': 'BUSD',
  '59144:0xe516a5cff996cc399efbb48355fd5ab83438e7a9': 'GNO',
  '59144:0x0e076aafd86a71dceac65508daf975425c9d0cb6': 'LDO',
  '59144:0x5b16228b94b68c7ce33af2acc5663ebde4dcfa2d': 'LINK',
  '59144:0x636b22bc471c955a8db60f28d4795066a8201fa3': 'UNI',
  '59144:0x265b25e22bcd7f10a5bd6e6410f10537cc7567e8': 'MATIC',
  '43114:0x130966628846bfd36ff31a822705796e8cb8c18d': 'MIM',
  '10:0xdfa46478f9e5ea86d57387849598dbfb2e964b02': 'MAI',
  '43114:0x5c49b268c9841aff1cc3b0a418ff5c3442ee3f3b': 'MAI',
  '100:0xaf204776c7245bf4147c2612bf6e5972ee483701': 'SDAI',
  '534352:0x95a52ec1d60e74cd3eb002fe54a2c74b185a4c16': 'SKY',
}

/**
 * USDT0 is one LayerZero issue on every chain it is on, so it nets across them
 * — with itself, not with Tether's USDT. Aave spells it `USD₮0` and Polygon's
 * list `USDT`.
 */
const OMNICHAIN: Readonly<Record<string, string>> = {
  '42161:0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9': 'USDT0',
  '137:0xc2132d05d31c914a87c6611c10748aeb04b58e8f': 'USDT0',
  '10:0x01bff41798a0bcf287b996046ca68b395dbc1071': 'USDT0',
}

/**
 * The asset a token on a chain is, which is its issue rather than its ticker:
 * a bridge's USDC nets with neither Circle's nor another bridge's, so a depeg on
 * one is never averaged away inside the others.
 *
 * A bridge's token is named `chain:TICKER`, the shape Hyperliquid gives a
 * builder dex's `xyz:TSLA` — one word, so it is typed and completed as a `/shock`
 * argument like any other asset. DeBank and Zerion show the ticker with the
 * chain beside it, which a table column cannot. A `.e` suffix is a bridge's own
 * mark, so it is scoped even where no table here names the contract.
 *
 * A contract CoinGecko does not file keeps netting by ticker unless the ticker
 * is one an issuer above claims: nothing can say what it is an issue of.
 */
export function assetOn(chain: Chain, address: string | undefined, symbol: string): string {
  if (address === undefined) return canonical(symbol)
  const at = key(chain, address)
  const omnichain = OMNICHAIN[at]
  if (omnichain) return omnichain
  const ticker = BRIDGED[at] ?? symbol.trim().toUpperCase()
  const scoped = `${chain.id}:${ticker}`
  const unwrapped = WRAPS[ticker]
  if (unwrapped) return unwrapped === canonical(chain.nativeSymbol) ? unwrapped : scoped
  const issued = ISSUED[ticker]
  if (BRIDGED[at] || ticker.endsWith('.E') || (issued && !issued.has(at))) return scoped
  return ticker
}
