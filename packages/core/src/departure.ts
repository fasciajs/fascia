import { FasciaError, isError } from './result.js'

/**
 * What a spelling gave up, said about the schema rather than about this library.
 *
 * A target cannot say everything a term states, and there are three outcomes rather than two.
 * A spelling is faithful, or it is **lossy and still sound**, or it **cannot be written soundly at
 * all**. Only the third is a failure. Treating the second as one would make a construct unusable
 * against a target where it works and is merely wide.
 *
 * So a spelling returns what it wrote and what it gave up, and a caller decides what to do about
 * the second.
 */

/** Which way a spelling moved, against what the schema accepts. */
export type DepartureDirection =
  /**
   * The document accepts more than the schema.
   *
   * Recoverable. A caller sends something a reader allows and the service refuses, which is a bad
   * error message rather than a broken client.
   */
  | 'wider'
  /**
   * The document accepts less than the schema.
   *
   * Not recoverable by whoever wrote the schema. A working client is turned away by a reader that
   * had no business refusing it.
   */
  | 'narrower'
  /** Neither. Nothing about what the document accepts changed. */
  | 'neither'

/** Why a spelling departed. */
export type DepartureCause =
  /** The target has no keyword for an assertion the schema states. */
  | 'noWordForIt'
  /** The target has no form for the construct, so a wider form was written instead. */
  | 'noShapeForIt'

/** One thing a spelling gave up, and where. */
export interface Departure {
  /**
   * Where in the schema, as the path the walk took to reach it.
   *
   * Built on the way out rather than threaded in. A case that spells a child prefixes whatever the
   * child reported, so nothing has to carry a position down.
   */
  readonly at: readonly string[]
  readonly direction: DepartureDirection
  readonly cause: DepartureCause
  /** Addressed to whoever wrote the schema, and naming what to do instead where there is something. */
  readonly said: string
}

/** What a target wrote, and what writing it gave up. */
export interface Spelled<Written> {
  readonly written: Written
  readonly departures: readonly Departure[]
}

/** A term no target can write soundly, whatever it is willing to give up. */
export class UnsayableTerm extends FasciaError<{ at: readonly string[] }> {
  constructor(at: readonly string[], reason: string) {
    super(`this cannot be written soundly: ${reason}`, { at })
  }
}

/** A spelling, or the reason there is none. */
export type Spelling<Written> = Spelled<Written> | UnsayableTerm

/** Nothing was given up. */
export function faithful<Written>(written: Written): Spelled<Written> {
  return { written, departures: [] }
}

/**
 * Everything a child gave up, reported one step further out.
 *
 * The path comes free this way: a case that spells a child says only which child it was, and the
 * whole path is what the prefixes add up to by the time a caller reads it.
 */
export function under(step: string, departures: readonly Departure[]): readonly Departure[] {
  return departures.map((departure) => ({ ...departure, at: [step, ...departure.at] }))
}

/**
 * A spelling a caller refuses to accept, held to what they will take.
 *
 * **A loss reported is not a loss acted on.** Every target here fills `departures` and, until this,
 * nothing outside a spec read one. A caller publishing a document wants a build to stop rather than
 * a line of prose, and which losses stop it is theirs to decide: a service that must never refuse a
 * value its schema takes cares about `narrower`, and one whose document is a contract cares about
 * every one.
 *
 * Returns the spelling unchanged where nothing it gave up was refused, so this composes with a
 * spelling that already failed and with one that gave up nothing.
 */
export function refusing<Written>(
  spelled: Spelling<Written>,
  directions: readonly DepartureDirection[]
): Spelling<Written> {
  if (isError(spelled)) {
    return spelled
  }

  const refused = spelled.departures.filter((one) => directions.includes(one.direction))
  const [first] = refused
  if (first === undefined) {
    return spelled
  }

  return new UnsayableTerm(
    first.at,
    `this gave up ${refused.length === 1 ? 'one thing' : `${refused.length} things`} a caller refuses: ${refused.map((one) => one.said).join(' ')}`
  )
}
