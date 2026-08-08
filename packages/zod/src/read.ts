import type { AdmittedValue, JsonValue, Node, Rest, Source } from '@fasciajs/core'
import { UnreadableSchema } from '@fasciajs/core'
import type * as core from 'zod/v4/core'
import type { ZodTypesByType } from './zod-types.js'
import { isZodType, ReadableZodTypes, UnreadableZodTypes } from './zod-types.js'

/**
 * A zod schema, read as a `Node`.
 *
 * The only thing this package owes everything downstream. Nothing here knows a target, and nothing
 * here descends: a case names its children as zod schemas and the walk follows them.
 *
 * The reading states what the schema says. It does not decide what a document should do about what
 * the schema says, which is why a widening is never taken here even where a widening would be sound.
 */
export const zodSource: Source<core.$ZodType> = { read }

function read(schema: core.$ZodType): Node<core.$ZodType> | UnreadableSchema {
  // Zod's own type for this field is wider than the set of classes zod exports: it carries `int`,
  // which no exported class is keyed by. So the field is read as zod declares it and matched against
  // the tables, rather than annotated as a name this package knows.
  const name: string = schema._zod.def.type

  if (name in UnreadableZodTypes) {
    return new UnreadableSchema(schema, UnreadableZodTypes[name as keyof typeof UnreadableZodTypes])
  }

  if (!isZodType(schema, ReadableZodTypes)) {
    return new UnreadableSchema(
      schema,
      `zod calls this a ${name} and this package classifies no such type`
    )
  }

  // Type guards rather than a switch. `_zod.def.type` is two properties deep, and TypeScript
  // discriminates a union only on a property of the union itself, so a switch over it narrows
  // nothing and every case would need a cast.
  if (isZodType(schema, ['string'])) {
    return { kind: 'scalar', name: 'string', assertions: {} }
  }
  if (isZodType(schema, ['number'])) {
    return { kind: 'scalar', name: 'number', assertions: {} }
  }
  if (isZodType(schema, ['bigint'])) {
    return { kind: 'scalar', name: 'bigint', assertions: {} }
  }
  if (isZodType(schema, ['boolean'])) {
    return { kind: 'scalar', name: 'boolean', assertions: {} }
  }
  if (isZodType(schema, ['date'])) {
    return { kind: 'scalar', name: 'date', assertions: {} }
  }
  if (isZodType(schema, ['null'])) {
    return { kind: 'scalar', name: 'null', assertions: {} }
  }

  // `any` and `unknown` say the same thing about a value, which is nothing. One name downstream,
  // because a target telling them apart would state a difference no caller can act on.
  if (isZodType(schema, ['any', 'unknown'])) {
    return { kind: 'scalar', name: 'unknown', assertions: {} }
  }

  if (isZodType(schema, ['literal'])) {
    return admittedValues(schema, schema._zod.def.values)
  }
  if (isZodType(schema, ['enum'])) {
    return admittedValues(schema, Object.values(schema._zod.def.entries))
  }
  if (isZodType(schema, ['template_literal'])) {
    return templateLiteral(schema)
  }

  if (isZodType(schema, ['optional'])) {
    return { kind: 'wrapper', how: 'optional', inner: schema._zod.def.innerType }
  }
  if (isZodType(schema, ['nullable'])) {
    return { kind: 'wrapper', how: 'nullable', inner: schema._zod.def.innerType }
  }
  if (isZodType(schema, ['nonoptional'])) {
    return { kind: 'wrapper', how: 'nonoptional', inner: schema._zod.def.innerType }
  }
  if (isZodType(schema, ['readonly'])) {
    return { kind: 'wrapper', how: 'readonly', inner: schema._zod.def.innerType }
  }
  if (isZodType(schema, ['catch'])) {
    return { kind: 'wrapper', how: 'catch', inner: schema._zod.def.innerType }
  }

  // A default and a prefault both replace a missing value. What they differ about is whether the
  // replacement is parsed, which is a fact about the parse and not about what a caller may send.
  if (isZodType(schema, ['default', 'prefault'])) {
    const value = asJsonValue(schema._zod.def.defaultValue)
    return value === undefined
      ? new UnreadableSchema(schema, 'the replacement this states has no JSON form')
      : { kind: 'wrapper', how: 'default', inner: schema._zod.def.innerType, value }
  }

  if (isZodType(schema, ['object'])) {
    const properties = new Map(Object.entries(schema._zod.def.shape))
    return { kind: 'structural', of: 'object', properties, rest: restOf(schema._zod.def.catchall) }
  }
  if (isZodType(schema, ['array'])) {
    return { kind: 'structural', of: 'list', items: schema._zod.def.element, assertions: {} }
  }
  if (isZodType(schema, ['tuple'])) {
    return {
      kind: 'structural',
      of: 'tuple',
      positions: schema._zod.def.items,
      rest: restOf(schema._zod.def.rest ?? undefined)
    }
  }
  if (isZodType(schema, ['record'])) {
    return {
      kind: 'structural',
      of: 'dictionary',
      keys: schema._zod.def.keyType,
      values: schema._zod.def.valueType
    }
  }

  if (isZodType(schema, ['union'])) {
    return union(schema)
  }
  if (isZodType(schema, ['intersection'])) {
    return {
      kind: 'combination',
      law: 'all',
      members: [schema._zod.def.left, schema._zod.def.right],
      discriminant: undefined
    }
  }

  if (isZodType(schema, ['pipe'])) {
    return pipe(schema)
  }

  // A transform met on its own converts a value nothing has described, so neither side is stated.
  // Reached through a pipe it is a side, and the pipe reads it there.
  if (isZodType(schema, ['transform'])) {
    return new UnreadableSchema(
      schema,
      'a transform on its own states no schema on either side of itself'
    )
  }

  if (isZodType(schema, ['lazy'])) {
    return { kind: 'deferred', resolve: () => schema._zod.def.getter() }
  }

  schema satisfies never
  return new UnreadableSchema(
    schema,
    'this package classified the type and then read no case for it'
  )
}

/** What an object or a tuple accepts beyond the children it names. */
function restOf(catchall: core.$ZodType | undefined): Rest<core.$ZodType> {
  if (catchall === undefined) {
    // zod removes an unnamed key rather than refusing the value, so the schema accepts one.
    return { allows: 'anything' }
  }

  // `z.strictObject` states its refusal as a catchall admitting no value, which is a refusal rather
  // than a schema to describe.
  return catchall._zod.def.type === 'never'
    ? { allows: 'nothing' }
    : { allows: 'schema', schema: catchall }
}

/** A fixed set of values, with the type of each value kept beside it. */
function admittedValues(
  schema: core.$ZodType,
  values: readonly unknown[]
): Node<core.$ZodType> | UnreadableSchema {
  const admitted: AdmittedValue[] = []

  for (const value of values) {
    const one = asAdmittedValue(value)
    if (one === undefined) {
      return new UnreadableSchema(
        schema,
        `this admits a ${typeof value}, which is not a value JSON carries`
      )
    }
    admitted.push(one)
  }

  const [first, ...rest] = admitted
  return first === undefined
    ? new UnreadableSchema(
        schema,
        'this admits no value, so it describes nothing a caller could send'
      )
    : { kind: 'values', admitted: [first, ...rest] }
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

/**
 * A template literal, as the pattern it states.
 *
 * Only where every part is a literal. A part that is a schema states a pattern of its own, and
 * deriving one means answering for every type a part may be. Reading the schema as a plain string
 * instead would be wider and sound, and it would drop a constraint the caller wrote without saying
 * so, which is what a reading may not do.
 */
function templateLiteral(schema: ZodTemplateLiteral): Node<core.$ZodType> | UnreadableSchema {
  const parts: string[] = []

  for (const part of schema._zod.def.parts) {
    if (typeof part === 'object' && part !== null) {
      return new UnreadableSchema(
        schema,
        'a part of this template is a schema, and this package derives no pattern from one'
      )
    }
    parts.push(escapeForPattern(String(part)))
  }

  return { kind: 'scalar', name: 'string', assertions: { patterns: [`^${parts.join('')}$`] } }
}

function escapeForPattern(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Which of the three things a union is.
 *
 * zod gives all three one discriminant, so telling them apart means reading two further fields, and
 * a discriminated union is flagged exclusive as well and has to be ruled out first. Asked once here,
 * so no caller re-derives it.
 */
function union(schema: ZodUnion): Node<core.$ZodType> {
  const def = schema._zod.def
  const members = def.options

  const [first, second, ...rest] = members
  if (first === undefined || second === undefined) {
    // A union of one is its member, and zod builds one. Read as a combination it would state a law
    // over nothing.
    return {
      kind: 'combination',
      law: 'any',
      members: [first ?? schema, second ?? schema],
      discriminant: undefined
    }
  }

  const discriminant = 'discriminator' in def ? def.discriminator : undefined

  return {
    kind: 'combination',
    // A discriminated union's members exclude one another by construction, and `z.xor` says so with
    // a flag. Both are one law, and a plain union is the other.
    law: discriminant !== undefined || def.inclusive === false ? 'exactlyOne' : 'any',
    members: [first, second, ...rest],
    discriminant
  }
}

/**
 * A pipe, as what it states about each side.
 *
 * A codec is told apart by `reverseTransform`, which only a codec carries. Both of a codec's sides
 * are ordinary schemas, so a test that looked only at the sides would read a codec as one value
 * described twice and merge a wire form with an in-memory type.
 */
function pipe(schema: ZodPipe): Node<core.$ZodType> | UnreadableSchema {
  const def = schema._zod.def
  const sent = def.in
  const produced = def.out

  if ('reverseTransform' in def) {
    return { kind: 'conversion', how: 'codec', wire: sent, value: produced }
  }

  const sentTransforms = sent._zod.def.type === 'transform'
  const producedTransforms = produced._zod.def.type === 'transform'

  if (sentTransforms && producedTransforms) {
    return new UnreadableSchema(
      schema,
      'both sides of this pipe convert, so neither side states a schema'
    )
  }
  if (sentTransforms) {
    return { kind: 'conversion', how: 'unstatedInput', produced }
  }
  if (producedTransforms) {
    return { kind: 'conversion', how: 'unstatedOutput', sent }
  }

  // Nothing between the sides converts, so both sides describe one value and a reader may take
  // either. Whether they agree is a question about the two schemas rather than about the pipe.
  return { kind: 'conversion', how: 'checks', sent, produced }
}

function asJsonValue(value: unknown): JsonValue | undefined {
  switch (typeof value) {
    case 'string':
    case 'number':
    case 'boolean':
      return value
    case 'object': {
      if (value === null) {
        return null
      }
      if (Array.isArray(value)) {
        const items: JsonValue[] = []
        for (const item of value) {
          const one = asJsonValue(item)
          if (one === undefined) {
            return undefined
          }
          items.push(one)
        }
        return items
      }
      if (Object.getPrototypeOf(value) !== Object.prototype) {
        // A Date, a Map, a class instance. `JSON.stringify` writes something for each, and what it
        // writes is a guess about a contract nobody stated.
        return undefined
      }
      const entries: Record<string, JsonValue> = {}
      for (const [key, item] of Object.entries(value)) {
        const one = asJsonValue(item)
        if (one === undefined) {
          return undefined
        }
        entries[key] = one
      }
      return entries
    }
    default:
      return undefined
  }
}

type ZodTemplateLiteral = ZodTypesByType['template_literal']
type ZodPipe = ZodTypesByType['pipe']

/**
 * A union, and the two fields that say which of the three kinds it is.
 *
 * zod declares neither on `$ZodUnion` itself: a discriminated union and `z.xor` are subclasses that
 * add them, and both answer `union` to the discriminant this package dispatches on. So the fields
 * are stated here as optional rather than read off a class that does not declare them.
 */
type ZodUnion = ZodTypesByType['union'] & {
  readonly _zod: { readonly def: { readonly discriminator?: string; readonly inclusive?: boolean } }
}
