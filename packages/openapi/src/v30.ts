import type { Departure, Spelled } from '@fasciajs/core'
import { under } from '@fasciajs/core'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

/**
 * A 2020-12 schema, translated into what OpenAPI 3.0 says instead.
 *
 * **3.0 is a different dialect of one target, and this is the first time two have met here.** 3.1
 * holds JSON Schema 2020-12 unchanged; 3.0 has a schema of its own that says four things another
 * way and one thing not at all.
 *
 * Translated rather than spelled a second time. The two dialects agree about most of a document, so
 * a second walk over the term would be the same code with five lines changed and would drift from
 * the first the moment either moved. What differs is the words, and words are what a translation
 * takes.
 *
 * This reads 2020-12, which is a published standard rather than another package's convention, so
 * matching on `type` and `exclusiveMinimum` is reading the specification and not a decision made
 * next door.
 */
export function toV30(written: JSONSchema): Spelled<JSONSchema> {
  if (typeof written === 'boolean') {
    // 3.0 has no boolean schema. `true` admits everything, which an empty schema also does, and
    // `false` admits nothing, which 3.0 says with a `not` of the empty schema.
    return { written: written ? {} : { not: {} }, departures: [] }
  }

  const departures: Departure[] = []
  const out: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(written)) {
    const said = translated(key, value, written, departures)
    if (said !== undefined) {
      Object.assign(out, said)
    }
  }

  return { written: besideReference(out, departures) as JSONSchema, departures }
}

/**
 * A reference with something stated beside it, moved where 3.0 reads both.
 *
 * **3.0 reads no keyword next to a reference.** A use of a named schema that describes that use
 * writes the sentence beside the `$ref`, which 2020-12 and 3.1 both read. A 3.0 reader takes the
 * reference and ignores everything else in the object, so the sentence would reach no document at all.
 *
 * The reference goes under a conjunction of one and what was beside it stays outside, which every
 * reader of 3.0 takes.
 */
function besideReference(
  written: Record<string, unknown>,
  departures: Departure[]
): Record<string, unknown> {
  const { $ref, ...beside } = written
  if ($ref === undefined || Object.keys(beside).length === 0) {
    return written
  }

  departures.push({
    at: [],
    direction: 'neither',
    cause: 'noShapeForIt',
    said: `this refers to a schema and states ${Object.keys(beside).join(' and ')} beside the reference, and 3.0 reads no keyword there. The reference is written under a conjunction of one so the rest has somewhere to sit, which every reader of 3.0 takes and the specification does not state`
  })

  return { allOf: [{ $ref }], ...beside }
}

/**
 * One keyword, as 3.0 says it.
 *
 * Returns what to write, or nothing where the keyword was consumed into something already written.
 */
function translated(
  key: string,
  value: unknown,
  source: Record<string, unknown>,
  departures: Departure[]
): Record<string, unknown> | undefined {
  switch (key) {
    // 3.0 has no `$schema`. The OpenAPI document names its dialect in `openapi`, so a 2020-12 name
    // carried into a 3.0 Schema Object would name the wrong one.
    case '$schema':
      return undefined

    // 3.0 names one type and says null with a flag beside it. A fifth spelling of the one fact, and
    // the first that this library reaches by translating rather than by writing.
    case 'type':
      return Array.isArray(value)
        ? {
            type: value.find((one) => one !== 'null'),
            ...(value.includes('null') && { nullable: true })
          }
        : { type: value }

    // 3.0 states the bound under the inclusive keyword and says exclusive with a flag.
    case 'exclusiveMinimum':
      return { minimum: value, exclusiveMinimum: true }
    case 'exclusiveMaximum':
      return { maximum: value, exclusiveMaximum: true }

    // 3.0 has no positional form. Every element is held to whatever any position admits, so nothing
    // states the count or which shape stands where.
    case 'prefixItems': {
      const positions = Array.isArray(value) ? value : []
      const spelled = positions.map((one) => toV30(one as JSONSchema))
      for (const [index, one] of spelled.entries()) {
        departures.push(...under(String(index), one.departures))
      }

      departures.push({
        at: [],
        direction: 'wider',
        cause: 'noShapeForIt',
        said: `this states ${positions.length} values at positions, and 3.0 has no keyword for one. Every element is held to what any position admits, so nothing states the count or which shape stands where`
      })

      // What stands past the positions is held to the same one keyword, so it joins the list. A
      // tuple stating no `items` admits anything past its positions, and 3.0 holds every element to
      // one schema, so nothing at all can be said: a list of the positions would refuse an element
      // the schema takes.
      const past = source['items']
      if (past === undefined) {
        return { items: {} }
      }

      const rest =
        typeof past === 'object' && past !== null ? [toV30(past as JSONSchema).written] : []

      return { items: { anyOf: [...spelled.map((one) => one.written), ...rest] } }
    }

    // 3.0 states one example rather than a list of them.
    case 'examples': {
      const [first] = Array.isArray(value) ? value : []
      if (first === undefined) {
        return {}
      }

      departures.push({
        at: [],
        direction: 'neither',
        cause: 'noWordForIt',
        said: 'this states several examples, and 3.0 has a keyword for one. The first is written and the rest are not. What a reader accepts is unchanged'
      })

      return { example: first }
    }

    // A tuple's `items` is what stands past the positions, and `prefixItems` already wrote one.
    // A tuple's `items` is what stands past its positions, and the positional case already joined
    // it to them.
    case 'items':
      return 'prefixItems' in source ? undefined : { items: subschema(value, key, departures) }

    case 'anyOf':
    case 'oneOf':
    case 'allOf': {
      const members = nullJoined(value, key, departures)

      // A disjunction of one member is that member, and folding a null branch out of a pair leaves
      // one. Written as a wrapper it would nest `anyOf` inside `anyOf` for every nullable union.
      const [only] = members
      return members.length === 1 && typeof only === 'object' && only !== null
        ? (only as Record<string, unknown>)
        : { [key]: members }
    }

    case 'properties':
    case '$defs':
      return { [key]: eachOf(value, key, departures) }

    // `additionalProperties` is the one place 3.0 states a boolean where a schema would stand, and
    // it declares it that way itself. The general rule below would write `{ not: {} }`, which says
    // the same thing at more length and does not read back.
    case 'additionalProperties':
      return {
        additionalProperties: typeof value === 'boolean' ? value : subschema(value, key, departures)
      }

    case 'not':
      return { not: subschema(value, key, departures) }

    default:
      return { [key]: value }
  }
}

/**
 * A combination, with a branch admitting only null said in 3.0's words.
 *
 * 2020-12 joins a schema to null with a branch of `type: 'null'`, and 3.0 has no null type. Its exact
 * word for the branch is `enum: [null]`, which 3.0 takes from JSON Schema unchanged. A disjunction
 * says it on each branch instead, with the flag where the flag is exact.
 */
function nullJoined(value: unknown, key: string, departures: Departure[]): unknown[] {
  const members = Array.isArray(value) ? value : []
  const stated = members.filter((one) => !isNullOnly(one))
  const admitsNull = stated.length < members.length

  const spelled = stated.map((one, index) => {
    const said = toV30(one as JSONSchema)
    departures.push(...under(`${key}/${index}`, said.departures))
    return said.written
  })

  if (!admitsNull) {
    return spelled
  }

  // A value in any branch is in the disjunction, so null joins each branch. Exactly one branch, or
  // every branch, would change under that, so there null stays a branch of its own.
  return key === 'anyOf' ? spelled.map(admittingNull) : [...spelled, NULL_ONLY]
}

/** The one value null, in a word 3.0 has. */
const NULL_ONLY = { enum: [null] }

/** Keywords that can refuse null beside a type, so a flag beside them does not admit it. */
const REFUSING_NULL = ['enum', 'anyOf', 'oneOf', 'allOf', 'not', '$ref']

/**
 * A schema that also admits null, said where 3.0 hears it.
 *
 * OpenAPI 3.0 says `nullable` "only takes effect if `type` is explicitly defined within the same
 * Schema Object", and every other keyword there keeps its meaning. So the flag is written beside a
 * type with nothing that could refuse null, and null joins a list of values. Anywhere else the
 * schema is joined to null as a disjunction, which is exact wherever it stands.
 */
function admittingNull(written: unknown): unknown {
  if (typeof written !== 'object' || written === null) {
    return written
  }

  const stated = written as Record<string, unknown>
  if (Object.keys(stated).length === 0) {
    // An empty schema states no type, and admits null already.
    return stated
  }

  const listed = stated['enum']
  const others = REFUSING_NULL.filter((key) => key !== 'enum' && key in stated)
  if (Array.isArray(listed) && others.length === 0) {
    return listed.includes(null)
      ? stated
      : {
          ...stated,
          ...(typeof stated['type'] === 'string' && { nullable: true }),
          enum: [...listed, null]
        }
  }

  if (typeof stated['type'] === 'string' && !REFUSING_NULL.some((key) => key in stated)) {
    return { ...stated, nullable: true }
  }

  // A disjunction alone admits null where any branch does.
  const branches = stated['anyOf']
  if (Array.isArray(branches) && Object.keys(stated).length === 1) {
    return { anyOf: branches.map(admittingNull) }
  }

  return { anyOf: [stated, NULL_ONLY] }
}

function isNullOnly(written: unknown): boolean {
  return (
    typeof written === 'object' &&
    written !== null &&
    Object.entries(written).length === 1 &&
    (written as { type?: unknown }).type === 'null'
  )
}

function eachOf(value: unknown, key: string, departures: Departure[]): unknown {
  if (typeof value !== 'object' || value === null) {
    return value
  }

  const out: Record<string, unknown> = {}
  for (const [name, one] of Object.entries(value)) {
    const said = toV30(one as JSONSchema)
    departures.push(...under(`${key}/${name}`, said.departures))
    out[name] = said.written
  }
  return out
}

function subschema(value: unknown, key: string, departures: Departure[]): unknown {
  if (typeof value !== 'object' && typeof value !== 'boolean') {
    return value
  }

  const said = toV30(value as JSONSchema)
  departures.push(...under(key, said.departures))
  return said.written
}
