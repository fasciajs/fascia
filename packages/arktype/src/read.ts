import type { BaseRoot, nodeOfKind, RootKind } from '@ark/schema'
import type {
  AdmittedValue,
  Bound,
  JsonValue,
  Node,
  ObjectProperty,
  Scalar,
  Source
} from '@fasciajs/core'
import { UnreadableSchema } from '@fasciajs/core'

/**
 * An arktype schema, read as a `Node`.
 *
 * A `Type` is one of arktype's nodes and every child of one is another, which is what makes a
 * reading possible at one level.
 *
 * **Read through arktype's own machinery rather than through the shape of its output.** `hasKind`
 * narrows to the node type for a kind, so a field is reached by name and a field arktype moves is a
 * compile error. A first version of this file typed a node as an index signature and parsed each
 * field from `unknown`, which compiled perfectly while reading every child as absent.
 *
 * `isNever`, `isUnknown` and `hasUnit` are arktype's answers to three questions this file used to
 * ask by hand, and each was a comparison against a shape rather than against a meaning.
 *
 * The differences from a zod reading are why this package exists. arktype states optionality and a
 * default on an object's edge, holds no boolean domain, writes `never` as a union of no branches,
 * and writes an object, a record, an array and a tuple through one structure node.
 */
export const arktypeSource: Source<BaseRoot> = { read }

function read(schema: BaseRoot): Node<BaseRoot> | UnreadableSchema {
  // A schema admitting no value, however arktype arrived at one. Asked before the dispatch, because
  // arktype reduces several schemas to the same empty union and the kind alone does not say so.
  if (schema.isNever()) {
    return new UnreadableSchema(
      schema,
      'this admits no value, so it describes nothing a caller could send'
    )
  }

  // Nothing is asserted about the value at all, which arktype writes as an empty intersection.
  if (schema.isUnknown()) {
    return { kind: 'scalar', name: 'unknown', assertions: {} }
  }

  const kind: RootKind = schema.kind

  switch (kind) {
    case 'domain':
      return domain(schema)
    case 'unit':
      return unit(schema)
    case 'union':
      return union(schema)
    case 'proto':
      return proto(schema)
    case 'intersection':
      return intersection(schema)
    case 'morph':
      return morph(schema)
    case 'alias':
      return alias(schema)
    default:
      // Held to arktype's own list of roots. A root arktype adds is a compile error naming the root.
      kind satisfies never
      throw new Error(`arktype states a root this package reads no case for: ${String(kind)}`)
  }
}

/**
 * A schema whose kind the dispatch already decided, narrowed to the node type for that kind.
 *
 * The narrowing is what gives a field a name and a type. The `false` branch is unreachable, and it
 * returns rather than throws so that a wrong dispatch is a reading that says so rather than a crash.
 */
function notOfKind(schema: BaseRoot, kind: RootKind): UnreadableSchema {
  return new UnreadableSchema(
    schema,
    `this states it is a ${schema.kind} and was read as a ${kind}`
  )
}

const SCALAR_DOMAINS: Partial<Record<string, Scalar['name']>> = {
  string: 'string',
  number: 'number',
  bigint: 'bigint'
}

/** A bare domain, with nothing asserted about it. */
function domain(schema: BaseRoot): Node<BaseRoot> | UnreadableSchema {
  if (!schema.hasKind('domain')) {
    return notOfKind(schema, 'domain')
  }

  const name = SCALAR_DOMAINS[schema.domain]

  return name === undefined
    ? new UnreadableSchema(schema, `a ${schema.domain} is not a value a document carries`)
    : { kind: 'scalar', name, assertions: {} }
}

/** One admitted value. arktype writes a literal, and `null`, this way. */
function unit(schema: BaseRoot): Node<BaseRoot> | UnreadableSchema {
  if (!schema.hasKind('unit')) {
    return notOfKind(schema, 'unit')
  }

  const value = asAdmittedValue(schema.unit)

  return value === undefined
    ? new UnreadableSchema(schema, 'this admits one value, and the value is not one JSON carries')
    : { kind: 'values', admitted: [value] }
}

/**
 * A disjunction, and the one shape arktype writes this way that is not one.
 *
 * `boolean` is the two unit types, arktype holding no boolean domain. `hasUnit` is arktype's own
 * answer to what a branch admits, and it replaced a comparison against the shape of the branch.
 */
function union(schema: BaseRoot): Node<BaseRoot> | UnreadableSchema {
  if (!schema.hasKind('union')) {
    return notOfKind(schema, 'union')
  }

  const branches: readonly BaseRoot[] = schema.branches

  if (isBoolean(branches)) {
    return { kind: 'scalar', name: 'boolean', assertions: {} }
  }

  const [first, second, ...rest] = branches
  if (first === undefined || second === undefined) {
    return new UnreadableSchema(
      schema,
      'a union of one member is the member, and this package cannot say so at one node'
    )
  }

  return {
    kind: 'combination',
    law: 'any',
    members: [first, second, ...rest],
    discriminant: undefined
  }
}

function isBoolean(branches: readonly BaseRoot[]): boolean {
  return (
    branches.length === 2 &&
    branches.some((branch) => branch.hasUnit(true)) &&
    branches.some((branch) => branch.hasUnit(false))
  )
}

/** A prototype. A Date is a value with a wire form, and the rest are not. */
function proto(schema: BaseRoot): Node<BaseRoot> | UnreadableSchema {
  if (!schema.hasKind('proto')) {
    return notOfKind(schema, 'proto')
  }

  return schema.builtinName === 'Date'
    ? { kind: 'scalar', name: 'date', assertions: {} }
    : new UnreadableSchema(schema, `a ${schema.proto.name} is not a value a document carries`)
}

/** A recursive type names itself and resolves on demand, which is a thunk. */
function alias(schema: BaseRoot): Node<BaseRoot> | UnreadableSchema {
  return schema.hasKind('alias')
    ? { kind: 'deferred', resolve: () => schema.resolution }
    : notOfKind(schema, 'alias')
}

/** A morph converts one way, so what a caller sends is stated and what comes out is a function. */
function morph(schema: BaseRoot): Node<BaseRoot> | UnreadableSchema {
  if (!schema.hasKind('morph')) {
    return notOfKind(schema, 'morph')
  }

  // `in` on the node itself is declared `unknown`, with a note to reach the raw one instead. The
  // inner holds the typed node, and arktype declares it optional, so an absent one is a morph that
  // states nothing about what it converts.
  const sent = schema.inner.in

  return sent === undefined
    ? new UnreadableSchema(
        schema,
        'this converts a value and states no schema for what it converts'
      )
    : { kind: 'conversion', how: 'unstatedOutput', sent }
}

/** A basis with constraints beside it, which is most of what arktype builds. */
function intersection(schema: BaseRoot): Node<BaseRoot> | UnreadableSchema {
  if (!schema.hasKind('intersection')) {
    return notOfKind(schema, 'intersection')
  }

  const structure = schema.structure
  if (structure !== undefined) {
    return structured(schema, structure)
  }

  const inner = schema.inner
  const basis = inner.domain ?? inner.proto

  if (basis?.hasKind('domain')) {
    if (basis.domain === 'string') {
      return { kind: 'scalar', name: 'string', assertions: stringAssertions(schema) }
    }
    if (basis.domain === 'number') {
      return { kind: 'scalar', name: 'number', assertions: numberAssertions(schema) }
    }
    if (basis.domain === 'bigint') {
      return { kind: 'scalar', name: 'bigint', assertions: {} }
    }
  }

  if (basis?.hasKind('proto') && basis.builtinName === 'Date') {
    return { kind: 'scalar', name: 'date', assertions: dateAssertions(schema) }
  }

  return new UnreadableSchema(
    schema,
    `this states ${Object.keys(inner).join(', ')} and this package reads no shape from that`
  )
}

/** An object, a record, an array or a tuple. arktype writes all four through one structure node. */
function structured(
  schema: nodeOfKind<'intersection'>,
  structure: nodeOfKind<'structure'>
): Node<BaseRoot> | UnreadableSchema {
  const sequence = structure.sequence

  if (sequence !== undefined) {
    const positions: readonly BaseRoot[] = sequence.prefix ?? []
    const items = sequence.variadic

    if (positions.length > 0) {
      return {
        kind: 'structural',
        of: 'tuple',
        positions,
        rest: items === undefined ? { allows: 'nothing' } : { allows: 'schema', schema: items }
      }
    }

    if (items !== undefined) {
      const minItems = schema.inner.minLength?.rule
      const maxItems = schema.inner.maxLength?.rule ?? schema.inner.exactLength?.rule

      return {
        kind: 'structural',
        of: 'list',
        items,
        assertions: {
          ...(minItems !== undefined && { minItems }),
          ...(maxItems !== undefined && { maxItems })
        }
      }
    }
  }

  const named = [...(structure.required ?? []), ...(structure.optional ?? [])]
  const index = structure.index ?? []

  // An index signature and named properties at once is one arktype shape that this sum holds as
  // two. Refused rather than read as either, because dropping the named keys and dropping the key
  // schema are both losses nobody asked for.
  if (named.length > 0 && index.length > 0) {
    return new UnreadableSchema(
      schema,
      'this states named properties and an index signature at once, and this package reads one or the other'
    )
  }

  const [only] = index
  if (named.length === 0 && index.length === 1 && only !== undefined) {
    return { kind: 'structural', of: 'dictionary', keys: only.signature, values: only.value }
  }

  const properties = new Map<string, ObjectProperty<BaseRoot>>()
  for (const property of named) {
    const key = property.key
    if (typeof key !== 'string') {
      // A symbol key. A document names its keys with strings, so there is nothing to write.
      return new UnreadableSchema(schema, 'a property of this object is named by a symbol')
    }

    properties.set(key, {
      schema: property.value,
      // arktype states this on the edge, which is where the sum states it too.
      required: property.hasKind('required'),
      default: property.hasKind('optional') ? asJsonValue(property.default) : undefined
    })
  }

  return { kind: 'structural', of: 'object', properties, rest: { allows: 'anything' } }
}

function stringAssertions(
  schema: nodeOfKind<'intersection'>
): Extract<Scalar, { name: 'string' }>['assertions'] {
  const inner = schema.inner
  const exact = inner.exactLength?.rule
  const minLength = inner.minLength?.rule ?? exact
  const maxLength = inner.maxLength?.rule ?? exact
  const patterns = (inner.pattern ?? []).map((one) => one.rule)

  return {
    ...(minLength !== undefined && { minLength }),
    ...(maxLength !== undefined && { maxLength }),
    ...(patterns.length > 0 && { patterns })
  }
}

function numberAssertions(
  schema: nodeOfKind<'intersection'>
): Extract<Scalar, { name: 'number' }>['assertions'] {
  const inner = schema.inner
  const minimum = boundOf(inner.min)
  const maximum = boundOf(inner.max)
  const multipleOf = inner.divisor?.rule

  return {
    ...(minimum !== undefined && { minimum }),
    ...(maximum !== undefined && { maximum }),
    ...(multipleOf !== undefined && { multipleOf })
  }
}

function boundOf(
  constraint: { rule: number; exclusive?: boolean } | undefined
): Bound<number> | undefined {
  return constraint === undefined
    ? undefined
    : { value: constraint.rule, exclusive: constraint.exclusive === true }
}

/**
 * A Date bound, which arktype states as `after` and `before` rather than as `min` and `max`.
 *
 * arktype holds no exclusive Date bound: `Date > x` is normalised to `Date >= x plus one
 * millisecond` and `exclusive` is never set. The shifted bound is what the schema accepts, so it is
 * what the reading states.
 */
function dateAssertions(
  schema: nodeOfKind<'intersection'>
): Extract<Scalar, { name: 'date' }>['assertions'] {
  const inner = schema.inner
  const minimum = dateBoundOf(inner.after?.rule)
  const maximum = dateBoundOf(inner.before?.rule)

  return {
    ...(minimum !== undefined && { minimum }),
    ...(maximum !== undefined && { maximum })
  }
}

function dateBoundOf(rule: Date | number | undefined): Bound<Date> | undefined {
  const at = rule instanceof Date ? rule : typeof rule === 'number' ? new Date(rule) : undefined
  return at === undefined ? undefined : { value: at, exclusive: false }
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
