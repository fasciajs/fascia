import type * as core from 'zod/v4/core'

/**
 * zod's checks, classified the way the schemas are.
 *
 * A check is the other half of what a schema says. Nothing else reports a check nobody read: the
 * schema still reads as its type, the document is merely wider than the schema, and no test fails
 * because no test knew to ask. The lists below turn a check zod adds into a compile error naming it.
 *
 * The values are not read from here. zod folds a check into `_zod.bag` as a schema is built, and
 * that is where the reading takes them, because two constraints arrive at `bag` and never appear as
 * a check at all: `z.int()` and `z.email()` each carry a format and hold no check. So `bag` is where
 * the values are, and this file is where the guarantee is.
 */

/**
 * Every exported class whose instance is a check, keyed by the name of the export.
 *
 * `$ZodCheck` itself is dropped, being the base the concrete ones satisfy.
 */
type ZodCheckClasses = {
  [K in keyof typeof core as (typeof core)[K] extends core.$constructor<infer Instance>
    ? Instance extends core.$ZodCheck<never>
      ? K extends '$ZodCheck'
        ? never
        : K
      : never
    : never]: (typeof core)[K] extends core.$constructor<infer Instance> ? Instance : never
}

/** The same classes, keyed by the discriminant zod puts on a check's def. */
export type ZodChecksByCheck = {
  [K in keyof ZodCheckClasses as ZodCheckClasses[K]['_zod']['def']['check']]: ZodCheckClasses[K]
}

/** The name of a check. */
export type ZodCheckName = keyof ZodChecksByCheck

/**
 * The checks this package reads, each of which reaches an assertion on a node.
 *
 * A name here is a claim that `bag` carries what the check states. What holds the claim is the spec,
 * which builds a schema per name and asserts the assertion arrives.
 */
export const ReadZodChecks = [
  'greater_than',
  'less_than',
  'multiple_of',
  'number_format',
  'bigint_format',
  'min_length',
  'max_length',
  'length_equals',
  'string_format'
] as const satisfies readonly ZodCheckName[]

export type ReadZodChecks = (typeof ReadZodChecks)[number]

/**
 * The checks with nothing to say about what a caller may send, each with the reason.
 *
 * Not unsupported. There is no assertion to write, so saying nothing is the faithful answer, and
 * what makes that a decision rather than an oversight is the name being here.
 */
export const UnreadZodChecks = {
  /** A Set's size, and a Set is not a value JSON carries, so nothing describes the schema either. */
  max_size: 'a size belongs to a Set or a Map, and neither is a value JSON carries',
  min_size: 'a size belongs to a Set or a Map, and neither is a value JSON carries',
  size_equals: 'a size belongs to a Set or a Map, and neither is a value JSON carries',

  /** A media type belongs to how a body is encoded rather than to the value in the body. */
  mime_type: 'a media type describes a body rather than a value inside one',

  /** An assertion about one property of a value, which stands beside no single assertion. */
  property: 'this asserts about one property, and an assertion here describes the whole value',

  /** A conversion. What a conversion produces is not what a caller may send. */
  overwrite: 'this converts the value, and what a conversion produces is not what a caller sends',

  /**
   * A predicate. Its condition is a function, so there is nothing to read: this is the check that
   * cannot be read in principle rather than for want of somewhere to put it.
   */
  custom: 'this states a predicate, and a function says nothing a reader of a document could check'
} as const satisfies Partial<Record<ZodCheckName, string>>

export type UnreadZodChecks = keyof typeof UnreadZodChecks

/**
 * Every check is in one list or the other.
 *
 * The guarantee this file exists for. A check zod adds, or renames, is a compile error naming the
 * check rather than a constraint quietly missing from every document.
 */
type UnclassifiedZodChecks = Exclude<ZodCheckName, ReadZodChecks | UnreadZodChecks>

const _everyZodCheckIsClassified: [UnclassifiedZodChecks] extends [never]
  ? true
  : { 'zod exports a check that is neither read nor unread': UnclassifiedZodChecks } = true
void _everyZodCheckIsClassified

/** Neither list names a check twice, which `Exclude` above would hide. */
type ZodChecksInBothLists = Extract<ReadZodChecks, UnreadZodChecks>

const _noZodCheckIsInBothLists: [ZodChecksInBothLists] extends [never]
  ? true
  : { 'a zod check is both read and unread': ZodChecksInBothLists } = true
void _noZodCheckIsInBothLists
