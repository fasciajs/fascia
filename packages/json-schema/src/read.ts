import type {
  AdmittedValue,
  Bound,
  JsonValue,
  Meta,
  Node,
  ObjectProperty,
  Rest,
  Scalar,
  Source,
  StringFormat
} from '@fasciajs/core'
import { isError, metaFrom, UnreadableSchema } from '@fasciajs/core'
import type { JSONSchema as Draft07 } from 'json-schema-typed/draft-07'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'
import { asCurrent, isContested, isKeyed } from './dialect.js'
import { stepsOf } from './refs.js'

/**
 * A 2020-12 document, read as a `Node`.
 *
 * The one frontend here that reads a document rather than a validator. A validator that writes its
 * own 2020-12 becomes a frontend through this one, so a fifth library is a document rather than a
 * reading of its internals.
 */

/**
 * A schema, and the document it stands in.
 *
 * A `$ref` names a place in the document rather than a schema, so resolving one needs the whole of
 * it. `read` is given a schema and nothing else, so the document travels beside it.
 */
export interface JsonSchemaAt {
  readonly root: unknown
  readonly schema: unknown
}

/** A document, read from its root. A draft-07 document is stated again in 2020-12 first. */
export function jsonSchemaAt(document: JSONSchema | Draft07): JsonSchemaAt {
  const root = asCurrent(document)
  return beside({ root, schema: root }, root)
}

/**
 * One pair per schema, so a schema reached twice is one thing.
 *
 * The walk asks whether two schemas are the same one, and it asks by identity: a name claimed twice
 * is two shapes under one name unless the two are one. A document reaches a definition through
 * several references, and a fresh pair for each would make every one of them a second claim.
 */
const pairs = new WeakMap<object, WeakMap<object, JsonSchemaAt>>()

export const jsonSchemaSource: Source<JsonSchemaAt> = { read, nameOf, metaOf }

/**
 * What a document calls a schema, which is the name a `$ref` points at.
 *
 * A definition carries no name of its own: it is named by where it stands. So the name is read off
 * the reference rather than off the schema, which is what arktype does with an alias.
 */
function nameOf(at: JsonSchemaAt): string | undefined {
  // A reference with other keywords beside it is a conjunction, and the conjunction is not the
  // definition. Named, it would claim the definition's name for a narrower schema.
  const reference = keyword(at.schema, '$ref')
  if (typeof reference !== 'string' || !isOneFamily(at.schema)) {
    return undefined
  }

  const [last] = (stepsOf(reference) ?? []).slice(-1)
  return last === undefined || last === '' ? undefined : last
}

function metaOf(at: JsonSchemaAt): Meta {
  return isKeyed(at.schema) ? metaFrom(at.schema) : {}
}

/** One keyword, where the schema is keyed rather than `true` or `false`. */
function keyword(schema: unknown, name: string): unknown {
  return isKeyed(schema) ? schema[name] : undefined
}

function beside(at: JsonSchemaAt, schema: unknown): JsonSchemaAt {
  const { root } = at
  if (!isKeyed(schema) || !isKeyed(root)) {
    return { root, schema }
  }

  const forRoot = pairs.get(root) ?? new WeakMap<object, JsonSchemaAt>()
  pairs.set(root, forRoot)

  const held = forRoot.get(schema)
  if (held !== undefined) {
    return held
  }

  const made: JsonSchemaAt = { root, schema }
  forRoot.set(schema, made)
  return made
}

function read(at: JsonSchemaAt): Node<JsonSchemaAt> | UnreadableSchema {
  const { schema } = at

  // `true` states nothing and `false` admits no value. A term states what is true of a value, and
  // there is nothing true of a value that cannot exist.
  if (schema === true) {
    return { kind: 'scalar', name: 'unknown', assertions: {} }
  }
  if (schema === false) {
    return new UnreadableSchema(
      at,
      'this admits no value, and a schema admitting none describes nothing a caller could send'
    )
  }
  if (!isKeyed(schema)) {
    return new UnreadableSchema(at, 'this is not a schema: a schema is an object or a boolean')
  }

  const parts = partsOf(schema)
  if (isError(parts)) {
    return parts
  }

  const [first, second, ...rest] = parts
  if (first === undefined) {
    return { kind: 'scalar', name: 'unknown', assertions: {} }
  }
  if (second === undefined) {
    return first === schema ? family(at) : read(beside(at, first))
  }

  return {
    kind: 'combination',
    law: 'all',
    members: [beside(at, first), beside(at, second), ...rest.map((one) => beside(at, one))],
    discriminant: undefined
  }
}

/** A schema stating one family of keywords, which is one case of a term. */
function family(at: JsonSchemaAt): Node<JsonSchemaAt> | UnreadableSchema {
  const { schema } = at

  const reference = keyword(schema, '$ref')
  if (typeof reference === 'string') {
    const target = resolve(at.root, reference)
    return target === undefined
      ? new UnreadableSchema(
          at,
          `this refers to ${reference}, which is not a place in this document, and a document somewhere else is one nobody fetched`
        )
      : { kind: 'deferred', resolve: () => beside(at, target) }
  }

  const combined = combination(at)
  if (combined !== undefined) {
    return combined
  }

  const admitted = admittedBy(schema)
  if (admitted !== undefined) {
    return admitted
  }

  return typed(at)
}

/**
 * The keywords each type is asserted by.
 *
 * Each holds only where the value is of its type, so a schema stating one and naming no type admits
 * every value of every other type.
 */
const ASSERTED = [
  'minLength',
  'maxLength',
  'pattern',
  'format',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'items',
  'prefixItems',
  'minItems',
  'maxItems',
  'uniqueItems',
  'properties',
  'required',
  'additionalProperties',
  'propertyNames'
] as const

/** Keywords that assert, and that no term has a word for. Dropped, each one would widen the term. */
const UNREAD = [
  'not',
  'if',
  'then',
  'else',
  'contains',
  'minContains',
  'maxContains',
  'patternProperties',
  'minProperties',
  'maxProperties',
  'dependentRequired',
  'dependentSchemas',
  'dependencies',
  'unevaluatedItems',
  'unevaluatedProperties',
  '$dynamicRef',
  '$recursiveRef'
] as const

const COMBINED = ['anyOf', 'oneOf'] as const

const has = (schema: Keyed, name: string): boolean => Object.hasOwn(schema, name)

type Keyed = Readonly<Record<string, unknown>>

/**
 * A schema as the conjunction of what it states.
 *
 * Every keyword of a 2020-12 schema holds at once, and `allOf` states the same conjunction in a
 * list. So a schema is cut into families, a reference, a disjunction, the admitted values and the
 * typed assertions, and each family is one member. A schema stating one family is itself the only
 * member, which keeps a schema reached twice the same one.
 *
 * A type distributes over a conjunction and a disjunction, so a member naming none takes the type
 * its conjunction names. `{ type: 'string', allOf: [{ pattern }] }` is how a document conjoins two
 * patterns, and the pattern alone admits every number.
 */
const cut = new WeakMap<object, readonly unknown[] | UnreadableSchema>()

function partsOf(schema: Keyed): readonly unknown[] | UnreadableSchema {
  const held = cut.get(schema)
  if (held !== undefined) {
    return held
  }

  const made = cutOf(schema)
  cut.set(schema, made)
  return made
}

function cutOf(schema: Keyed): readonly unknown[] | UnreadableSchema {
  if (isContested(schema)) {
    return new UnreadableSchema(
      schema,
      'this is a draft-07 reference with an assertion beside it, which the draft ignores and Ajv holds, so the document admits two sets of values'
    )
  }

  const unread = UNREAD.filter((name) => has(schema, name))
  if (unread.length > 0) {
    return new UnreadableSchema(
      schema,
      `this states ${unread.join(', ')}, and a term has no word for that, so reading the rest would admit more`
    )
  }

  if (isOneFamily(schema)) {
    return [schema]
  }

  const all = keyword(schema, 'allOf')
  const conjoined: readonly unknown[] = Array.isArray(all) ? all : []
  const valued = picked(schema, ['enum', 'const'])
  const asserted = picked(schema, ASSERTED)
  const type = [schema, ...conjoined].map(typeNamedBy).find((one) => one !== undefined)

  // Assertions under no type, beside a disjunction, hold in each member of it. arktype writes
  // `{ anyOf: [...], format: 'uuid' }`, and each member names the type the format asserts about.
  const [disjunction] = COMBINED.filter((name) => Array.isArray(keyword(schema, name)))
  const carried = type === undefined && disjunction !== undefined ? asserted : undefined

  const parts: unknown[] = []
  if (valued !== undefined) {
    // The values are of a type already, so a type beside them and nothing else filters them.
    parts.push(asserted === undefined ? { ...valued, ...picked(schema, ['type']) } : valued)
  }
  if (asserted !== undefined && carried === undefined) {
    parts.push({ ...asserted, ...(type !== undefined && { type }) })
  }
  if (has(schema, '$ref')) {
    parts.push({ $ref: schema['$ref'] })
  }
  for (const name of COMBINED) {
    const members = keyword(schema, name)
    if (members !== undefined) {
      const held = (one: unknown): unknown =>
        name === disjunction && carried !== undefined
          ? { allOf: [one, carried] }
          : underType(one, type)
      parts.push({ [name]: Array.isArray(members) ? members.map(held) : members })
    }
  }
  parts.push(...conjoined.map((one) => underType(one, type)))

  return parts
}

/** The type a schema names, by `type` or by a list of values that share one. */
function typeNamedBy(schema: unknown): unknown {
  if (!isKeyed(schema)) {
    return undefined
  }
  if (has(schema, 'type')) {
    return schema['type']
  }
  if (!(has(schema, 'enum') || has(schema, 'const'))) {
    return undefined
  }

  const stated = schema['enum']
  const values: readonly unknown[] = Array.isArray(stated) ? stated : [schema['const']]
  const types = new Set(values.map((one) => (one === null ? 'null' : typeof one)))
  const [only, ...rest] = [...types]
  return rest.length === 0 && (only === 'string' || only === 'number' || only === 'boolean')
    ? only
    : undefined
}

/** The keywords of a schema named here, or nothing where it states none of them. */
function picked(schema: Keyed, names: readonly string[]): Keyed | undefined {
  const held = names.filter((name) => has(schema, name))
  return held.length === 0
    ? undefined
    : Object.fromEntries(held.map((name) => [name, schema[name]]))
}

/**
 * A member of a conjunction, under the type the conjunction names.
 *
 * Given only to a member naming no type that asserts something or holds a disjunction, because a
 * type changes nothing about a reference or a list of values.
 */
function underType(member: unknown, type: unknown): unknown {
  if (type === undefined || !isKeyed(member) || has(member, 'type')) {
    return member
  }

  const typed =
    ASSERTED.some((name) => has(member, name)) ||
    has(member, 'anyOf') ||
    has(member, 'oneOf') ||
    has(member, 'allOf')
  return typed ? { ...member, type } : member
}

/** Whether a schema states at most one family, beside what it says about itself. */
function isOneFamily(schema: unknown): boolean {
  if (!isKeyed(schema)) {
    return true
  }

  const valued = has(schema, 'enum') || has(schema, 'const')
  const asserted = ASSERTED.some((name) => has(schema, name))
  // A type alone beside the values filters them, which is one family rather than two.
  const typed = asserted || (has(schema, 'type') && !valued)

  const families = [
    has(schema, '$ref'),
    has(schema, 'anyOf'),
    has(schema, 'oneOf'),
    has(schema, 'allOf'),
    valued,
    typed
  ].filter(Boolean).length

  // `allOf` is a conjunction and is cut into its members whatever stands beside it.
  return families <= 1 && !has(schema, 'allOf')
}

/**
 * What a `$ref` points at, or nothing where it points at no place in this document.
 *
 * A pointer inside this document, which is the one form a term can carry: a name stands for a
 * definition beside the schema that names it.
 */
function resolve(root: unknown, reference: string): unknown {
  const steps = stepsOf(reference)
  if (steps === undefined) {
    return undefined
  }

  let here: unknown = root
  for (const step of steps) {
    if (Array.isArray(here)) {
      here = /^(0|[1-9][0-9]*)$/.test(step) ? here[Number(step)] : undefined
    } else if (isKeyed(here) && Object.hasOwn(here, step)) {
      here = here[step]
    } else {
      return undefined
    }
  }

  return here
}

const LAWS = [
  ['anyOf', 'any'],
  ['oneOf', 'exactlyOne']
] as const

function combination(at: JsonSchemaAt): Node<JsonSchemaAt> | UnreadableSchema | undefined {
  for (const [name, law] of LAWS) {
    const stated = keyword(at.schema, name)
    if (stated === undefined) {
      continue
    }
    if (!Array.isArray(stated)) {
      return new UnreadableSchema(at, `this states ${name} as something other than a list`)
    }

    const [first, second, ...rest] = stated.map((one) => beside(at, one))
    if (first === undefined) {
      return new UnreadableSchema(at, `this states ${name} of nothing, which admits no value`)
    }
    if (second === undefined) {
      // A disjunction of one is the member, and the term has no node for a combination of one.
      return read(first)
    }

    return {
      kind: 'combination',
      law,
      members: [first, second, ...rest],
      discriminant: undefined
    }
  }

  return undefined
}

/**
 * `enum` and `const` state the values a schema admits, and the type of each travels with it.
 *
 * Both hold where both are stated, and a type beside them holds too, so each one filters the list.
 */
function admittedBy(schema: unknown): Node<JsonSchemaAt> | UnreadableSchema | undefined {
  if (!isKeyed(schema) || !(has(schema, 'enum') || has(schema, 'const'))) {
    return undefined
  }

  const stated = keyword(schema, 'enum')
  if (has(schema, 'enum') && !Array.isArray(stated)) {
    return new UnreadableSchema(schema, 'this states enum as something other than a list')
  }

  const listed: readonly unknown[] = Array.isArray(stated) ? stated : [schema['const']]
  const values: AdmittedValue[] = []
  for (const value of listed) {
    const one = admittedValue(value)
    if (one === undefined) {
      return new UnreadableSchema(
        schema,
        'this admits a value no term states: a term names a string, a number, a boolean and null'
      )
    }
    if (ofType(value, schema['type']) && (!has(schema, 'const') || value === schema['const'])) {
      values.push(one)
    }
  }

  const [first, ...rest] = values
  return first === undefined
    ? new UnreadableSchema(
        schema,
        'this admits no value, which describes nothing a caller could send'
      )
    : { kind: 'values', admitted: [first, ...rest] }
}

/** Whether a value is of a type a document names, where it names one. */
function ofType(value: unknown, type: unknown): boolean {
  if (type === undefined) {
    return true
  }
  if (Array.isArray(type)) {
    return type.some((one) => ofType(value, one))
  }

  switch (type) {
    case 'null':
      return value === null
    case 'integer':
      return Number.isInteger(value)
    case 'string':
    case 'number':
    case 'boolean':
      return typeof value === type
    default:
      return false
  }
}

function admittedValue(value: unknown): AdmittedValue | undefined {
  if (value === null) {
    return { of: 'null' }
  }
  if (typeof value === 'string') {
    return { of: 'string', value }
  }
  if (typeof value === 'number') {
    return { of: 'number', value }
  }
  if (typeof value === 'boolean') {
    return { of: 'boolean', value }
  }
  return undefined
}

/** The names a document gives a type, and what each one is in a term. */
const FORMAT_NAMES: Partial<Record<string, StringFormat>> = {
  email: 'email',
  uri: 'uri',
  uuid: 'uuid',
  hostname: 'hostname',
  ipv4: 'ipv4',
  ipv6: 'ipv6',
  date: 'date',
  time: 'time',
  'date-time': 'date-time',
  duration: 'duration'
}

function typed(at: JsonSchemaAt): Node<JsonSchemaAt> | UnreadableSchema {
  const { schema } = at
  const stated = keyword(schema, 'type')

  // A type list is how 2020-12 states nullability, and null is a value rather than a type. So the
  // list is read as the type it names beside a wrapper, which is where the term keeps the fact.
  if (Array.isArray(stated)) {
    const named = stated.filter((one) => one !== 'null')
    const [only, ...rest] = named
    if (only === undefined) {
      return { kind: 'values', admitted: [{ of: 'null' }] }
    }
    if (rest.length > 0) {
      return new UnreadableSchema(
        at,
        'this names several types at once, and a term states one type or a disjunction of schemas'
      )
    }
    if (named.length === stated.length) {
      return typedAs(at, String(only))
    }

    const inner = isKeyed(schema) ? { ...schema, type: only } : schema
    return { kind: 'wrapper', how: 'nullable', inner: beside(at, inner) }
  }

  if (typeof stated !== 'string') {
    // Each assertion holds only where the value is of its type, so one stated under no type admits
    // every value of every other type, and a term has no word for "anything but a string unless".
    const asserted = ASSERTED.filter((name) => isKeyed(schema) && has(schema, name))
    return asserted.length === 0
      ? { kind: 'scalar', name: 'unknown', assertions: {} }
      : new UnreadableSchema(
          at,
          `this states ${asserted.join(', ')} and names no type, so it admits every value of another type`
        )
  }

  return typedAs(at, stated)
}

function typedAs(at: JsonSchemaAt, name: string): Node<JsonSchemaAt> | UnreadableSchema {
  const { schema } = at

  switch (name) {
    case 'string':
      return { kind: 'scalar', name: 'string', assertions: stringAssertions(schema) }
    case 'integer':
      return {
        kind: 'scalar',
        name: 'number',
        assertions: { ...numberAssertions(schema), integer: true }
      }
    case 'number':
      return { kind: 'scalar', name: 'number', assertions: numberAssertions(schema) }
    case 'boolean':
      return { kind: 'scalar', name: 'boolean', assertions: {} }
    case 'null':
      return { kind: 'values', admitted: [{ of: 'null' }] }
    case 'array':
      return list(at)
    case 'object':
      return object(at)
    default:
      return new UnreadableSchema(at, `this names the type ${name}, which 2020-12 does not state`)
  }
}

function stringAssertions(schema: unknown): Extract<Scalar, { name: 'string' }>['assertions'] {
  const minLength = numberAt(schema, 'minLength')
  const maxLength = numberAt(schema, 'maxLength')
  const pattern = keyword(schema, 'pattern')
  const format = keyword(schema, 'format')
  const named = typeof format === 'string' ? FORMAT_NAMES[format] : undefined

  return {
    ...(minLength !== undefined && { minLength }),
    ...(maxLength !== undefined && { maxLength }),
    ...(typeof pattern === 'string' && { patterns: [pattern] }),
    ...(named !== undefined && { format: named })
  }
}

function numberAssertions(schema: unknown): Extract<Scalar, { name: 'number' }>['assertions'] {
  const minimum = bound(numberAt(schema, 'minimum'), numberAt(schema, 'exclusiveMinimum'), 1)
  const maximum = bound(numberAt(schema, 'maximum'), numberAt(schema, 'exclusiveMaximum'), -1)
  const multipleOf = numberAt(schema, 'multipleOf')

  return {
    ...(minimum !== undefined && { minimum }),
    ...(maximum !== undefined && { maximum }),
    ...(multipleOf !== undefined && { multipleOf })
  }
}

/**
 * The stricter of two bounds on one side, which is the one a value has to pass.
 *
 * `inward` is the direction that narrows: up for a minimum, down for a maximum. At one value the
 * exclusive bound is the stricter.
 */
function bound(
  inclusive: number | undefined,
  exclusive: number | undefined,
  inward: 1 | -1
): Bound<number> | undefined {
  if (exclusive === undefined) {
    return inclusive === undefined ? undefined : { value: inclusive, exclusive: false }
  }
  return inclusive !== undefined && (inclusive - exclusive) * inward > 0
    ? { value: inclusive, exclusive: false }
    : { value: exclusive, exclusive: true }
}

function numberAt(schema: unknown, name: string): number | undefined {
  const stated = keyword(schema, name)
  return typeof stated === 'number' && Number.isFinite(stated) ? stated : undefined
}

/**
 * An array, which states a list, a tuple or a set.
 *
 * `prefixItems` names what stands at a position, and `minItems` beside it is how many of them must
 * be present. `uniqueItems` is what this library writes for a set, so it is read back as one: a
 * document has no other way to say that no value is held twice, and reading it as a list would drop
 * the only thing the keyword states.
 */
function list(at: JsonSchemaAt): Node<JsonSchemaAt> | UnreadableSchema {
  const { schema } = at
  const prefix = keyword(schema, 'prefixItems')
  const items = keyword(schema, 'items')
  const minItems = numberAt(schema, 'minItems')
  const maxItems = numberAt(schema, 'maxItems')
  const unique = keyword(schema, 'uniqueItems') === true

  if (Array.isArray(prefix) || items === false) {
    return unique
      ? new UnreadableSchema(
          at,
          'this states values at positions that do not repeat, and a term states a tuple or a set'
        )
      : tuple(at, Array.isArray(prefix) ? prefix : [], items, minItems ?? 0, maxItems)
  }

  const element = items === undefined ? beside(at, true) : beside(at, items)
  const assertions = {
    ...(minItems !== undefined && { minItems }),
    ...(maxItems !== undefined && { maxItems })
  }

  return unique
    ? { kind: 'structural', of: 'set', items: element, assertions }
    : { kind: 'structural', of: 'list', items: element, assertions }
}

/**
 * Values at positions, with the counts a document states beside them.
 *
 * A term counts only the positions it names, so a count past them is unrolled into positions: what
 * stands past the prefix is the `items` schema, so a list of at least three is three positions. An
 * upper count is the last position, and nothing stands after it.
 */
function tuple(
  at: JsonSchemaAt,
  prefix: readonly unknown[],
  items: unknown,
  minItems: number,
  maxItems: number | undefined
): Node<JsonSchemaAt> | UnreadableSchema {
  const most = items === false ? Math.min(prefix.length, maxItems ?? prefix.length) : maxItems
  if (most !== undefined && minItems > most) {
    return new UnreadableSchema(
      at,
      `this needs at least ${minItems} values and holds at most ${most}, which admits no list`
    )
  }

  const length = most ?? Math.max(prefix.length, minItems)
  const after = items === undefined ? true : items
  const positions = Array.from({ length }, (_, index) =>
    beside(at, index < prefix.length ? prefix[index] : after)
  )

  return {
    kind: 'structural',
    of: 'tuple',
    positions,
    minPositions: minItems,
    rest: most === undefined ? restOf(at, items) : { allows: 'nothing' }
  }
}

function restOf(at: JsonSchemaAt, items: unknown): Rest<JsonSchemaAt> {
  if (items === undefined || items === true) {
    return { allows: 'anything' }
  }
  if (items === false) {
    return { allows: 'nothing' }
  }
  return { allows: 'schema', schema: beside(at, items) }
}

function object(at: JsonSchemaAt): Node<JsonSchemaAt> | UnreadableSchema {
  const { schema } = at
  const stated = keyword(schema, 'properties')
  const required = keyword(schema, 'required')
  const additional = keyword(schema, 'additionalProperties')
  const names = new Set(Array.isArray(required) ? required.map(String) : [])

  const keys = keyword(schema, 'propertyNames')
  if (!(keys === undefined || keys === true || isStringOnly(keys))) {
    return new UnreadableSchema(
      at,
      'this asserts about the keys of an object, which a term does not'
    )
  }

  const properties = new Map<string, ObjectProperty<JsonSchemaAt>>()
  for (const [name, one] of Object.entries(isKeyed(stated) ? stated : {})) {
    properties.set(name, {
      schema: beside(at, one),
      required: names.has(name),
      default: defaultAt(one)
    })
  }

  // A key required and named nowhere else is held to whatever the rest of the object is held to.
  for (const name of names) {
    if (!properties.has(name)) {
      properties.set(name, {
        schema: beside(at, additional ?? true),
        required: true,
        default: undefined
      })
    }
  }

  return {
    kind: 'structural',
    of: 'object',
    properties,
    rest: restOf(at, additional)
  }
}

/** A schema for keys that every key passes: keys are strings, and nothing else is stated. */
function isStringOnly(schema: unknown): boolean {
  return (
    isKeyed(schema) &&
    Object.keys(schema).every((name) => name === 'type') &&
    (schema['type'] === undefined || schema['type'] === 'string')
  )
}

/**
 * What stands in where a key is absent, which a document states beside the schema at the key.
 *
 * Parsed rather than taken. A document holds whatever a caller wrote there, and a value that does
 * not travel as JSON is one no document carries to the other side.
 */
function defaultAt(schema: unknown): JsonValue | undefined {
  return asJsonValue(keyword(schema, 'default'))
}

function asJsonValue(value: unknown): JsonValue | undefined {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined
  }
  if (Array.isArray(value)) {
    const held: JsonValue[] = []
    for (const one of value) {
      const each = asJsonValue(one)
      if (each === undefined) {
        return undefined
      }
      held.push(each)
    }
    return held
  }
  if (isKeyed(value)) {
    const held: Record<string, JsonValue> = {}
    for (const [name, one] of Object.entries(value)) {
      const each = asJsonValue(one)
      if (each === undefined) {
        return undefined
      }
      held[name] = each
    }
    return held
  }
  return undefined
}
