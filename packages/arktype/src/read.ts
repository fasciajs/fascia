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
import { isReadArkRoot } from './ark-kinds.js'

/**
 * An arktype schema, read as a `Node`.
 *
 * **This reads arktype's internal nodes and not a published surface.** A `Type` is one of those
 * nodes and every child of one is another, which is what makes a reading possible at one level. It
 * also means a minor release can move what this reads.
 *
 * The differences from a zod reading are why this package exists. arktype states optionality and a
 * default on an object's edge, holds no boolean domain, writes `never` as a union of no branches,
 * and writes an object, a record, an array and a tuple through one structure node.
 */

/**
 * What this package reads an arktype schema as.
 *
 * Declared here rather than imported, because arktype publishes `Type` and keeps its node types
 * private. Every field is read one at a time and parsed, the way any other boundary is parsed.
 *
 * An index signature, because arktype keeps a field where it suits the node: a constraint holds
 * `rule` on itself, a property holds `key` and `value` on itself, and a container holds its children
 * under `inner`. Naming each one here would be a second copy of arktype's own shape.
 */
export interface ArkNode {
  readonly kind: string
  readonly [field: string]: unknown
}

export const arktypeSource: Source<ArkNode> = { read }

/**
 * A node is callable, so a test for one accepts a function as readily as an object.
 *
 * Found by every child reading as absent. A first version asked for an object, and arktype builds
 * each node as a function carrying properties.
 */
function isArkNode(value: unknown): value is ArkNode {
  return (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    typeof (value as ArkNode)['kind'] === 'string'
  )
}

const NOTHING: ArkNode = { kind: 'nothing' }

/** The children of a node, which arktype keeps under `inner`. */
function childrenOf(node: ArkNode): ArkNode {
  const inner = node['inner']
  return typeof inner === 'object' && inner !== null ? (inner as ArkNode) : NOTHING
}

function nodeAt(holder: ArkNode, key: string): ArkNode | undefined {
  const value = holder[key]
  return isArkNode(value) ? value : undefined
}

function nodesAt(holder: ArkNode, key: string): readonly ArkNode[] {
  const value = holder[key]
  return Array.isArray(value) ? value.filter(isArkNode) : []
}

/** A constraint states its value as `rule`, on the node itself rather than under `inner`. */
function numberRuleOf(constraint: ArkNode | undefined): number | undefined {
  const rule = constraint?.['rule']
  return typeof rule === 'number' ? rule : undefined
}

/**
 * The domain a node names.
 *
 * Two levels, because a bare domain node holds the name under its own children and a domain reached
 * inside an intersection is a node holding it under theirs.
 */
function domainNameOf(node: ArkNode): string | undefined {
  const named = childrenOf(node)['domain']
  if (typeof named === 'string') {
    return named
  }
  if (isArkNode(named)) {
    const nested = childrenOf(named)['domain']
    return typeof nested === 'string' ? nested : undefined
  }
  return undefined
}

/** The prototype a node names, which arktype states as the constructor itself. */
function protoNameOf(node: ArkNode): string | undefined {
  const named = childrenOf(node)['proto']
  if (typeof named === 'string') {
    return named
  }
  if (isArkNode(named)) {
    return protoNameOf(named)
  }
  return typeof named === 'function' ? named.name : undefined
}

function read(schema: ArkNode): Node<ArkNode> | UnreadableSchema {
  const kind = schema.kind

  // Narrowed against arktype's own list of roots, so the dispatch below can be total. A kind
  // arktype adds is a compile error at the `satisfies never`, naming the kind.
  if (!isReadArkRoot(kind)) {
    return new UnreadableSchema(
      schema,
      `arktype calls this a ${kind} and this package reads no such node`
    )
  }

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
      // A recursive type names itself and resolves on demand, which is a thunk.
      return { kind: 'deferred', resolve: () => resolvedAlias(schema) }
    default:
      kind satisfies never
      throw new Error(
        `a root arktype states and this package classified reached no case: ${String(kind)}`
      )
  }
}

function resolvedAlias(schema: ArkNode): ArkNode {
  const held = nodeAt(childrenOf(schema), 'resolution') ?? nodeAt(schema, 'resolution')
  return held ?? schema
}

const SCALAR_DOMAINS: Partial<Record<string, Scalar['name']>> = {
  string: 'string',
  number: 'number',
  bigint: 'bigint'
}

/** A bare domain, with nothing asserted about it. */
function domain(schema: ArkNode): Node<ArkNode> | UnreadableSchema {
  const named = domainNameOf(schema)
  const name = named === undefined ? undefined : SCALAR_DOMAINS[named]

  return name === undefined
    ? new UnreadableSchema(schema, `a ${String(named)} is not a value a document carries`)
    : { kind: 'scalar', name, assertions: {} }
}

/** One admitted value. arktype writes a literal, and `null`, this way. */
function unit(schema: ArkNode): Node<ArkNode> | UnreadableSchema {
  const value = asAdmittedValue(childrenOf(schema)['unit'])
  return value === undefined
    ? new UnreadableSchema(schema, 'this admits one value, and the value is not one JSON carries')
    : { kind: 'values', admitted: [value] }
}

/**
 * A union, and the two shapes arktype writes this way that are not disjunctions.
 *
 * No branches is a schema admitting no value. Exactly the two boolean units is a boolean, which
 * arktype holds no domain for. Reading the second as a disjunction of two constants would accept
 * the same values and say so in a way no reader of a document would recognise.
 */
function union(schema: ArkNode): Node<ArkNode> | UnreadableSchema {
  const branches = nodesAt(childrenOf(schema), 'branches')

  if (branches.length === 0) {
    return new UnreadableSchema(
      schema,
      'this admits no value, so it describes nothing a caller could send'
    )
  }

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

function isBoolean(branches: readonly ArkNode[]): boolean {
  if (branches.length !== 2) {
    return false
  }
  const units = branches.map((branch) =>
    branch.kind === 'unit' ? childrenOf(branch)['unit'] : undefined
  )
  return units.includes(true) && units.includes(false)
}

/** A prototype. A Date is a value with a wire form, and the rest are not. */
function proto(schema: ArkNode): Node<ArkNode> | UnreadableSchema {
  const name = protoNameOf(schema)

  return name === 'Date'
    ? { kind: 'scalar', name: 'date', assertions: {} }
    : new UnreadableSchema(schema, `a ${String(name)} is not a value a document carries`)
}

/**
 * A domain or a prototype with constraints beside it, which is most of what arktype builds.
 *
 * An intersection with no children is `unknown`: nothing is asserted about the value at all.
 */
function intersection(schema: ArkNode): Node<ArkNode> | UnreadableSchema {
  const children = childrenOf(schema)
  const structure = nodeAt(children, 'structure')

  if (structure !== undefined) {
    return structured(schema, children, structure)
  }

  const domainName = domainNameOf(schema)

  if (domainName === 'string') {
    return { kind: 'scalar', name: 'string', assertions: stringAssertions(children) }
  }
  if (domainName === 'number') {
    return { kind: 'scalar', name: 'number', assertions: numberAssertions(children) }
  }
  if (domainName === 'bigint') {
    return { kind: 'scalar', name: 'bigint', assertions: {} }
  }
  if (children['proto'] !== undefined) {
    // A Date carries its bounds as `after` and `before` rather than as `min` and `max`, which is
    // what the constraint list reported when it was first written against arktype's own.
    const assertions = dateAssertions(children)
    return protoNameOf(schema) === 'Date'
      ? { kind: 'scalar', name: 'date', assertions }
      : proto(schema)
  }
  if (Object.keys(children).length === 0) {
    return { kind: 'scalar', name: 'unknown', assertions: {} }
  }

  return new UnreadableSchema(
    schema,
    `this states ${Object.keys(children).join(', ')} and this package reads no shape from that`
  )
}

/** An object, a record, an array or a tuple. arktype writes all four through one structure node. */
function structured(
  schema: ArkNode,
  children: ArkNode,
  structure: ArkNode
): Node<ArkNode> | UnreadableSchema {
  const sequence = nodeAt(childrenOf(structure), 'sequence')

  if (sequence !== undefined) {
    const positions = nodesAt(childrenOf(sequence), 'prefix')
    const items = nodeAt(childrenOf(sequence), 'variadic')

    if (positions.length > 0) {
      return {
        kind: 'structural',
        of: 'tuple',
        positions,
        rest: items === undefined ? { allows: 'nothing' } : { allows: 'schema', schema: items }
      }
    }

    if (items !== undefined) {
      const minItems = numberRuleOf(nodeAt(children, 'minLength'))
      const maxItems =
        numberRuleOf(nodeAt(children, 'maxLength')) ?? numberRuleOf(nodeAt(children, 'exactLength'))

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

  const structureChildren = childrenOf(structure)
  const named = [
    ...nodesAt(structureChildren, 'required'),
    ...nodesAt(structureChildren, 'optional')
  ]
  const index = nodesAt(structureChildren, 'index')

  // An index signature and named properties at once is one arktype shape that this sum holds as
  // two. Refused rather than read as either, because dropping the named keys and dropping the key
  // schema are both losses nobody asked for.
  if (named.length > 0 && index.length > 0) {
    return new UnreadableSchema(
      schema,
      'this states named properties and an index signature at once, and this package reads one or the other'
    )
  }

  if (named.length === 0 && index.length === 1) {
    const [only] = index
    const keys = only === undefined ? undefined : nodeAt(only, 'signature')
    const values = only === undefined ? undefined : nodeAt(only, 'value')

    return keys === undefined || values === undefined
      ? new UnreadableSchema(schema, 'this states an index signature with no key or no value')
      : { kind: 'structural', of: 'dictionary', keys, values }
  }

  const properties = new Map<string, ObjectProperty<ArkNode>>()
  for (const property of named) {
    const key = property['key']
    const value = nodeAt(property, 'value')

    if (typeof key !== 'string' || value === undefined) {
      return new UnreadableSchema(
        schema,
        'a property of this object states no name, or no schema at the name'
      )
    }

    properties.set(key, {
      schema: value,
      // arktype states this on the edge, which is where the sum states it too.
      required: property.kind === 'required',
      default: asJsonValue(property['default'])
    })
  }

  return { kind: 'structural', of: 'object', properties, rest: { allows: 'anything' } }
}

/** A morph converts one way, so what a caller sends is stated and what comes out is a function. */
function morph(schema: ArkNode): Node<ArkNode> | UnreadableSchema {
  const sent = nodeAt(childrenOf(schema), 'in')
  return sent === undefined
    ? new UnreadableSchema(
        schema,
        'this converts a value and states no schema for what it converts'
      )
    : { kind: 'conversion', how: 'unstatedOutput', sent }
}

function stringAssertions(children: ArkNode): Extract<Scalar, { name: 'string' }>['assertions'] {
  const exact = numberRuleOf(nodeAt(children, 'exactLength'))
  const minLength = numberRuleOf(nodeAt(children, 'minLength')) ?? exact
  const maxLength = numberRuleOf(nodeAt(children, 'maxLength')) ?? exact
  const patterns = nodesAt(children, 'pattern')
    .map((one) => one['rule'])
    .filter((one): one is string => typeof one === 'string')

  return {
    ...(minLength !== undefined && { minLength }),
    ...(maxLength !== undefined && { maxLength }),
    ...(patterns.length > 0 && { patterns })
  }
}

function numberAssertions(children: ArkNode): Extract<Scalar, { name: 'number' }>['assertions'] {
  const minimum = boundOf(nodeAt(children, 'min'))
  const maximum = boundOf(nodeAt(children, 'max'))
  const multipleOf = numberRuleOf(nodeAt(children, 'divisor'))

  return {
    ...(minimum !== undefined && { minimum }),
    ...(maximum !== undefined && { maximum }),
    ...(multipleOf !== undefined && { multipleOf })
  }
}

function dateAssertions(children: ArkNode): Extract<Scalar, { name: 'date' }>['assertions'] {
  const minimum = dateBoundOf(nodeAt(children, 'after'))
  const maximum = dateBoundOf(nodeAt(children, 'before'))

  return {
    ...(minimum !== undefined && { minimum }),
    ...(maximum !== undefined && { maximum })
  }
}

/**
 * A Date bound, which arktype states as `after` and `before` rather than as `min` and `max`.
 *
 * The constraint classification is what reported these. Both were absent from the reading, and a
 * caller stating one reached no assertion while every test passed, because no test knew to ask.
 */
function dateBoundOf(constraint: ArkNode | undefined): Bound<Date> | undefined {
  const rule = constraint?.['rule']
  const at = rule instanceof Date ? rule : typeof rule === 'number' ? new Date(rule) : undefined

  return at === undefined ? undefined : { value: at, exclusive: constraint?.['exclusive'] === true }
}

function boundOf(
  constraint: ArkNode | undefined
): { value: number; exclusive: boolean } | undefined {
  const value = numberRuleOf(constraint)
  return value === undefined ? undefined : { value, exclusive: constraint?.['exclusive'] === true }
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
