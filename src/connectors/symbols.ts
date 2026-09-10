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
 * WETH is redeemable for ETH one-for-one and trustlessly, so it is the same
 * exposure and must net with it.
 *
 * Nothing else is on this list, and the omissions are the point: wstETH, weETH
 * and the Unit-bridged UBTC/UETH are not one-for-one with what they are named
 * after, and WBTC carries custodian risk. Netting any of them would report a
 * peg or a custodian as though it could not break.
 *
 * The bridged stablecoins are the same omission read across chains, and now
 * that three chains are on one book they are the ones a reader will meet:
 * `USDC.e` on Arbitrum and `USDbC` on Base are bridge-issued, not Circle-issued
 * and not redeemable at Circle, and `USDT0` is an omnichain issue rather than
 * the Ethereum USDT. Each is its own row. That a price source quotes one of
 * them at a dollar is that source's claim about a peg, and it arrives attached
 * to the number rather than built into the asset it is filed under — spelled
 * into this map, the claim would be tula's, and a de-pegged bridge would net
 * silently into the thing it failed to be.
 */
const CANONICAL: Readonly<Record<string, string>> = { WETH: 'ETH' }

/**
 * Upper-cases first: a venue's casing is presentation, and letting it through
 * splits one holding into two rows that can never net.
 */
export function canonical(symbol: string): string {
  const upper = symbol.trim().toUpperCase()
  return CANONICAL[upper] ?? upper
}
