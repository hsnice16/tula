import type { Position, Venue } from '../core/position.js'

export interface ConnectorCredentials {
  readonly [field: string]: string
}

/**
 * Tri-state because some venues expose no way to read a key's permissions.
 * `'unknown'` must never be collapsed to `false` — telling someone their key
 * cannot withdraw when we did not check is worse than saying nothing.
 */
export type ScopeVerdict = boolean | 'unknown'

export interface KeyScope {
  canRead: boolean
  canTrade: ScopeVerdict
  canWithdraw: ScopeVerdict
}

/** Anything broader than read-only that we positively confirmed. */
export function isOverScoped(scope: KeyScope): boolean {
  return scope.canTrade === true || scope.canWithdraw === true
}

export function unverified(scope: KeyScope): Array<'trade' | 'withdraw'> {
  const out: Array<'trade' | 'withdraw'> = []
  if (scope.canTrade === 'unknown') out.push('trade')
  if (scope.canWithdraw === 'unknown') out.push('withdraw')
  return out
}

export interface CredentialField {
  /** Key in ConnectorCredentials. */
  name: string
  label: string
  /** Never echoed, never shown back. An address is not secret; a key is. */
  secret: boolean
  hint?: string
}

export interface HelpLink {
  label: string
  url: string
}

/**
 * What the connect screen actually needs: a name, what to ask for, and something
 * that refuses an over-scoped credential. A price source satisfies this without
 * being a venue — it holds no positions, and inventing a `VenueKind` for it would
 * put a non-venue in the canonical model.
 */
export interface Connectable {
  readonly id: string
  readonly name: string
  readonly fields: readonly CredentialField[]
  readonly help: readonly HelpLink[]
  verifyScope(creds: ConnectorCredentials): Promise<KeyScope>
}

export interface Connector {
  readonly venue: Venue

  /** What connecting asks for. Drives the in-app connect flow and its masking. */
  readonly fields: readonly CredentialField[]

  /** Official pages only. Shown at the step where they are needed, not in a
   *  docs dump — someone pasting an API key should not have to go looking. */
  readonly help: readonly HelpLink[]

  /**
   * Refuse anything broader than read-only. Verified at connect time rather
   * than documented, because a key that can withdraw is the whole risk.
   */
  verifyScope(creds: ConnectorCredentials): Promise<KeyScope>

  fetchPositions(creds: ConnectorCredentials): Promise<Position[]>
}

export function connectable(connector: Connector): Connectable {
  return {
    id: connector.venue.id,
    name: connector.venue.name,
    fields: connector.fields,
    help: connector.help,
    verifyScope: (creds) => connector.verifyScope(creds),
  }
}
