import type { ConstraintKind, RootKind } from '@ark/schema'
import { constraintKinds, rootKinds } from '@ark/schema'

/**
 * arktype's own taxonomy of nodes, and this package's decision about each one.
 *
 * `@ark/schema` is to arktype what `zod/v4/core` is to zod, and it is the more public of the two: it
 * publishes the kinds as ordered lists with types over them, rather than leaving a reader to recover
 * the set from the exports. So the lists below are held against arktype's own rather than derived
 * from what it happens to export.
 *
 * A root is what a schema is. A constraint is what a schema says about its values. Both are
 * classified here, and both assertions exist for the same reason: a kind arktype adds is a compile
 * error naming the kind, rather than a schema that reads as nothing or a constraint that quietly
 * goes missing from every document.
 */

/**
 * The roots this package reads, which is all seven of them.
 *
 * No unread list, because there is nothing in it. The assertion below still earns its place: it is
 * what makes an eighth root a compile error rather than a schema reaching the reading's last branch.
 */
export const ReadArkRoots = [
  'domain',
  'unit',
  'union',
  'proto',
  'intersection',
  'morph',
  'alias'
] as const satisfies readonly RootKind[]

export type ReadArkRoots = (typeof ReadArkRoots)[number]

type UnreadArkRoots = Exclude<RootKind, ReadArkRoots>

const _everyArkRootIsRead: [UnreadArkRoots] extends [never]
  ? true
  : { 'arktype states a root this package does not read': UnreadArkRoots } = true
void _everyArkRootIsRead

/** Whether a kind is one this package reads, narrowing so the reading's dispatch can be total. */
export function isReadArkRoot(kind: string): kind is ReadArkRoots {
  return (ReadArkRoots as readonly string[]).includes(kind)
}

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

/** Every kind arktype states, for a spec that holds the lists to arktype's own count. */
export const ArkKinds = { rootKinds, constraintKinds } as const
