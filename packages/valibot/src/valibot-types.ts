import type * as v from 'valibot'

/**
 * What valibot calls its schemas, derived from what valibot exports.
 *
 * **Every one of these tables is read off the library rather than written down.** valibot publishes
 * a factory per schema and each factory returns a node carrying its own `type`, so the set of types
 * is the set of things those factories return. A type valibot adds appears here without anything
 * being edited, and a type it removes is a compile error at the assertion below.
 *
 * valibot publishes no union of its schemas and no discriminated type to switch on: `GenericSchema`
 * says `type: string`, which narrows to nothing. So the map from a name to the node it stands for is
 * what makes a field reachable by name, and it is derived for the same reason zod's is.
 */

/** What an exported factory returns. */
type Returned<K extends keyof typeof v> = (typeof v)[K] extends (...args: never[]) => infer R
  ? R
  : never

/** Every schema valibot builds, keyed by the name it carries. */
export type ValibotTypesByType = {
  [K in keyof typeof v as Returned<K> extends { readonly kind: 'schema'; readonly type: infer T }
    ? T extends string
      ? T
      : never
    : never]: Returned<K>
}

/** The name of a schema. */
export type ValibotTypeName = keyof ValibotTypesByType & string

/** One schema, selected by name. */
export type ValibotTypeOf<K extends ValibotTypeName> = ValibotTypesByType[K]

/**
 * The schemas this package reads, and the group each one reaches.
 *
 * Stated as a list rather than as everything that is left, so a type valibot adds is unread until
 * somebody decides what it means rather than falling into a default.
 */
export const ReadableValibotTypes = [
  'string',
  'number',
  'boolean',
  'bigint',
  'date',
  'null',
  'any',
  'unknown',
  'literal',
  'picklist',
  'enum',
  'optional',
  'exact_optional',
  'undefinedable',
  'nullable',
  'nullish',
  'non_optional',
  'non_nullable',
  'non_nullish',
  'object',
  'strict_object',
  'loose_object',
  'object_with_rest',
  'array',
  'tuple',
  'tuple_with_rest',
  'loose_tuple',
  'strict_tuple',
  'record',
  'union',
  'variant',
  'intersect',
  'lazy'
] as const satisfies readonly ValibotTypeName[]

export type ReadableValibotTypes = (typeof ReadableValibotTypes)[number]

/** The schemas this package turns away, and what to write instead. */
export const UnreadableValibotTypes = {
  symbol: 'a symbol is not a value JSON carries',
  function: 'a function is not a value JSON carries',
  map: 'a map is not a value JSON carries. A record of the same shape is',
  set: 'a set is not a value JSON carries. An array of unique items is',
  blob: 'a blob is sent as a body rather than as a value in one',
  file: 'a file is sent as a body rather than as a value in one',
  promise: 'a promise is not a value at all until it settles',
  never: 'this admits no value, so it describes nothing a caller could send',
  void: 'a document says a value may be absent, and has no name for the absent value itself',
  undefined: 'a document says a value may be absent, and has no name for the absent value itself',
  nan: 'a NaN is not a value JSON carries',
  instance: 'this admits instances of a class, and no document names one'
} as const satisfies Partial<Record<ValibotTypeName, string>>

/** No schema is both read and turned away. */
type Overlap = ReadableValibotTypes & keyof typeof UnreadableValibotTypes
const noOverlap: Overlap extends never ? true : false = true
void noOverlap
