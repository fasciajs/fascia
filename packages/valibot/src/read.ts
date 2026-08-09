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
import { ReadableValibotTypes, UnreadableValibotTypes } from './valibot-types.js'

/**
 * A valibot schema, read as a `Node`.
 *
 * **valibot states an assertion as a list of actions on the node itself**, which is a fourth shape
 * for one fact. zod folds them into a bag, arktype keeps them beside a basis, effect wraps the
 * schema in one node per refinement, and valibot puts the base type on the node and the actions in a
 * `pipe` beside it. So a bounded string here is one node with a list, and reading an assertion means
 * walking that list rather than the tree.
 *
 * A transformation lives in the same list, so a converting schema and a checking one have the same
 * `type` and differ by what stands in the pipe.
 *
 * valibot publishes no union of its schemas and no discriminated type to switch on. `GenericSchema`
 * says `type: string`, which narrows to nothing, so the map from a name to a node is derived from
 * what the factories return and a field is reached through that.
 */
export const valibotSource: Source<ValibotSchema> = { read, nameOf, metaOf }

/**
 * What this package accepts, which is any node valibot calls a schema.
 *
 * Read through the derived map rather than through this. It states the two fields every schema
 * carries and nothing else, because that is all valibot states of every schema.
 */
export interface ValibotSchema {
  readonly kind: 'schema'
  readonly type: string
  readonly pipe?: readonly ValibotAction[]
}

/** One step of a pipe, which is a schema, an assertion, a conversion or a word about the schema. */
interface ValibotAction {
  readonly kind: string
  readonly type: string
  readonly requirement?: unknown
  /** What an action carries beyond its name, which differs by action and is read by name. */
  readonly [key: string]: unknown
}

/** A schema whose name the caller already checked, with the fields that name carries. */
type Known = ValibotSchema & Record<string, unknown>

function isType<N extends string>(
  schema: ValibotSchema,
  names: readonly N[]
): schema is Known & { readonly type: N } {
  return (names as readonly string[]).includes(schema.type)
}

/**
 * What a caller called this schema.
 *
 * valibot names nothing on its own, so a caller states one with `v.metadata({ id })`, which stands
 * in the pipe beside the assertions. Without one a schema that holds itself cannot be described.
 */
function nameOf(schema: ValibotSchema): string | undefined {
  const stated = metadataOf(schema)['id']
  return typeof stated === 'string' ? stated : undefined
}

/**
 * What a caller said about this schema.
 *
 * valibot states each word as its own action, so a title and a description are two steps of the pipe
 * rather than two keys of one object. Nothing here is derived by valibot, so everything found is
 * something somebody wrote.
 */
function metaOf(schema: ValibotSchema): Meta {
  const bag: Record<string, unknown> = { ...metadataOf(schema) }

  for (const action of schema.pipe ?? []) {
    if (action.kind !== 'metadata') {
      continue
    }
    if (action.type === 'title' || action.type === 'description') {
      bag[action.type] = action[action.type]
    }
  }

  return metaFrom(bag)
}

/** What `v.metadata(...)` was given, which is where a caller puts a name. */
function metadataOf(schema: ValibotSchema): Record<string, unknown> {
  for (const action of schema.pipe ?? []) {
    const stated = action['metadata']
    if (action.type === 'metadata' && typeof stated === 'object' && stated !== null) {
      return stated as Record<string, unknown>
    }
  }
  return {}
}

function read(schema: ValibotSchema): Node<ValibotSchema> | UnreadableSchema {
  const name = schema.type

  if (name in UnreadableValibotTypes) {
    return new UnreadableSchema(
      schema,
      UnreadableValibotTypes[name as keyof typeof UnreadableValibotTypes]
    )
  }

  if (!isType(schema, ReadableValibotTypes)) {
    return new UnreadableSchema(
      schema,
      `valibot calls this a ${name} and this package classifies no such schema`
    )
  }

  // A conversion stands in the same pipe as the assertions, so what a schema converts is what it
  // states with the pipe cut short at the conversion.
  const converts = (schema.pipe ?? []).findIndex((action) => action.kind === 'transformation')
  if (converts >= 0) {
    return {
      kind: 'conversion',
      how: 'unstatedOutput',
      sent: { ...schema, pipe: (schema.pipe ?? []).slice(0, converts) }
    }
  }

  return structural(schema, schema.type)
}

function structural(
  schema: Known,
  name: ReadableValibotTypes
): Node<ValibotSchema> | UnreadableSchema {
  switch (name) {
    case 'string':
      return { kind: 'scalar', name: 'string', assertions: stringAssertions(schema) }
    case 'number':
      return { kind: 'scalar', name: 'number', assertions: numberAssertions(schema) }
    case 'boolean':
      return { kind: 'scalar', name: 'boolean', assertions: {} }
    case 'bigint':
      return { kind: 'scalar', name: 'bigint', assertions: {} }
    case 'date':
      return { kind: 'scalar', name: 'date', assertions: {} }
    case 'null':
      return { kind: 'scalar', name: 'null', assertions: {} }
    case 'any':
    case 'unknown':
      return { kind: 'scalar', name: 'unknown', assertions: {} }

    case 'literal':
      return admitted([schema['literal']], schema)
    case 'picklist':
      return admitted(asList(schema['options']), schema)
    case 'enum':
      return admitted(Object.values(asRecord(schema['enum'])), schema)

    // Absence and null are two facts, and valibot states each with its own wrapper and one with
    // both. `nullish` is the pair, and a document states the two in two places.
    case 'optional':
    case 'exact_optional':
    case 'undefinedable': {
      // valibot lets a default be a function, which states nothing a document can carry. Such a
      // schema is read as one whose key may simply be absent.
      const replacement = asJsonValue(schema['default'])
      return replacement === undefined
        ? wrapper(schema, 'optional')
        : {
            kind: 'wrapper',
            how: 'default',
            inner: asSchema(schema['wrapped']),
            value: replacement
          }
    }
    case 'nullable':
      return wrapper(schema, 'nullable')
    case 'nullish':
      return wrapper(schema, 'nullable')
    case 'non_optional':
    case 'non_nullish':
      return wrapper(schema, 'nonoptional')
    case 'non_nullable':
      return wrapper(schema, 'nonoptional')

    case 'object':
    case 'loose_object':
      return object(schema, { allows: 'anything' })
    case 'strict_object':
      return object(schema, { allows: 'nothing' })
    case 'object_with_rest':
      return object(schema, { allows: 'schema', schema: asSchema(schema['rest']) })

    case 'array':
      return {
        kind: 'structural',
        of: 'list',
        items: asSchema(schema['item']),
        assertions: listAssertions(schema)
      }

    // `v.tuple` drops what stands past its positions rather than refusing it, so a longer list is
    // accepted and the extras do not come back. `strictTuple` is the one that refuses. zod's tuple
    // means the opposite by the same word, and the property found this on its first run.
    case 'tuple':
    case 'loose_tuple':
      return tuple(schema, { allows: 'anything' })
    case 'strict_tuple':
      return tuple(schema, { allows: 'nothing' })
    case 'tuple_with_rest':
      return tuple(schema, { allows: 'schema', schema: asSchema(schema['rest']) })

    case 'record':
      return {
        kind: 'structural',
        of: 'dictionary',
        keys: asSchema(schema['key']),
        values: asSchema(schema['value'])
      }

    case 'union':
      return { kind: 'combination', law: 'any', members: members(schema), discriminant: undefined }
    case 'variant':
      return {
        kind: 'combination',
        law: 'exactlyOne',
        members: members(schema),
        discriminant: typeof schema['key'] === 'string' ? schema['key'] : undefined
      }
    case 'intersect':
      return { kind: 'combination', law: 'all', members: members(schema), discriminant: undefined }

    case 'lazy':
      return { kind: 'deferred', resolve: () => resolve(schema) }

    default:
      name satisfies never
      throw new Error(`valibot states a schema this package reads no case for: ${String(name)}`)
  }
}

function wrapper(schema: Known, how: 'optional' | 'nullable' | 'nonoptional'): Node<ValibotSchema> {
  return { kind: 'wrapper', how, inner: asSchema(schema['wrapped']) }
}

function object(schema: Known, rest: Rest<ValibotSchema>): Node<ValibotSchema> {
  const properties = new Map<string, ObjectProperty<ValibotSchema>>()

  for (const [key, value] of Object.entries(asRecord(schema['entries']))) {
    properties.set(key, propertyOf(asSchema(value)))
  }

  return { kind: 'structural', of: 'object', properties, rest }
}

/**
 * A property, with whether the key may be absent lifted onto the edge.
 *
 * The schema a caller wrote stays where it is, because a wrapper carries a caller's words and the
 * term drops the wrapper on its own.
 */
function propertyOf(schema: ValibotSchema): ObjectProperty<ValibotSchema> {
  let current = schema
  let required: boolean | undefined
  let replacement: JsonValue | undefined

  for (;;) {
    if (isType(current, ['optional', 'exact_optional', 'undefinedable', 'nullish'])) {
      required ??= false
      replacement ??= asJsonValue(current['default'])
      current = asSchema(current['wrapped'])
      continue
    }
    if (isType(current, ['non_optional', 'non_nullish'])) {
      required ??= true
      current = asSchema(current['wrapped'])
      continue
    }
    break
  }

  return { schema, required: required ?? true, default: replacement }
}

function tuple(schema: Known, rest: Rest<ValibotSchema>): Node<ValibotSchema> {
  return {
    kind: 'structural',
    of: 'tuple',
    positions: asList(schema['items']).map(asSchema),
    rest
  }
}

function members(schema: Known): readonly [ValibotSchema, ValibotSchema, ...ValibotSchema[]] {
  const [first, second, ...rest] = asList(schema['options']).map(asSchema)
  if (first === undefined || second === undefined) {
    throw new Error('valibot states a combination of fewer than two members')
  }
  return [first, second, ...rest]
}

/** What a lazy schema stands for. valibot passes the input to the getter, and a name needs none. */
function resolve(schema: Known): ValibotSchema {
  const getter = schema['getter']
  if (typeof getter !== 'function') {
    throw new Error('valibot states a lazy schema with no getter')
  }
  return asSchema((getter as (input: unknown) => unknown)(undefined))
}

function admitted(
  values: readonly unknown[],
  schema: ValibotSchema
): Node<ValibotSchema> | UnreadableSchema {
  const list: AdmittedValue[] = []

  for (const value of values) {
    const one = asAdmittedValue(value)
    if (one === undefined) {
      return new UnreadableSchema(schema, 'this admits a value that is not one JSON carries')
    }
    list.push(one)
  }

  const [first, ...rest] = list
  return first === undefined
    ? new UnreadableSchema(
        schema,
        'this admits no value, so it describes nothing a caller could send'
      )
    : { kind: 'values', admitted: [first, ...rest] }
}

/** The formats a document has a name for, keyed by what valibot calls the action. */
const FORMATS: Partial<Record<string, StringFormat>> = {
  email: 'email',
  url: 'uri',
  uuid: 'uuid',
  ipv4: 'ipv4',
  ipv6: 'ipv6',
  iso_date: 'date',
  iso_time: 'time',
  iso_date_time: 'date-time',
  iso_timestamp: 'date-time'
}

function stringAssertions(schema: Known): Extract<Scalar, { name: 'string' }>['assertions'] {
  let minLength: number | undefined
  let maxLength: number | undefined
  let format: StringFormat | undefined
  const patterns: string[] = []

  for (const action of schema.pipe ?? []) {
    const requirement = action.requirement
    if (action.type === 'min_length' && typeof requirement === 'number') {
      minLength = requirement
    }
    if (action.type === 'max_length' && typeof requirement === 'number') {
      maxLength = requirement
    }
    if (action.type === 'length' && typeof requirement === 'number') {
      minLength = requirement
      maxLength = requirement
    }
    if (action.type === 'regex' && requirement instanceof RegExp) {
      patterns.push(requirement.source)
    }
    format = FORMATS[action.type] ?? format
  }

  return {
    ...(minLength !== undefined && { minLength }),
    ...(maxLength !== undefined && { maxLength }),
    ...(patterns.length > 0 && { patterns }),
    ...(format !== undefined && { format })
  }
}

function numberAssertions(schema: Known): Extract<Scalar, { name: 'number' }>['assertions'] {
  const assertions: {
    minimum?: { value: number; exclusive: boolean }
    maximum?: { value: number; exclusive: boolean }
    multipleOf?: number
    integer?: boolean
  } = {}

  for (const action of schema.pipe ?? []) {
    const requirement = action.requirement
    if (typeof requirement === 'number') {
      if (action.type === 'min_value') {
        assertions.minimum = { value: requirement, exclusive: false }
      }
      if (action.type === 'gt_value') {
        assertions.minimum = { value: requirement, exclusive: true }
      }
      if (action.type === 'max_value') {
        assertions.maximum = { value: requirement, exclusive: false }
      }
      if (action.type === 'lt_value') {
        assertions.maximum = { value: requirement, exclusive: true }
      }
      if (action.type === 'multiple_of') {
        assertions.multipleOf = requirement
      }
    }
    if (action.type === 'integer') {
      assertions.integer = true
    }
  }

  return assertions
}

/** A count on a list, which valibot states with the same words it states a length with. */
function listAssertions(schema: Known): { minItems?: number; maxItems?: number } {
  const assertions: { minItems?: number; maxItems?: number } = {}

  for (const action of schema.pipe ?? []) {
    const requirement = action.requirement
    if (typeof requirement !== 'number') {
      continue
    }
    if (action.type === 'min_length') {
      assertions.minItems = requirement
    }
    if (action.type === 'max_length') {
      assertions.maxItems = requirement
    }
  }

  return assertions
}

function asSchema(value: unknown): ValibotSchema {
  if (typeof value !== 'object' || value === null || !('type' in value)) {
    throw new Error('valibot stated something that is not a schema where one belongs')
  }
  return value as ValibotSchema
}

function asList(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : []
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

function asAdmittedValue(value: unknown): AdmittedValue | undefined {
  switch (typeof value) {
    case 'string':
      return { of: 'string', value }
    case 'number':
      return { of: 'number', value }
    case 'boolean':
      return { of: 'boolean', value }
    case 'bigint':
      return { of: 'bigint', value }
    default:
      return value === null ? { of: 'null' } : undefined
  }
}

function asJsonValue(value: unknown): JsonValue | undefined {
  switch (typeof value) {
    case 'string':
    case 'number':
    case 'boolean':
      return value
    case 'object':
      return value === null ? null : undefined
    default:
      return undefined
  }
}
