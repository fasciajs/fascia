import type {
  Departure,
  Described,
  DescribedOf,
  DescribedProperty,
  DescribedRest,
  Spelled,
  Spelling
} from '@fasciajs/core'
import { faithful, isError, UnsayableTerm, under } from '@fasciajs/core'
import type { AtdProperties, AtdSchema, AtdType } from './atd.js'

/**
 * A term, written as Arri Type Definition.
 *
 * The first target, and it was chosen because it refuses so much. ATD states a shape and nothing
 * about the values in it, so every assertion a term carries is given up here and said so. It has no
 * general disjunction, no intersection and no positional form, so three cases of the term cannot be
 * written at all and two more are written wider.
 *
 * Three outcomes rather than two. Faithful, lossy and still sound, and cannot be said soundly. Only
 * the last is a failure: treating a wide spelling as one would make a construct unusable against a
 * target where it works and is merely wide.
 */
export function spellAtd(term: Described): Spelling<AtdSchema> {
  // A switch rather than a table indexed by the tag. Indexing reads as the same thing and is not
  // checked: the compiler cannot correlate the handler it selects with the term it holds, so every
  // handler receives every case and the call needs a cast to compile. The `satisfies never` is what
  // makes a case added to the term a compile error naming this target.
  switch (term.kind) {
    case 'typed':
      return typed(term)
    case 'values':
      return values(term)
    case 'exactlyOne':
      return exactlyOne(term)
    case 'tuple':
      return tuple(term)
    case 'untyped':
      return faithful(nullable({}, term.admitsNull))
    case 'ref':
      // ATD resolves this against an app definition's `definitions`, keyed by the same name.
      return faithful(nullable({ ref: term.name }, term.admitsNull))
    case 'some':
      return new UnsayableTerm(
        [],
        'this admits any of several shapes, and ATD has no form for a disjunction that is not chosen by a tag'
      )
    case 'every':
      return new UnsayableTerm(
        [],
        'this admits all of several shapes at once, and ATD has no form for an intersection'
      )
    default:
      term satisfies never
      throw new Error('a term reached this target with a case it states no answer for')
  }
}

/** Nullability is a flag on any form, which is the one thing ATD says uniformly. */
function nullable<Written extends AtdSchema>(written: Written, admitsNull: boolean): Written {
  return admitsNull ? { ...written, isNullable: true } : written
}

function gaveUp(
  direction: Departure['direction'],
  cause: Departure['cause'],
  said: string
): Departure {
  return { at: [], direction, cause, said }
}

function typed(term: DescribedOf<'typed'>): Spelling<AtdSchema> {
  switch (term.name) {
    case 'boolean':
      return faithful(nullable({ type: 'boolean' }, term.admitsNull))
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
      throw new Error('a term named a type ATD was not asked about')
  }
}

/** A string, and everything a string can state that ATD has no word for. */
function string(term: Extract<DescribedOf<'typed'>, { name: 'string' }>): Spelling<AtdSchema> {
  const { minLength, maxLength, patterns, format } = term.assertions
  const departures: Departure[] = []

  for (const [keyword, stated] of [
    ['a least length', minLength],
    ['a greatest length', maxLength],
    ['a pattern', patterns],
    ['a format', format]
  ] as const) {
    if (stated !== undefined) {
      departures.push(
        gaveUp(
          'wider',
          'noWordForIt',
          `this states ${keyword}, and ATD describes a shape and says nothing about the values in it. The document accepts strings the schema refuses.`
        )
      )
    }
  }

  return { written: nullable({ type: 'string' }, term.admitsNull), departures }
}

/**
 * A number, and the width ATD wants.
 *
 * ATD names a width rather than saying `integer` with bounds beside it, so the width is recovered
 * from the bounds a term states. That is the motto running forwards: the term says whole numbers in
 * this range and the target picks the word.
 */
const WIDTHS: readonly (readonly [AtdType, number, number])[] = [
  ['int8', -128, 127],
  ['uint8', 0, 255],
  ['int16', -32768, 32767],
  ['uint16', 0, 65535],
  ['int32', -2147483648, 2147483647],
  ['uint32', 0, 4294967295]
]

function number(term: Extract<DescribedOf<'typed'>, { name: 'number' }>): Spelling<AtdSchema> {
  const { minimum, maximum, multipleOf, integer } = term.assertions
  const departures: Departure[] = []

  const width = integer === true ? widthFor(minimum?.value, maximum?.value) : undefined
  const type: AtdType = width ?? (integer === true ? 'int32' : 'float64')

  // A bound the chosen width does not already state is a bound ATD has no word for.
  if ((minimum !== undefined || maximum !== undefined) && width === undefined) {
    departures.push(
      gaveUp(
        'wider',
        'noWordForIt',
        `this states a bound that no ATD width matches, and ATD has no keyword for one. The document accepts numbers the schema refuses.`
      )
    )
  }

  if (multipleOf !== undefined) {
    departures.push(
      gaveUp(
        'wider',
        'noWordForIt',
        'this states a divisor, and ATD has no keyword for one. The document accepts numbers the schema refuses.'
      )
    )
  }

  // `float64` accepts every number a caller can send, so naming it gives nothing up. A width gives
  // up nothing either, because the width is what the bounds already said.
  return { written: nullable({ type }, term.admitsNull), departures }
}

function widthFor(minimum: number | undefined, maximum: number | undefined): AtdType | undefined {
  if (minimum === undefined || maximum === undefined) {
    return undefined
  }

  return WIDTHS.find(([, low, high]) => low === minimum && high === maximum)?.[0]
}

function array(term: Extract<DescribedOf<'typed'>, { name: 'array' }>): Spelling<AtdSchema> {
  const items = spellAtd(term.assertions.items)
  if (isError(items)) {
    return items
  }

  const departures = [...under('elements', items.departures)]

  if (term.assertions.minItems !== undefined || term.assertions.maxItems !== undefined) {
    departures.push(
      gaveUp(
        'wider',
        'noWordForIt',
        'this states how many items are admitted, and ATD has no keyword for a count. The document accepts lists the schema refuses.'
      )
    )
  }

  return { written: nullable({ elements: items.written }, term.admitsNull), departures }
}

function object(term: Extract<DescribedOf<'typed'>, { name: 'object' }>): Spelling<AtdSchema> {
  const { properties, rest } = term.assertions

  // No named key and one schema for every value is the values form, which is the shape ATD has for
  // exactly this and the reason it is asked first.
  if (properties.size === 0 && rest.allows === 'term') {
    const values = spellAtd(rest.term)
    return isError(values)
      ? values
      : {
          written: nullable({ values: values.written }, term.admitsNull),
          departures: under('values', values.departures)
        }
  }

  const written = spellProperties(properties, rest)
  return isError(written)
    ? written
    : {
        written: nullable(written.written, term.admitsNull),
        departures: written.departures
      }
}

/** The properties form, which is also what a discriminator's mapping must hold. */
function spellProperties(
  properties: ReadonlyMap<string, DescribedProperty>,
  rest: DescribedRest
): Spelling<AtdProperties> {
  const required: Record<string, AtdSchema> = {}
  const optional: Record<string, AtdSchema> = {}
  const departures: Departure[] = []

  for (const [key, property] of properties) {
    const spelled = spellAtd(property.term)
    if (isError(spelled)) {
      return spelled
    }

    departures.push(...under(key, spelled.departures))

    if (property.required) {
      required[key] = spelled.written
    } else {
      optional[key] = spelled.written
    }

    if (property.default !== undefined) {
      departures.push({
        at: [key],
        direction: 'neither',
        cause: 'noWordForIt',
        said: 'this states a value that stands in when the key is absent, and ATD has no keyword for one. What a caller may send is unchanged.'
      })
    }
  }

  // ATD refuses an unnamed key or ignores one, and has no third answer. A schema holding an unnamed
  // key to a shape is written as one that ignores every unnamed key, which is wider.
  if (rest.allows === 'term') {
    departures.push(
      gaveUp(
        'wider',
        'noShapeForIt',
        'this holds an unnamed key to a shape, and ATD either refuses an unnamed key or ignores one. The document ignores keys the schema checks.'
      )
    )
  }

  return {
    written: {
      // Always written, even where it is empty. arri requires it, and a properties form without it
      // is read as the empty form, which accepts any value at all. An object whose keys are all
      // optional would otherwise describe anything.
      properties: required,
      ...(Object.keys(optional).length > 0 && { optionalProperties: optional }),
      ...(rest.allows === 'nothing' && { isStrict: true })
    },
    departures
  }
}

/**
 * A tagged disjunction, which is the only one ATD has.
 *
 * Every member must be a properties form, and a member must state the tag as one admitted value, or
 * there is nothing to key the mapping by. A disjunction that does not meet both cannot be written.
 */
function exactlyOne(term: DescribedOf<'exactlyOne'>): Spelling<AtdSchema> {
  const discriminant = term.discriminant

  if (discriminant === undefined) {
    return new UnsayableTerm(
      [],
      'this admits exactly one of several shapes and names no property to choose by, and ATD chooses only by a tag'
    )
  }

  const mapping: Record<string, AtdProperties> = {}
  const departures: Departure[] = []

  for (const member of term.members) {
    if (member.kind !== 'typed' || member.name !== 'object') {
      return new UnsayableTerm(
        [],
        `a member of this is a ${member.kind}, and every member of an ATD discriminator must be an object`
      )
    }

    const tag = tagOf(member.assertions.properties, discriminant)
    if (tag === undefined) {
      return new UnsayableTerm(
        [discriminant],
        `a member of this does not state one value for ${discriminant}, so there is nothing to key the mapping by`
      )
    }

    const written = spellProperties(
      withoutKey(member.assertions.properties, discriminant),
      member.assertions.rest
    )
    if (isError(written)) {
      return written
    }

    departures.push(...under(tag, written.departures))
    mapping[tag] = written.written
  }

  return {
    written: nullable({ discriminator: discriminant, mapping }, term.admitsNull),
    departures
  }
}

/** The one value a member states at the discriminating key, where it states exactly one. */
function tagOf(
  properties: ReadonlyMap<string, DescribedProperty>,
  discriminant: string
): string | undefined {
  const property = properties.get(discriminant)
  if (property === undefined || property.term.kind !== 'values') {
    return undefined
  }

  const [only, ...rest] = property.term.admitted
  return rest.length === 0 && only?.of === 'string' ? only.value : undefined
}

function withoutKey(
  properties: ReadonlyMap<string, DescribedProperty>,
  key: string
): ReadonlyMap<string, DescribedProperty> {
  const kept = new Map(properties)
  kept.delete(key)
  return kept
}

/** A fixed set of values. ATD names one only where every value is a string. */
function values(term: DescribedOf<'values'>): Spelling<AtdSchema> {
  const named: string[] = []

  for (const value of term.admitted) {
    if (value.of !== 'string') {
      return new UnsayableTerm(
        [],
        `this admits a ${value.of}, and an ATD enum names strings and nothing else`
      )
    }
    named.push(value.value)
  }

  const [first, ...rest] = named
  return first === undefined
    ? new UnsayableTerm([], 'this admits no value, so there is nothing for a caller to send')
    : faithful(nullable({ enum: [first, ...rest] as [string, ...string[]] }, term.admitsNull))
}

/**
 * Values at positions, which ATD has no form for.
 *
 * Written as a list admitting anything, which accepts every value the tuple does and a great many
 * more. Wider and sound, and the alternative is refusing a construct that works.
 */
function tuple(term: DescribedOf<'tuple'>): Spelled<AtdSchema> {
  return {
    written: nullable({ elements: {} }, term.admitsNull),
    departures: [
      gaveUp(
        'wider',
        'noShapeForIt',
        `this states ${term.positions.length} values at positions, and ATD has only a list of one shape. The document accepts any list at all.`
      )
    ]
  }
}

/**
 * A whole description, written as ATD.
 *
 * The definitions travel beside the root rather than inside it, which is the shape arri wants: an
 * app definition holds `definitions` and every `ref` names a key of it.
 */
export function spellAtdAll(described: {
  readonly term: Described
  readonly definitions: ReadonlyMap<string, Described>
}): Spelling<{ root: AtdSchema; definitions: Readonly<Record<string, AtdSchema>> }> {
  const root = spellAtd(described.term)
  if (isError(root)) {
    return root
  }

  const definitions: Record<string, AtdSchema> = {}
  const departures: Departure[] = [...root.departures]

  for (const [name, term] of described.definitions) {
    const spelled = spellAtd(term)
    if (isError(spelled)) {
      return spelled
    }

    // The name is what a `ref` points at, so it is also what arri wants stated on the definition.
    definitions[name] = { ...spelled.written, metadata: { id: name } }
    departures.push(...under(name, spelled.departures))
  }

  return { written: { root: root.written, definitions }, departures }
}
