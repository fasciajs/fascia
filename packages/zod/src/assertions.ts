import type { Bound, Scalar, StringFormat } from '@fasciajs/core'
import { isError, UnreadableSchema } from '@fasciajs/core'
import * as core from 'zod/v4/core'

/**
 * What a schema asserts about its own values, read from its checks folded into one bag.
 *
 * The bag holds `unknown` values, so this file is a boundary: every value is parsed into a precise
 * type once, here, and nothing downstream reads an unknown.
 *
 * One key of the bag means three things. `minimum` is a length on a string, a count on an array and a
 * value on a number, a bigint or a date. So a reader is chosen by the scalar being read and never
 * shared, which is also why there is no general `boundOf`.
 */

type Bag = Record<string, unknown>

type Ordered = number | bigint | Date

const rank = (value: Ordered): number | bigint => (value instanceof Date ? value.getTime() : value)

const isOrdered = (value: unknown): value is Ordered =>
  typeof value === 'number' || typeof value === 'bigint' || value instanceof Date

/** Two checks on one side hold together, so the narrower bound is the one the schema states. */
function lower(bag: Bag, key: string, value: Ordered): void {
  const held = bag[key]
  if (!isOrdered(held) || rank(value) > rank(held)) {
    bag[key] = value
  }
}

function upper(bag: Bag, key: string, value: Ordered): void {
  const held = bag[key]
  if (!isOrdered(held) || rank(value) < rank(held)) {
    bag[key] = value
  }
}

/**
 * The pattern that states each format exactly, where zod parses against another one.
 *
 * zod parses base64 against a lax charset and checks the padding in code. The exact grammar is the
 * pattern zod writes in its own document, and a document carries no code. zod parses IPv6 in code
 * that takes an IPv4 tail its pattern refuses, and the `ipv6` keyword alone states that set.
 */
const EXACT_PATTERNS: Partial<Record<string, readonly [lax: RegExp, exact: RegExp | undefined]>> = {
  base64: [core.base64Charset, core.regexes.base64],
  base64url: [core.base64urlCharset, core.regexes.base64url],
  ipv6: [core.regexes.ipv6, undefined]
}

function addPattern(bag: Bag, pattern: RegExp | undefined): void {
  if (pattern === undefined) {
    return
  }
  const patterns = bag['patterns'] instanceof Set ? bag['patterns'] : new Set<RegExp>()
  bag['patterns'] = patterns.add(pattern)
}

/**
 * The checks a schema holds, folded into one bag.
 *
 * zod before 4.6 folded each check into `_zod.bag` as a schema was built. zod 4.6 leaves that bag
 * empty, and folds the checks only where it writes its own document, in a function it does not
 * export. This is that fold, for the checks this package reads. A format schema, such as `z.int()`
 * or `z.email()`, is its own first check.
 */
function foldOf(schema: core.$ZodType): Bag {
  const bag: Bag = {}
  const checks = [
    ...(schema instanceof core.$ZodCheck ? [schema] : []),
    ...(schema._zod.def.checks ?? [])
  ]
  for (const check of checks) {
    if (check instanceof core.$ZodCheckGreaterThan) {
      const { inclusive, value } = check._zod.def
      lower(bag, inclusive ? 'minimum' : 'exclusiveMinimum', value)
    } else if (check instanceof core.$ZodCheckLessThan) {
      const { inclusive, value } = check._zod.def
      upper(bag, inclusive ? 'maximum' : 'exclusiveMaximum', value)
    } else if (check instanceof core.$ZodCheckMultipleOf) {
      const divisors = Array.isArray(bag['multipleOf']) ? bag['multipleOf'] : []
      bag['multipleOf'] = [...divisors, check._zod.def.value]
    } else if (check instanceof core.$ZodCheckNumberFormat) {
      const [minimum, maximum] = core.util.NUMBER_FORMAT_RANGES[check._zod.def.format]
      bag['format'] = check._zod.def.format
      // A later float format replaces the name, and the value stays whole.
      if (WHOLE_NUMBER_FORMATS.has(check._zod.def.format)) {
        bag['integer'] = true
      }
      lower(bag, 'minimum', minimum)
      upper(bag, 'maximum', maximum)
    } else if (check instanceof core.$ZodCheckBigIntFormat) {
      const [minimum, maximum] = core.util.BIGINT_FORMAT_RANGES[check._zod.def.format]
      bag['format'] = check._zod.def.format
      lower(bag, 'minimum', minimum)
      upper(bag, 'maximum', maximum)
    } else if (check instanceof core.$ZodCheckMinLength) {
      lower(bag, 'minimum', check._zod.def.minimum)
    } else if (check instanceof core.$ZodCheckMaxLength) {
      upper(bag, 'maximum', check._zod.def.maximum)
    } else if (check instanceof core.$ZodCheckLengthEquals) {
      lower(bag, 'minimum', check._zod.def.length)
      upper(bag, 'maximum', check._zod.def.length)
    } else if (check instanceof core.$ZodCheckStringFormat) {
      const { format, pattern } = check._zod.def
      bag['format'] = format
      // `date-time` needs an offset and seconds, and these shapes take a value without one.
      if (
        check instanceof core.$ZodISODateTime &&
        (check._zod.def.local || check._zod.def.precision === -1)
      ) {
        bag['laxFormat'] = true
      }
      // Keyed by the format too: `.regex(core.base64Charset)` parses against the lax charset alone.
      const [lax, exact] = EXACT_PATTERNS[format] ?? []
      addPattern(bag, pattern !== undefined && pattern === lax ? exact : pattern)
    } else if (
      // These three state a pattern under `string_format`, and zod does not build them as one.
      check instanceof core.$ZodCheckStartsWith ||
      check instanceof core.$ZodCheckEndsWith ||
      check instanceof core.$ZodCheckIncludes
    ) {
      addPattern(bag, check._zod.def.pattern)
    }
  }
  return bag
}

/** A positive decimal as an integer over a power of ten, read from its text. */
function decimalOf(value: number): { readonly digits: bigint; readonly scale: number } | undefined {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(String(value))
  if (match === null) {
    return undefined
  }
  const [, whole = '', fraction = ''] = match
  return { digits: BigInt(whole + fraction), scale: fraction.length }
}

const gcd = (a: bigint, b: bigint): bigint => (b === 0n ? a : gcd(b, a % b))

/**
 * The one divisor whose multiples are the multiples of every divisor: the least common multiple.
 *
 * Computed on the decimal text, because a double has no exact common multiple of `0.5` and `0.3`.
 * There is none to state where a divisor has no plain decimal text, or the result passes 2^53.
 */
function commonMultipleOf(divisors: readonly number[]): number | undefined {
  // The fold starts at the first divisor. One is no identity here: lcm(1, 0.5) is 1.
  const [first, ...rest] = divisors.map(decimalOf)
  if (first === undefined || first.digits === 0n) {
    return undefined
  }
  let held = first
  for (const decimal of rest) {
    if (decimal === undefined || decimal.digits === 0n) {
      return undefined
    }
    const scale = Math.max(held.scale, decimal.scale)
    const a = held.digits * 10n ** BigInt(scale - held.scale)
    const b = decimal.digits * 10n ** BigInt(scale - decimal.scale)
    held = { digits: (a / gcd(a, b)) * b, scale }
  }
  while (held.scale > 0 && held.digits % 10n === 0n) {
    held = { digits: held.digits / 10n, scale: held.scale - 1 }
  }
  if (held.digits > BigInt(Number.MAX_SAFE_INTEGER)) {
    return undefined
  }
  return Number(held.digits) / 10 ** held.scale
}

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
 * zod writes an exclusive bound under its own key rather than beside a flag. A value meets both
 * bounds on one side, so the stricter one is the bound: `gt(5).min(10)` is `>= 10`. At one value
 * the exclusive bound is the stricter.
 */
function boundOf<T extends Ordered>(
  bag: Bag,
  side: 'lower' | 'upper',
  read: (bag: Bag, key: string) => T | undefined
): Bound<T> | undefined {
  const inclusive = read(bag, side === 'lower' ? 'minimum' : 'maximum')
  const exclusive = read(bag, side === 'lower' ? 'exclusiveMinimum' : 'exclusiveMaximum')
  if (exclusive === undefined) {
    return inclusive === undefined ? undefined : { value: inclusive, exclusive: false }
  }
  if (inclusive === undefined) {
    return { value: exclusive, exclusive: true }
  }

  const inclusiveIsStricter =
    side === 'lower' ? rank(inclusive) > rank(exclusive) : rank(inclusive) < rank(exclusive)
  return inclusiveIsStricter
    ? { value: inclusive, exclusive: false }
    : { value: exclusive, exclusive: true }
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
 *
 * `time` and `duration` have no entry. The `time` keyword needs an offset, and zod's time has none.
 * The `duration` keyword takes no fraction, and zod takes one on the seconds. zod's pattern holds both.
 */
const FORMAT_NAMES: Partial<Record<string, StringFormat>> = {
  email: 'email',
  url: 'uri',
  uuid: 'uuid',
  guid: 'uuid',
  datetime: 'date-time',
  date: 'date',
  ipv4: 'ipv4',
  ipv6: 'ipv6',
  hostname: 'hostname'
}

function formatOf(bag: Bag): StringFormat | undefined {
  const format = bag['format']
  return typeof format === 'string' && bag['laxFormat'] !== true ? FORMAT_NAMES[format] : undefined
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
  const bag = foldOf(schema)
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
): Extract<Scalar, { name: 'number' }>['assertions'] | UnreadableSchema {
  const bag = foldOf(schema)
  const minimum = boundOf(bag, 'lower', numberAt)
  const maximum = boundOf(bag, 'upper', numberAt)
  const multipleOf = multipleOfIn(schema, bag)
  if (isError(multipleOf)) {
    return multipleOf
  }

  return {
    ...(minimum !== undefined && { minimum }),
    ...(maximum !== undefined && { maximum }),
    ...(multipleOf !== undefined && { multipleOf }),
    ...(bag['integer'] === true && { integer: true })
  }
}

/**
 * The divisor a number states. A value meets every divisor, so two read as their least common
 * multiple, and two with no exact one are refused rather than read as the first.
 */
function multipleOfIn(schema: core.$ZodType, bag: Bag): number | undefined | UnreadableSchema {
  const held = bag['multipleOf']
  const divisors = [
    ...new Set(Array.isArray(held) ? held.filter((one) => typeof one === 'number') : [])
  ]
  const [only, ...rest] = divisors
  if (rest.length === 0) {
    return only !== undefined && Number.isFinite(only) ? only : undefined
  }
  return (
    commonMultipleOf(divisors) ??
    new UnreadableSchema(
      schema,
      `this states the divisors ${divisors.join(' and ')}, and no single divisor holds exactly the multiples of each. Write the one divisor the schema means`
    )
  )
}

/** What a bigint asserts. */
export function bigintAssertions(
  schema: core.$ZodType
): Extract<Scalar, { name: 'bigint' }>['assertions'] {
  const bag = foldOf(schema)
  const minimum = boundOf(bag, 'lower', bigintAt)
  const maximum = boundOf(bag, 'upper', bigintAt)

  return {
    ...(minimum !== undefined && { minimum }),
    ...(maximum !== undefined && { maximum })
  }
}

/** What a date asserts. */
export function dateAssertions(
  schema: core.$ZodType
): Extract<Scalar, { name: 'date' }>['assertions'] {
  const bag = foldOf(schema)
  const minimum = boundOf(bag, 'lower', dateAt)
  const maximum = boundOf(bag, 'upper', dateAt)

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
  const bag = foldOf(schema)
  const minItems = numberAt(bag, 'minimum')
  const maxItems = numberAt(bag, 'maximum')

  return {
    ...(minItems !== undefined && { minItems }),
    ...(maxItems !== undefined && { maxItems })
  }
}
