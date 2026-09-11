import type {
  AdmittedValue,
  JsonValue,
  Meta,
  Node,
  ObjectProperty,
  Rest,
  Scalar,
  Source,
  StringFormat
} from '@fasciajs/core'
import { metaFrom, UnreadableSchema } from '@fasciajs/core'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

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

/** A document, read from its root. */
export function jsonSchemaAt(root: JSONSchema): JsonSchemaAt {
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
  const reference = keyword(at.schema, '$ref')
  if (typeof reference !== 'string') {
    return undefined
  }

  const [last] = reference.split('/').slice(-1)
  return last === undefined || last === '' ? undefined : decodeURIComponent(last)
}

function metaOf(at: JsonSchemaAt): Meta {
  return isKeyed(at.schema) ? metaFrom(at.schema) : {}
}

/** A document is unknown data, and this is where it is parsed. A schema is keyed or it is not. */
function isKeyed(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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

  const reference = keyword(schema, '$ref')
  if (typeof reference === 'string') {
    return { kind: 'deferred', resolve: () => beside(at, resolve(at.root, reference)) }
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
 * What a `$ref` points at.
 *
 * A pointer inside this document, which is the one form a term can carry: a name stands for a
 * definition beside the schema that names it, and a document somewhere else is a document nobody
 * fetched.
 */
function resolve(root: unknown, reference: string): unknown {
  if (!reference.startsWith('#/')) {
    return false
  }

  let here: unknown = root
  for (const step of reference.slice(2).split('/')) {
    const name = decodeURIComponent(step.replaceAll('~1', '/').replaceAll('~0', '~'))
    if (!isKeyed(here)) {
      return false
    }
    here = here[name]
  }

  return here === undefined ? false : here
}

const LAWS = [
  ['anyOf', 'any'],
  ['oneOf', 'exactlyOne'],
  ['allOf', 'all']
] as const

function combination(at: JsonSchemaAt): Node<JsonSchemaAt> | UnreadableSchema | undefined {
  for (const [name, law] of LAWS) {
    const stated = keyword(at.schema, name)
    if (!Array.isArray(stated)) {
      continue
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

/** `enum` and `const` state the values a schema admits, and the type of each travels with it. */
function admittedBy(schema: unknown): Node<JsonSchemaAt> | UnreadableSchema | undefined {
  const stated = keyword(schema, 'enum')
  const only = keyword(schema, 'const')
  const values = Array.isArray(stated) ? stated : only === undefined ? undefined : [only]
  if (values === undefined) {
    return undefined
  }

  const admitted: AdmittedValue[] = []
  for (const value of values) {
    const one = admittedValue(value)
    if (one === undefined) {
      return new UnreadableSchema(
        schema,
        'this admits a value no term states: a term names a string, a number, a boolean and null'
      )
    }
    admitted.push(one)
  }

  const [first, ...rest] = admitted
  return first === undefined
    ? new UnreadableSchema(
        schema,
        'this admits no value, which describes nothing a caller could send'
      )
    : { kind: 'values', admitted: [first, ...rest] }
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
    return { kind: 'scalar', name: 'unknown', assertions: {} }
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
  const exclusiveMinimum = numberAt(schema, 'exclusiveMinimum')
  const exclusiveMaximum = numberAt(schema, 'exclusiveMaximum')
  const minimum = exclusiveMinimum ?? numberAt(schema, 'minimum')
  const maximum = exclusiveMaximum ?? numberAt(schema, 'maximum')
  const multipleOf = numberAt(schema, 'multipleOf')

  return {
    ...(minimum !== undefined && {
      minimum: { value: minimum, exclusive: exclusiveMinimum !== undefined }
    }),
    ...(maximum !== undefined && {
      maximum: { value: maximum, exclusive: exclusiveMaximum !== undefined }
    }),
    ...(multipleOf !== undefined && { multipleOf })
  }
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
function list(at: JsonSchemaAt): Node<JsonSchemaAt> {
  const { schema } = at
  const prefix = keyword(schema, 'prefixItems')
  const items = keyword(schema, 'items')
  const minItems = numberAt(schema, 'minItems')
  const maxItems = numberAt(schema, 'maxItems')

  if (Array.isArray(prefix)) {
    return {
      kind: 'structural',
      of: 'tuple',
      positions: prefix.map((one) => beside(at, one)),
      // A document holding `prefixItems` alone accepts a shorter list, so a term reading one states
      // that nothing must be present. More than the positions is a count no term can carry.
      minPositions: Math.min(minItems ?? 0, prefix.length),
      rest: restOf(at, items)
    }
  }

  const element = items === undefined ? beside(at, true) : beside(at, items)
  const assertions = {
    ...(minItems !== undefined && { minItems }),
    ...(maxItems !== undefined && { maxItems })
  }

  return keyword(schema, 'uniqueItems') === true
    ? { kind: 'structural', of: 'set', items: element, assertions }
    : { kind: 'structural', of: 'list', items: element, assertions }
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

function object(at: JsonSchemaAt): Node<JsonSchemaAt> {
  const { schema } = at
  const stated = keyword(schema, 'properties')
  const required = keyword(schema, 'required')
  const names = new Set(Array.isArray(required) ? required.map(String) : [])

  const properties = new Map<string, ObjectProperty<JsonSchemaAt>>()
  if (typeof stated === 'object' && stated !== null) {
    for (const [name, one] of Object.entries(stated)) {
      properties.set(name, {
        schema: beside(at, one),
        required: names.has(name),
        default: defaultAt(one)
      })
    }
  }

  return {
    kind: 'structural',
    of: 'object',
    properties,
    rest: restOf(at, keyword(schema, 'additionalProperties'))
  }
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
