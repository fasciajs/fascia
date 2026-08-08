import type {
  AdmittedValue,
  Departure,
  Described,
  DescribedOf,
  DescribedRest,
  Spelled,
  Spelling
} from '@fasciajs/core'
import { faithful, isError, UnsayableTerm, under } from '@fasciajs/core'
import type { AttributeName, AttributeShape, MapEntry, RestShape } from './attribute.js'
import { anyAttribute } from './attribute.js'

/**
 * A term, written as the AttributeValue members a value may take.
 *
 * The third target, and it is the first that does not describe JSON. That is what it is for. ATD and
 * 2020-12 disagree about how to say things and agree about what there is to say; DynamoDB has ten
 * types, no keyword for a single assertion, no name, and a native set. So it says things both of the
 * others refuse and refuses most of what both of them state exactly.
 *
 * **Every assertion a term carries becomes a departure here.** There is nowhere to put a length, a
 * bound or a pattern, so a document is wider than its schema wherever the schema asserted anything.
 * That is the widest this library gets and it is reported rather than silent.
 */
export function spellDynamo(term: Described): Spelling<AttributeShape> {
  const spelled = body(term)
  if (isError(spelled)) {
    return spelled
  }

  // A term admitting null admits one more member. Nullability reaches a fourth target and is spelled
  // a fourth way: a flag beside a type, a member of a type list, a joined branch, and here a member
  // of the coproduct itself.
  return term.admitsNull
    ? { written: { ...spelled.written, NULL: {} }, departures: spelled.departures }
    : spelled
}

function body(term: Described): Spelling<AttributeShape> {
  switch (term.kind) {
    case 'typed':
      return typed(term)
    case 'values':
      return values(term)
    case 'tuple':
      return tuple(term)
    case 'some':
    case 'exactlyOne':
      return anyOf(term.members)

    case 'untyped':
      return faithful(anyAttribute)

    case 'every':
      return new UnsayableTerm(
        [],
        'this admits all of several shapes at once, and an AttributeValue is one member with no form for an intersection'
      )

    case 'ref':
      return new UnsayableTerm(
        [],
        `this refers to ${term.name}, and an AttributeValue has no reference form and no table to resolve one against. A schema that holds itself cannot be written here`
      )

    default:
      term satisfies never
      throw new Error('a term reached this target with a case it states no answer for')
  }
}

/** What is lost where a term asserts something and this target has nowhere to put it. */
function dropped(what: string): Departure {
  return {
    at: [],
    direction: 'wider',
    cause: 'noWordForIt',
    said: `this states ${what}, and an AttributeValue names a type and asserts nothing about the value under it. The document accepts values the schema refuses`
  }
}

function typed(term: DescribedOf<'typed'>): Spelling<AttributeShape> {
  switch (term.name) {
    case 'boolean':
      return faithful({ BOOL: {} })
    case 'string':
      return { written: { S: {} }, departures: assertedOn(term.assertions) }
    case 'number':
      // `N` is a string of up to thirty-eight digits, so DynamoDB carries whole numbers this target
      // cannot state and a schema cannot ask for. The width is the marshaller's question.
      return { written: { N: {} }, departures: assertedOn(term.assertions) }
    case 'array':
      return list(term)
    case 'object':
      return map(term)
    default:
      term satisfies never
      throw new Error('a term named a type this target was not asked about')
  }
}

/** Every assertion, reported. This target has a keyword for none of them. */
function assertedOn(assertions: Readonly<Record<string, unknown>>): Departure[] {
  const stated = Object.entries(assertions)
    .filter(([, value]) => value !== undefined)
    .map(([key]) => key)

  return stated.length === 0 ? [] : [dropped(stated.join(', '))]
}

/**
 * A list, or a set where the term said the items do not repeat.
 *
 * `SS` and `NS` are the one place this target says something both of the others refuse: a set is not
 * a value JSON carries, and DynamoDB has three of them. A set is exact where the items are strings
 * or numbers that do not repeat, and DynamoDB holds no set of anything else.
 */
function list(term: Extract<DescribedOf<'typed'>, { name: 'array' }>): Spelling<AttributeShape> {
  const items = spellDynamo(term.assertions.items)
  if (isError(items)) {
    return items
  }

  const departures = [
    ...under('items', items.departures),
    ...assertedOn({
      minItems: term.assertions.minItems,
      maxItems: term.assertions.maxItems
    })
  ]

  const set = setOf(term.assertions)
  if (set !== undefined) {
    return { written: memberShape(set), departures }
  }

  return { written: { L: { items: items.written } }, departures }
}

/**
 * Which set holds these items, where a set holds them at all.
 *
 * Asked of the term rather than of a validator, because a set is a fact about the values and every
 * validator states it somewhere else. No reading produces `unique` yet, so this is reached only by a
 * term stated directly, and the spec beside this file states one.
 */
function setOf(
  assertions: Extract<DescribedOf<'typed'>, { name: 'array' }>['assertions']
): AttributeName | undefined {
  if (assertions.unique !== true) {
    return undefined
  }

  const items = assertions.items
  if (items.kind !== 'typed' || items.admitsNull) {
    return undefined
  }

  return items.name === 'string' ? 'SS' : items.name === 'number' ? 'NS' : undefined
}

function map(term: Extract<DescribedOf<'typed'>, { name: 'object' }>): Spelling<AttributeShape> {
  const attributes = new Map<string, MapEntry>()
  const departures: Departure[] = []

  for (const [name, property] of term.assertions.properties) {
    const spelled = spellDynamo(property.term)
    if (isError(spelled)) {
      return spelled
    }

    attributes.set(name, { shape: spelled.written, required: property.required })
    departures.push(...under(name, spelled.departures))
  }

  const rest = restOf(term.assertions.rest)
  if (isError(rest)) {
    return rest
  }
  departures.push(...under('rest', rest.departures))

  return { written: { M: { attributes, rest: rest.written } }, departures }
}

function restOf(rest: DescribedRest): Spelling<RestShape> {
  switch (rest.allows) {
    case 'anything':
      return faithful({ allows: 'anything' })
    case 'nothing':
      return faithful({ allows: 'nothing' })
    case 'term': {
      const spelled = spellDynamo(rest.term)
      return isError(spelled)
        ? spelled
        : { written: { allows: 'shape', shape: spelled.written }, departures: spelled.departures }
    }
    default:
      rest satisfies never
      throw new Error('a term stated a rest of no kind')
  }
}

/**
 * A fixed set of values, which reaches the member each value is carried under.
 *
 * A bigint arrives here. `N` is a string, so DynamoDB carries one, where JSON has no form for it and
 * both of the other targets refuse the term outright. The set of admitted values is lost, because
 * nothing here states which values a member may take.
 */
function values(term: DescribedOf<'values'>): Spelling<AttributeShape> {
  const [first, ...rest] = term.admitted
  let written = memberShape(memberOf(first))

  for (const value of rest) {
    written = { ...written, ...memberShape(memberOf(value)) }
  }

  return { written, departures: [dropped(`${term.admitted.length} admitted value(s)`)] }
}

/**
 * One member, as a shape.
 *
 * A switch rather than a computed key. `{ [name]: {} }` is a record of every name, which is not a
 * shape: a shape states at least one member and a record states none. The `satisfies never` makes a
 * member added to the coproduct a compile error here.
 */
function memberShape(name: AttributeName): AttributeShape {
  switch (name) {
    case 'S':
      return { S: {} }
    case 'N':
      return { N: {} }
    case 'B':
      return { B: {} }
    case 'SS':
      return { SS: {} }
    case 'NS':
      return { NS: {} }
    case 'BS':
      return { BS: {} }
    case 'BOOL':
      return { BOOL: {} }
    case 'NULL':
      return { NULL: {} }
    case 'M':
      return { M: { attributes: new Map(), rest: { allows: 'anything' } } }
    case 'L':
      return { L: { items: anyAttribute } }
    default:
      name satisfies never
      throw new Error('a member of no name reached this target')
  }
}

function memberOf(value: AdmittedValue): AttributeName {
  switch (value.of) {
    case 'string':
      return 'S'
    case 'number':
    case 'bigint':
      return 'N'
    case 'boolean':
      return 'BOOL'
    case 'null':
      return 'NULL'
    default:
      value satisfies never
      throw new Error('a term admitted a value of no kind')
  }
}

/**
 * Values at positions, written as a list of whatever any position admits.
 *
 * Wider twice over. Nothing states how many values there are, and nothing states which shape stands
 * at which position, so a list of the wrong things in the wrong order is admitted.
 */
function tuple(term: DescribedOf<'tuple'>): Spelling<AttributeShape> {
  const [first, ...rest] = term.positions

  // A tuple of no positions admits the empty list, and what a list holds is not asked of one that
  // holds nothing.
  const positions = first === undefined ? faithful(anyAttribute) : anyOf([first, ...rest])
  if (isError(positions)) {
    return positions
  }

  return {
    written: { L: { items: positions.written } },
    departures: [
      ...positions.departures,
      {
        at: [],
        direction: 'wider',
        cause: 'noShapeForIt',
        said: `this states ${term.positions.length} values at positions, and a list here holds one shape for every element. Nothing states the count or which shape stands where`
      }
    ]
  }
}

/**
 * Several terms, as the members any of them admits.
 *
 * Exact where the members land on different tags, which is what a coproduct is for and what ATD
 * refuses outright. Lossy where two land on the same one: two maps become one map, and which is
 * which cannot be said.
 */
function anyOf(members: readonly [Described, ...Described[]]): Spelling<AttributeShape> {
  const departures: Departure[] = []
  const seen = new Set<string>()
  let collided = false
  let written: AttributeShape | undefined

  for (const [index, member] of members.entries()) {
    const spelled = spellDynamo(member)
    if (isError(spelled)) {
      return spelled
    }

    for (const name of Object.keys(spelled.written)) {
      collided = collided || seen.has(name)
      seen.add(name)
    }

    written = written === undefined ? spelled.written : { ...written, ...spelled.written }
    departures.push(...under(String(index), spelled.departures))
  }

  if (written === undefined) {
    throw new Error('a disjunction of no members reached this target')
  }

  if (collided) {
    departures.push({
      at: [],
      direction: 'wider',
      cause: 'noShapeForIt',
      said: 'two of these are carried under one member, and a value states its member and nothing else. The document admits either where the schema admitted one of them'
    })
  }

  return { written, departures }
}

/**
 * A whole description, where every name it refers to has been described in place.
 *
 * There is no `$defs` and no `definitions` here, so a description holding a reference cannot be
 * written at all. Stated as its own function so the refusal names the target rather than arriving as
 * a missing case somewhere downstream.
 */
export function spellDynamoAll(described: {
  readonly term: Described
  readonly definitions: ReadonlyMap<string, Described>
}): Spelling<AttributeShape> {
  if (described.definitions.size > 0) {
    return new UnsayableTerm(
      [],
      `this names ${[...described.definitions.keys()].join(', ')}, and an AttributeValue has no reference form. Describe the schema without a name, or write it to a target that holds definitions`
    )
  }

  return spellDynamo(described.term)
}

/** Declared for the shape of the two other targets, which each return this from their entry point. */
export type SpelledAttribute = Spelled<AttributeShape>
