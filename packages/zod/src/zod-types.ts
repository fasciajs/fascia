import type * as core from 'zod/v4/core'

/**
 * The type system of the input side.
 *
 * Every question this package asks about a zod schema is keyed on `_zod.def.type`, so that
 * discriminant is what the tables below are indexed by, and the classes are recovered from zod's own
 * exports rather than listed here.
 *
 * Derived from the exports and not from `core.$ZodTypes`, which zod also declares. That union is
 * maintained by hand and is already curated: it names 39 classes while zod exports `$ZodXor`,
 * `$ZodDiscriminatedUnion`, `$ZodCodec`, `$ZodPreprocess` and `$ZodExactOptional` besides. Those
 * five share a parent's discriminant, so the union is not wrong today. It is a list someone has to
 * remember to add to, and a type zod forgets there is a type this package would never classify.
 * An export is complete by construction, because a type has to be exported to be used.
 */

/**
 * Every exported class whose instance is a schema, keyed by the name of the export.
 *
 * `$ZodType` itself is dropped. It is the base every schema is an instance of, so leaving it in
 * would make one entry that matches every schema and answers about none.
 */
type ZodClasses = {
  [K in keyof typeof core as (typeof core)[K] extends core.$constructor<infer Instance>
    ? Instance extends core.$ZodType
      ? K extends '$ZodType'
        ? never
        : K
      : never
    : never]: (typeof core)[K] extends core.$constructor<infer Instance> ? Instance : never
}

/**
 * The same classes, keyed by the discriminant a reading dispatches on.
 *
 * Several classes share one discriminant, because zod subclasses rather than adding a name:
 * a discriminated union and an exclusive union are both `union`, and a codec and a preprocessor are
 * both `pipe`. The key collapses them, which is correct here, and telling them apart is a question
 * about the def that {@link ZodTypesByType} deliberately does not answer.
 */
export type ZodTypesByType = {
  [K in keyof ZodClasses as ZodClasses[K]['_zod']['def']['type']]: ZodClasses[K]
}

/** The name of a zod type. */
export type ZodTypeName = keyof ZodTypesByType

/**
 * The types this package reads, and the types it turns away.
 *
 * Two lists rather than one, because a type in neither is the case that matters. Nothing else
 * reports a zod type nobody decided about: it would fail no check, and a reading would meet the type
 * at runtime and have no case for it.
 */
export const ReadableZodTypes = [
  'string',
  'number',
  'bigint',
  'boolean',
  'date',
  'null',
  'any',
  'unknown',
  'literal',
  'enum',
  'template_literal',
  'optional',
  'nullable',
  'nonoptional',
  'default',
  'prefault',
  'catch',
  'readonly',
  'object',
  'array',
  'tuple',
  'record',
  'union',
  'intersection',
  'pipe',
  'transform',
  'lazy'
  // Constrained, so a name zod does not have is an error here. Without it, a misspelling sits in
  // the list, `Exclude` below still reports nothing unclassified, and the real type goes unread.
] as const satisfies readonly ZodTypeName[]

export type ReadableZodTypes = (typeof ReadableZodTypes)[number]

/**
 * The types this package has no reading for, each with the reason.
 *
 * A reason rather than a bare list, because the two ways of being unreadable are different and a
 * caller acts on which one it is. A value no document carries is a fact about the wire. A schema
 * describing no value at all is a fact about the schema.
 */
export const UnreadableZodTypes = {
  symbol: 'a symbol is not a value JSON carries',
  undefined: 'a document says a value may be absent, and has no name for the absent value itself',
  void: 'a document says a value may be absent, and has no name for the absent value itself',
  never: 'a schema admitting no value describes nothing a caller could send',
  nan: 'JSON has no name for a number that is not a number',
  map: 'a map is not a value JSON carries. A record of the same shape is',
  set: 'a set is not a value JSON carries. An array of unique items is',
  file: 'a file is sent as a body rather than as a value in one',
  promise: 'a promise is a fact about when a value arrives, not about the value',
  function: 'a function is not a value that can be sent or received',
  success: 'the result of a parse is not the value that was parsed',
  custom: 'a predicate this package cannot read admits values it cannot state'
} as const satisfies Partial<Record<ZodTypeName, string>>

export type UnreadableZodTypes = keyof typeof UnreadableZodTypes

/**
 * Every zod type is in one list or the other.
 *
 * The assertion is the point of both lists. A zod release adding a type is a compile error naming
 * the type, rather than a reading that meets the type at runtime and has no case for it.
 */
type UnclassifiedZodTypes = Exclude<ZodTypeName, ReadableZodTypes | UnreadableZodTypes>

const _everyZodTypeIsClassified: [UnclassifiedZodTypes] extends [never]
  ? true
  : { 'zod exports a type that is neither readable nor unreadable': UnclassifiedZodTypes } = true
void _everyZodTypeIsClassified

/**
 * Neither list names a type twice.
 *
 * A name in both would make the reading's behaviour depend on which list is consulted first, and
 * `Exclude` above hides the overlap: a type in both is in the union and so passes the assertion.
 */
type ZodTypesInBothLists = Extract<ReadableZodTypes, UnreadableZodTypes>

const _noZodTypeIsInBothLists: [ZodTypesInBothLists] extends [never]
  ? true
  : { 'a zod type is both readable and unreadable': ZodTypesInBothLists } = true
void _noZodTypeIsInBothLists

/**
 * Whether this schema is one of these zod types, narrowing to the classes behind the names.
 *
 * The discriminant is read from the def, which is where zod keeps it, so the narrowing and the
 * runtime answer come from one field rather than from a guess about a class.
 */
export function isZodType<Name extends ZodTypeName>(
  schema: core.$ZodType,
  names: readonly Name[]
): schema is ZodTypesByType[Name] {
  return names.some((name) => schema._zod.def.type === name)
}

/**
 * Whether this is a zod schema at all.
 *
 * Asks for the discriminant rather than for `_zod`, because every question here is keyed on the
 * discriminant. An object carrying a `_zod` property answers yes to the weaker test and then
 * matches no case.
 */
export function isZodSchema(value: unknown): value is core.$ZodType {
  return (
    typeof value === 'object' &&
    value !== null &&
    '_zod' in value &&
    typeof (value as core.$ZodType)._zod?.def?.type === 'string'
  )
}
