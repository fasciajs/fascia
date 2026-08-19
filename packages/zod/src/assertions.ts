import type { Bound, Scalar, StringFormat } from '@fasciajs/core'
import { isError, UnreadableSchema } from '@fasciajs/core'
import type * as core from 'zod/v4/core'

/**
 * What a schema asserts about its own values, read from where zod folds it.
 *
 * zod declares `bag` as `Record<string, unknown>`, so this file is a boundary: every value is
 * parsed into a precise type once, here, and nothing downstream reads an unknown.
 *
 * One key of `bag` means three things. `minimum` is a length on a string, a count on an array and a
 * value on a number, a bigint or a date. So a reader is chosen by the scalar being read and never
 * shared, which is also why there is no general `boundOf`.
 */

type Bag = Record<string, unknown>

function numberAt(bag: Bag, key: string): number | undefined {
  const value = bag[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function bigintAt(bag: Bag, key: string): bigint | undefined {
  const value = bag[key]
  return typeof value === 'bigint' ? value : undefined
}

function dateAt(bag: Bag, key: string): Date | undefined {
  const value = bag[key]
  return value instanceof Date ? value : undefined
}

/**
 * A bound on a value, and whether the bound itself is admitted.
 *
 * zod writes an exclusive bound under its own key rather than beside a flag, so the two keys are
 * read in order and the exclusive one wins. A schema stating both on one side is stating one thing
 * twice, and the stricter reading is the exclusive one.
 */
function boundOf<T>(
  bag: Bag,
  inclusiveKey: string,
  exclusiveKey: string,
  read: (bag: Bag, key: string) => T | undefined
): Bound<T> | undefined {
  const exclusive = read(bag, exclusiveKey)
  if (exclusive !== undefined) {
    return { value: exclusive, exclusive: true }
  }

  const inclusive = read(bag, inclusiveKey)
  return inclusive === undefined ? undefined : { value: inclusive, exclusive: false }
}

/**
 * The flags that change what a pattern matches.
 *
 * `i` folds case, `m` moves `^` and `$` to every line, and `s` gives `.` the newline. `g` and `y`
 * hold a position between calls, which a test of one whole value never reads.
 */
const MATCHING_FLAGS = ['i', 'm', 's'] as const

/**
 * The patterns a string states, as sources.
 *
 * zod keeps them in a `Set` of `RegExp`, and a document carries a pattern as text with no flag beside
 * it. **A pattern carrying a flag that changes matching is refused here, where the flag is still
 * readable.** The source alone states a narrower pattern than the schema holds: `/^ab$/i` accepts
 * `AB` and `^ab$` refuses it, so the document turns away a value the service takes. Nothing downstream
 * could report that, because the flag is gone before a term exists and a target cannot give up what it
 * never received.
 *
 * A caller writes the pattern so it matches without the flag. `/^[aA][bB]$/` states what `/^ab$/i`
 * states, and states it somewhere every reader looks.
 */
function patternsOf(bag: Bag): readonly string[] | undefined | UnreadableSchema {
  const patterns = bag['patterns']
  if (!(patterns instanceof Set)) {
    return undefined
  }

  const expressions = [...patterns].filter((one): one is RegExp => one instanceof RegExp)

  for (const expression of expressions) {
    const flags = MATCHING_FLAGS.filter((flag) => expression.flags.includes(flag))
    if (flags.length > 0) {
      return new UnreadableSchema(
        expression,
        `this states the pattern ${expression.source} under the flag ${flags.join(' and ')}, and a document states a pattern with no flag beside it. Write the pattern so it matches without the flag`
      )
    }
  }

  const sources = expressions.map((one) => one.source)
  return sources.length === 0 ? undefined : sources
}

/**
 * The formats a document has a name for, keyed by what zod calls each one.
 *
 * A map rather than a pass-through. zod's format list is longer than the one a document can spell,
 * and a name that reached a target unread would be a keyword no reader knows.
 */
const FORMAT_NAMES: Partial<Record<string, StringFormat>> = {
  email: 'email',
  url: 'uri',
  uuid: 'uuid',
  guid: 'uuid',
  datetime: 'date-time',
  date: 'date',
  time: 'time',
  duration: 'duration',
  ipv4: 'ipv4',
  ipv6: 'ipv6',
  hostname: 'hostname'
}

function formatOf(bag: Bag): StringFormat | undefined {
  const format = bag['format']
  return typeof format === 'string' ? FORMAT_NAMES[format] : undefined
}

/** The zod number formats that admit whole numbers only. */
const WHOLE_NUMBER_FORMATS = new Set(['int', 'safeint', 'int32', 'uint32', 'int64', 'uint64'])

/**
 * Each reader builds its object with conditional spreads rather than by filtering a finished one.
 *
 * `exactOptionalPropertyTypes` tells an absent key from one holding `undefined`, and a filter that
 * removes the second cannot say so in a type: `Object.fromEntries` loses what it was handed, so the
 * result would need a cast. A spread of `false` adds nothing, and the compiler types the result.
 */

/** What a string asserts. `minimum` and `maximum` are lengths here. */
export function stringAssertions(
  schema: core.$ZodType
): Extract<Scalar, { name: 'string' }>['assertions'] | UnreadableSchema {
  const bag: Bag = schema._zod.bag
  const minLength = numberAt(bag, 'minimum')
  const maxLength = numberAt(bag, 'maximum')
  const patterns = patternsOf(bag)
  if (isError(patterns)) {
    return patterns
  }
  const format = formatOf(bag)

  return {
    ...(minLength !== undefined && { minLength }),
    ...(maxLength !== undefined && { maxLength }),
    ...(patterns !== undefined && { patterns }),
    ...(format !== undefined && { format })
  }
}

/** What a number asserts. `minimum` and `maximum` are values here. */
export function numberAssertions(
  schema: core.$ZodType
): Extract<Scalar, { name: 'number' }>['assertions'] {
  const bag: Bag = schema._zod.bag
  const format = bag['format']
  const minimum = boundOf(bag, 'minimum', 'exclusiveMinimum', numberAt)
  const maximum = boundOf(bag, 'maximum', 'exclusiveMaximum', numberAt)
  const multipleOf = numberAt(bag, 'multipleOf')

  return {
    ...(minimum !== undefined && { minimum }),
    ...(maximum !== undefined && { maximum }),
    ...(multipleOf !== undefined && { multipleOf }),
    // `z.int()` states a format and holds no check at all, so a reading that walked the checks would
    // report an unconstrained number for it.
    ...(typeof format === 'string' && WHOLE_NUMBER_FORMATS.has(format) && { integer: true })
  }
}

/** What a bigint asserts. */
export function bigintAssertions(
  schema: core.$ZodType
): Extract<Scalar, { name: 'bigint' }>['assertions'] {
  const bag: Bag = schema._zod.bag
  const minimum = boundOf(bag, 'minimum', 'exclusiveMinimum', bigintAt)
  const maximum = boundOf(bag, 'maximum', 'exclusiveMaximum', bigintAt)

  return {
    ...(minimum !== undefined && { minimum }),
    ...(maximum !== undefined && { maximum })
  }
}

/** What a date asserts. */
export function dateAssertions(
  schema: core.$ZodType
): Extract<Scalar, { name: 'date' }>['assertions'] {
  const bag: Bag = schema._zod.bag
  const minimum = boundOf(bag, 'minimum', 'exclusiveMinimum', dateAt)
  const maximum = boundOf(bag, 'maximum', 'exclusiveMaximum', dateAt)

  return {
    ...(minimum !== undefined && { minimum }),
    ...(maximum !== undefined && { maximum })
  }
}

/** What a list asserts. `minimum` and `maximum` are counts here. */
export function listAssertions(schema: core.$ZodType): {
  readonly minItems?: number
  readonly maxItems?: number
  readonly unique?: boolean
} {
  const bag: Bag = schema._zod.bag
  const minItems = numberAt(bag, 'minimum')
  const maxItems = numberAt(bag, 'maximum')

  return {
    ...(minItems !== undefined && { minItems }),
    ...(maxItems !== undefined && { maxItems })
  }
}
