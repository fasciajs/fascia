import type { ConstraintKind } from '@ark/schema'
import { constraintKinds } from '@ark/schema'

/**
 * What a schema says about its values, and this package's decision about each one.
 *
 * `@ark/schema` is to arktype what `zod/v4/core` is to zod, and it is the more public of the two: it
 * publishes the kinds as ordered lists with types over them, rather than leaving a reader to recover
 * the set from the exports. So the lists below are held against arktype's own.
 *
 * **Only the constraints, because only the constraints need saying.** A root is what a schema is,
 * and the reading dispatches on `RootKind` and ends in `satisfies never`, so a root arktype adds is
 * already a compile error at the dispatch. A second list of roots beside that one would be a copy of
 * what the switch enumerates, and a spec over it would assert that the copy matches.
 *
 * A constraint has no such dispatch. The reading reaches `inner.minLength` and the rest by name and
 * says nothing about what it did not ask for, so this list is the only thing that would report a
 * constraint arktype adds.
 */

/**
 * The constraints this package reads, each of which reaches an assertion or a shape.
 *
 * The five structural ones are read as shapes rather than as assertions: a `structure` holds the
 * `required`, `optional`, `index` and `sequence` that say what an object or an array is made of.
 */
export const ReadArkConstraints = [
  'min',
  'max',
  'minLength',
  'maxLength',
  'exactLength',
  'before',
  'after',
  'pattern',
  'divisor',
  'structure',
  'required',
  'optional',
  'index',
  'sequence'
] as const satisfies readonly ConstraintKind[]

export type ReadArkConstraints = (typeof ReadArkConstraints)[number]

/**
 * The constraints with nothing to say about what a caller may send, each with the reason.
 *
 * One so far, and it is the one that cannot be read in principle rather than for want of somewhere
 * to put it.
 */
export const UnreadArkConstraints = {
  predicate:
    'this states a function, and a function says nothing a reader of a document could check'
} as const satisfies Partial<Record<ConstraintKind, string>>

export type UnreadArkConstraints = keyof typeof UnreadArkConstraints

/**
 * Every constraint is in one list or the other.
 *
 * The assertion this file exists for. `before` and `after` were absent from the reading when the
 * lists were first written, and this is what said so: a Date bound stated by a caller reached no
 * assertion, and no test failed because no test knew to ask.
 */
type UnclassifiedArkConstraints = Exclude<ConstraintKind, ReadArkConstraints | UnreadArkConstraints>

const _everyArkConstraintIsClassified: [UnclassifiedArkConstraints] extends [never]
  ? true
  : {
      'arktype states a constraint that is neither read nor unread': UnclassifiedArkConstraints
    } = true
void _everyArkConstraintIsClassified

/** Neither list names a constraint twice, which `Exclude` above would hide. */
type ArkConstraintsInBothLists = Extract<ReadArkConstraints, UnreadArkConstraints>

const _noArkConstraintIsInBothLists: [ArkConstraintsInBothLists] extends [never]
  ? true
  : { 'an arktype constraint is both read and unread': ArkConstraintsInBothLists } = true
void _noArkConstraintIsInBothLists

/** Every constraint arktype states, for a spec that holds the lists to arktype's own count. */
export const ArkConstraintKinds = constraintKinds
