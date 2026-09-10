import type { CoverageCost } from '../core/coverage.js'
import { TulaError } from '../core/errors.js'
import type { Position, Venue } from '../core/position.js'

/**
 * Part of a venue answered and part of it did not.
 *
 * A venue spread over several chains has several independent ways to fail, and
 * an all-or-nothing throw makes the whole book hostage to whichever public node
 * is rate-limiting: three chains read fine and the reader is shown nothing.
 * Thrown rather than returned so a caller that has not been taught about it
 * still degrades loudly — it is a `TulaError`, so the failure text is what
 * reaches the screen, and the rows are lost rather than passed off as complete.
 *
 * `failures` are already sentences: each one names the chain it happened on,
 * which is the whole point of separating them.
 */
export class PartialRead extends TulaError {
  constructor(
    readonly positions: readonly Position[],
    readonly failures: readonly string[],
  ) {
    super(failures.join(' '))
  }
}

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
  /**
   * Moving money without trading it or sending it off the venue — a margin
   * loan, a transfer between wallets, a push to a sub-account. Optional only
   * until every connector reports it; a venue that cannot say leaves it out.
   */
  canMoveFunds?: ScopeVerdict
}

/** Anything broader than read-only that we positively confirmed. */
export function isOverScoped(scope: KeyScope): boolean {
  return overScopedPowers(scope).length > 0
}

/**
 * What to tell someone their key can do, in the words a refusal uses. One
 * function because the sentence is composed at more than one call site, and a
 * new power added to `KeyScope` and not to those was a refusal that named none.
 */
export function overScopedPowers(scope: KeyScope): string[] {
  return [
    scope.canTrade === true && 'trade',
    scope.canWithdraw === true && 'withdraw',
    scope.canMoveFunds === true && 'move funds between wallets',
  ].filter((power): power is string => typeof power === 'string')
}

export function unverified(scope: KeyScope): Array<'trade' | 'withdraw'> {
  const out: Array<'trade' | 'withdraw'> = []
  if (scope.canTrade === 'unknown') out.push('trade')
  if (scope.canWithdraw === 'unknown') out.push('withdraw')
  return out
}

/**
 * Venues tula used to offer. The connector goes; the credential somebody saved
 * for it does not — it is still in their store, `listVenues()` still returns it,
 * and without an entry here every surface either omits the venue from a book
 * that reports itself complete or names it as one this build has never heard of.
 *
 * `revoke` is where the credential still lives after `/forget` has taken tula's
 * copy: forgetting a key is not revoking it, and a venue dropped because its key
 * can move money is exactly the one that must not be left valid.
 */
const RETIRED: Readonly<Record<string, { why: string; revoke: string }>> = {
  circle: {
    why:
      'Circle Mint was removed: it issues no read-only key, and tula will not hold ' +
      'one that can create payouts and transfers.',
    revoke: 'the Circle Mint console',
  },
}

/** The ids `retired` answers for — what the site must have stopped offering. */
export const RETIRED_VENUES: readonly string[] = Object.keys(RETIRED)

/** Whether tula used to offer this venue. The sentence needs a surface; this does not. */
export function isRetired(venueId: string): boolean {
  return venueId in RETIRED
}

/**
 * What became of a venue that is no longer in the build, or undefined for an id
 * that was never one. One sentence, no newlines: it is read as a failure line,
 * as a `/venues` cell and on its own.
 *
 * `forget` is the delete as the reader would type it where they are reading it —
 * `/forget circle` in the shell, `tula forget circle` on the command line. The
 * spelling was hardcoded here, so the one-shot CLI printed a slash command that
 * is a path in a real shell. It is a parameter rather than a call into
 * `src/cli/registry.ts`: a connector importing the command surface is the
 * layering inversion `scripts/guard.sh` walks the import graph to refuse.
 */
export function retired(venueId: string, forget: string): string | undefined {
  const entry = RETIRED[venueId]
  if (!entry) return undefined
  return `${entry.why} Remove the stored key with ${forget}, then revoke it in ${entry.revoke}.`
}

/** What is on disk, sorted by what this build can do with it. */
export interface StoredVenues {
  /** The venues a load asks. This is the count every surface means by "venues". */
  read: string[]
  /** Stored, and dropped from the build. Not connected, and nothing failed. */
  removed: string[]
}

/**
 * The one split behind every count of venues. The banner named what was in the
 * store and the status line counted what came back from it, so a reader with a
 * retired credential was told three venues were connected, two were loaded and
 * one had failed — three numbers about the same two venues, on one screen.
 *
 * `known` is the ids this build has a connector for; an id in neither list is
 * in neither bucket, because `Session` fails it by name and a count is not the
 * place to explain a credential nobody can account for.
 */
export function storedVenues(stored: readonly string[], known: Iterable<string>): StoredVenues {
  const inBuild = new Set(known)
  return {
    read: stored.filter((id) => inBuild.has(id)),
    removed: stored.filter((id) => !inBuild.has(id) && isRetired(id)),
  }
}

/**
 * Re-exported from `src/core/coverage.ts` rather than spelled again: the reader
 * of a manifest and the writer of one have to agree on the list, and two copies
 * of a union agree only until somebody adds a fourth cost to one of them.
 */
export type { CoverageCost }

export interface CoverageGap {
  what: string
  why: string
  hides: CoverageCost

  /**
   * The task file that would close this gap, as a repo-relative path.
   *
   * Required, and that is the whole point of it. Declaring a gap costs one
   * object and creates no obligation, so gaps accumulated faster than anybody
   * filed them: thirty were declared and thirteen were in no plan at all, two
   * of them hiding a liquidation and mentioned in no file in the repository.
   * A prose list in `ROADMAP.md` cannot catch that — it drifts in the same
   * silence. This makes the declaration and the plan one edit, and
   * `src/coverage-plan.test.ts` fails the build when the path is not a real
   * task, when it points at a `done` task that will never reopen, or when
   * `ROADMAP.md` does not account for it.
   *
   * It is where the work would go, not a promise about when.
   */
  plan: string
}

/**
 * What a connector reads, and what it knowingly does not.
 *
 * Declared rather than inferred because the failure this exists to stop is
 * silent: a venue that answers about the half of an account it read, with
 * nothing on screen to say the other half was never asked for.
 *
 * Every entry in `doesNotRead` is held open by a test that asserts the gap is
 * still there, so closing one breaks the test and the declaration has to go in
 * the same change. Without that the drift runs the other way — a connector
 * claiming not to read what it now reads.
 */
export interface Coverage {
  reads: readonly string[]
  doesNotRead: readonly CoverageGap[]
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

  /**
   * Powers this venue exposes no way to check, so `verifyScope` returns
   * `'unknown'` for them on every key it accepts.
   *
   * Declared beside `verifyScope` because the two have to agree and are read
   * together: the connect screen already says what could not be proven, and
   * `/<venue> status` said "checked as read-only" regardless — contradicting
   * it on the screen somebody opens to check exactly that.
   */
  readonly unprovable?: readonly ('trade' | 'withdraw')[]

  /**
   * Optional for the `Connector` doubles in the `src/cli` and `src/ui` tests,
   * which stand in for a venue and have no account behind them to disclose
   * about. Nothing shipped may leave it out, and
   * `src/connectors/registry.test.ts` is what says so: a venue with no manifest
   * contributes no areas to `disclosure()`, so it reads as a venue nothing was
   * missed on — which is the failure the declaration exists to stop, arriving
   * as an omission rather than as a wrong line.
   */
  readonly coverage?: Coverage

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
