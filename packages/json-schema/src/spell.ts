import type {
  Departure,
  Described,
  DescribedOf,
  DescribedProperty,
  DescribedRest,
  Spelling
} from '@fasciajs/core'
import { faithful, isError, UnsayableTerm, under } from '@fasciajs/core'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

/**
 * A term, written as JSON Schema 2020-12.
 *
 * The second target, and it was chosen because it disagrees with the first about almost everything.
 * ATD states a shape and nothing about the values in it; 2020-12 has a keyword for every assertion a
 * term carries, a general disjunction, a conjunction and a positional form. So three cases ATD
 * refuses are faithful here and two it widens are exact.
 *
 * That disagreement is what a second target is for. Two spellings of one specification agreeing
 * about a term is consistency; two specifications that refuse different things agreeing is evidence
 * the term chose no target's words.
 */
export function spellJsonSchema(term: Described): Spelling<JSONSchema> {
  switch (term.kind) {
    case 'typed':
      return typed(term)
    case 'values':
      return values(term)
    case 'some':
      return composed(term.members, 'anyOf', term.admitsNull)
    case 'exactlyOne':
      return exactlyOne(term)
    case 'every':
      return composed(term.members, 'allOf', term.admitsNull)
    case 'tuple':
      return tuple(term)
    case 'ref':
      return faithful(orNull({ $ref: `#/$defs/${term.name}` }, term.admitsNull))
    case 'untyped':
      // Nothing is stated, and 2020-12 states nothing with an empty schema. A `null` is a value like
      // any other where no type is named, so admitting one needs no keyword.
      return faithful({})
    default:
      term satisfies never
      throw new Error('a term reached this target with a case it states no answer for')
  }
}

/**
 * A schema that also admits null.
 *
 * 2020-12 names null as a type, so a schema that already names one says both. A schema that names
 * none has to be joined to one, which is what `anyOf` is for.
 */
function orNull(written: JSONSchema, admitsNull: boolean): JSONSchema {
  if (!admitsNull) {
    return written
  }
  return { anyOf: [written, { type: 'null' }] }
}

function typed(term: DescribedOf<'typed'>): Spelling<JSONSchema> {
  switch (term.name) {
    case 'boolean':
      return faithful({ type: typeOf('boolean', term.admitsNull) })
    case 'string':
      return string(term)
    case 'number':
      return number(term)
    case 'array':
      return array(term)
    case 'object':
      return object(term)
    default:
      term satisfies never
      throw new Error('a term named a type this target was not asked about')
  }
}

/** A type name, and null beside it where the value admits one. */
function typeOf(name: string, admitsNull: boolean): JSONSchema.TypeValue {
  return (admitsNull ? [name, 'null'] : name) as JSONSchema.TypeValue
}

/**
 * A string, and every assertion 2020-12 has a keyword for, which is all of them.
 *
 * Several patterns are the one place this target has fewer words than the term: 2020-12 states one
 * `pattern` per schema and a term may hold several, each of which holds. They are conjoined with
 * `allOf`, which accepts exactly the values the term states.
 */
function string(term: Extract<DescribedOf<'typed'>, { name: 'string' }>): Spelling<JSONSchema> {
  const { minLength, maxLength, patterns, format } = term.assertions
  const [first, ...rest] = patterns ?? []

  const written: JSONSchema = {
    type: typeOf('string', term.admitsNull),
    ...(minLength !== undefined && { minLength }),
    ...(maxLength !== undefined && { maxLength }),
    ...(first !== undefined && { pattern: first }),
    ...(format !== undefined && { format })
  }

  return faithful(
    rest.length === 0 ? written : { allOf: [written, ...rest.map((one) => ({ pattern: one }))] }
  )
}

function number(term: Extract<DescribedOf<'typed'>, { name: 'number' }>): Spelling<JSONSchema> {
  const { minimum, maximum, multipleOf, integer } = term.assertions

  return faithful({
    // A whole number is a type here, where ATD reads a width off the bounds. Same fact, two words.
    type: typeOf(integer === true ? 'integer' : 'number', term.admitsNull),
    ...(minimum !== undefined &&
      (minimum.exclusive ? { exclusiveMinimum: minimum.value } : { minimum: minimum.value })),
    ...(maximum !== undefined &&
      (maximum.exclusive ? { exclusiveMaximum: maximum.value } : { maximum: maximum.value })),
    ...(multipleOf !== undefined && { multipleOf })
  })
}

function array(term: Extract<DescribedOf<'typed'>, { name: 'array' }>): Spelling<JSONSchema> {
  const items = spellJsonSchema(term.assertions.items)
  if (isError(items)) {
    return items
  }

  return {
    written: {
      type: typeOf('array', term.admitsNull),
      items: items.written,
      ...(term.assertions.minItems !== undefined && { minItems: term.assertions.minItems }),
      ...(term.assertions.maxItems !== undefined && { maxItems: term.assertions.maxItems })
    },
    departures: under('items', items.departures)
  }
}

function object(term: Extract<DescribedOf<'typed'>, { name: 'object' }>): Spelling<JSONSchema> {
  const properties: Record<string, JSONSchema> = {}
  const required: string[] = []
  const departures: Departure[] = []

  for (const [key, property] of term.assertions.properties) {
    const spelled = spellProperty(property)
    if (isError(spelled)) {
      return spelled
    }

    properties[key] = spelled.written
    departures.push(...under(key, spelled.departures))

    if (property.required) {
      required.push(key)
    }
  }

  const rest = restOf(term.assertions.rest)
  if (isError(rest)) {
    return rest
  }
  departures.push(...under('additionalProperties', rest.departures))

  return {
    written: {
      type: typeOf('object', term.admitsNull),
      ...(Object.keys(properties).length > 0 && { properties }),
      ...(required.length > 0 && { required }),
      ...rest.written
    },
    departures
  }
}

/** A property, with the value that stands in when the key is absent. 2020-12 has a keyword for it. */
function spellProperty(property: DescribedProperty): Spelling<JSONSchema> {
  const spelled = spellJsonSchema(property.term)
  if (isError(spelled)) {
    return spelled
  }

  if (property.default === undefined || typeof spelled.written === 'boolean') {
    return spelled
  }

  return {
    written: { ...spelled.written, default: property.default },
    departures: spelled.departures
  }
}

function restOf(rest: DescribedRest): Spelling<Record<string, JSONSchema>> {
  switch (rest.allows) {
    case 'anything':
      // The default. Written out would say the same thing at more length.
      return faithful({})
    case 'nothing':
      return faithful({ additionalProperties: false })
    case 'term': {
      const spelled = spellJsonSchema(rest.term)
      return isError(spelled)
        ? spelled
        : { written: { additionalProperties: spelled.written }, departures: spelled.departures }
    }
    default:
      rest satisfies never
      throw new Error('a term stated a rest of no kind')
  }
}

/** A fixed set of values. 2020-12 names any JSON value here, where ATD names strings only. */
function values(term: DescribedOf<'values'>): Spelling<JSONSchema> {
  const admitted: (string | number | boolean | null)[] = []

  for (const value of term.admitted) {
    if (value.of === 'bigint') {
      return new UnsayableTerm(
        [],
        'this admits a bigint, and JSON has no form for one, so no document can name the value'
      )
    }
    admitted.push(value.of === 'null' ? null : value.value)
  }

  // A term admitting null states it beside the values rather than as a flag, because a flag written
  // next to an enum widens nothing: both have to hold.
  return faithful({ enum: term.admitsNull ? [...admitted, null] : admitted })
}

function composed(
  members: readonly Described[],
  keyword: 'anyOf' | 'allOf',
  admitsNull: boolean
): Spelling<JSONSchema> {
  const written: JSONSchema[] = []
  const departures: Departure[] = []

  for (const [index, member] of members.entries()) {
    const spelled = spellJsonSchema(member)
    if (isError(spelled)) {
      return spelled
    }
    written.push(spelled.written)
    departures.push(...under(String(index), spelled.departures))
  }

  return {
    written: orNull(keyword === 'anyOf' ? { anyOf: written } : { allOf: written }, admitsNull),
    departures
  }
}

/**
 * Exactly one of several, which 2020-12 states and ATD states only with a tag.
 *
 * The property a source chose to tell the members apart is dropped. 2020-12 has no keyword for one,
 * and it changes no verdict about a value: what a reader enforces is the disjunction beside it.
 */
function exactlyOne(term: DescribedOf<'exactlyOne'>): Spelling<JSONSchema> {
  const written: JSONSchema[] = []
  const departures: Departure[] = []

  for (const [index, member] of term.members.entries()) {
    const spelled = spellJsonSchema(member)
    if (isError(spelled)) {
      return spelled
    }
    written.push(spelled.written)
    departures.push(...under(String(index), spelled.departures))
  }

  if (term.discriminant !== undefined) {
    departures.push({
      at: [],
      direction: 'neither',
      cause: 'noWordForIt',
      said: `this names ${term.discriminant} to tell the members apart, and 2020-12 has no keyword for one. What the document accepts is unchanged, because the disjunction states it.`
    })
  }

  return { written: orNull({ oneOf: written }, term.admitsNull), departures }
}

/** Values at positions, which 2020-12 states exactly and ATD has no form for. */
function tuple(term: DescribedOf<'tuple'>): Spelling<JSONSchema> {
  const prefixItems: JSONSchema[] = []
  const departures: Departure[] = []

  for (const [index, position] of term.positions.entries()) {
    const spelled = spellJsonSchema(position)
    if (isError(spelled)) {
      return spelled
    }
    prefixItems.push(spelled.written)
    departures.push(...under(String(index), spelled.departures))
  }

  const rest = term.rest
  const items =
    rest.allows === 'nothing' ? { items: false } : rest.allows === 'anything' ? {} : undefined

  if (items === undefined && rest.allows === 'term') {
    const spelled = spellJsonSchema(rest.term)
    if (isError(spelled)) {
      return spelled
    }
    departures.push(...under('items', spelled.departures))

    return {
      written: orNull(
        { type: 'array', prefixItems, items: spelled.written, minItems: prefixItems.length },
        term.admitsNull
      ),
      departures
    }
  }

  return {
    written: orNull(
      { type: 'array', prefixItems, ...items, minItems: prefixItems.length },
      term.admitsNull
    ),
    departures
  }
}

/**
 * A whole description, written as a 2020-12 document.
 *
 * The definitions go under `$defs`, which is where every `$ref` this target writes points.
 */
export function spellJsonSchemaAll(described: {
  readonly term: Described
  readonly definitions: ReadonlyMap<string, Described>
}): Spelling<JSONSchema> {
  const root = spellJsonSchema(described.term)
  if (isError(root)) {
    return root
  }

  const $defs: Record<string, JSONSchema> = {}
  const departures: Departure[] = [...root.departures]

  for (const [name, term] of described.definitions) {
    const spelled = spellJsonSchema(term)
    if (isError(spelled)) {
      return spelled
    }
    $defs[name] = spelled.written
    departures.push(...under(name, spelled.departures))
  }

  const written: JSONSchema =
    typeof root.written === 'boolean' || described.definitions.size === 0
      ? root.written
      : { ...root.written, $defs }

  return { written, departures }
}
