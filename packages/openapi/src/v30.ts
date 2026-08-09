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
    const said = translated(key, value, out, departures)
    if (said !== undefined) {
      Object.assign(out, said)
    }
  }

  return { written: out as JSONSchema, departures }
}

/**
 * One keyword, as 3.0 says it.
 *
 * Returns what to write, or nothing where the keyword was consumed into something already written.
 */
function translated(
  key: string,
  value: unknown,
  out: Record<string, unknown>,
  departures: Departure[]
): Record<string, unknown> | undefined {
  switch (key) {
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

      return { items: { anyOf: spelled.map((one) => one.written) } }
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
    case 'items':
      return 'items' in out ? undefined : { items: subschema(value, key, departures) }

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
 * A disjunction, with a branch admitting only null folded into a flag.
 *
 * 2020-12 joins a schema to null where the schema names no type of its own, and 3.0 has no such
 * branch: it says the same thing with `nullable` on the one that is left.
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

  return admitsNull ? spelled.map((one) => admittingNull(one, departures)) : spelled
}

/**
 * A schema that also admits null, said where 3.0 hears it.
 *
 * `nullable` is a flag on a type, and 3.0 reads it nowhere else. Beside a disjunction it states
 * nothing, so it is pushed onto each branch. Beside a `$ref` it is ignored outright, because 3.0
 * reads no keyword next to one, and a document that lost the null there would refuse a value the
 * schema takes. A reference is wrapped so the flag has somewhere of its own to sit.
 */
function admittingNull(written: unknown, departures: Departure[]): unknown {
  if (typeof written !== 'object' || written === null) {
    return written
  }

  const stated = written as Record<string, unknown>

  for (const key of ['anyOf', 'oneOf'] as const) {
    const members = stated[key]
    if (Array.isArray(members)) {
      return { ...stated, [key]: members.map((one) => admittingNull(one, departures)) }
    }
  }

  if ('$ref' in stated) {
    departures.push({
      at: [],
      direction: 'neither',
      cause: 'noShapeForIt',
      said: 'this refers to a schema and admits null, and 3.0 reads no keyword beside a reference. The reference is wrapped so the flag has somewhere to sit, which every reader of 3.0 takes and the specification does not state'
    })
    return { allOf: [stated], nullable: true }
  }

  return { ...stated, nullable: true }
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
