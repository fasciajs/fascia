import type { AdmittedValue, JsonValue, Node, ObjectProperty, Rest, Source } from '@fasciajs/core'
import { UnreadableSchema } from '@fasciajs/core'
import { SchemaAST } from 'effect'
import type { Refined } from './refinements.js'
import {
  listAssertionsOf,
  numberAssertionsOf,
  refinedFrom,
  stringAssertionsOf
} from './refinements.js'

/**
 * An effect Schema, read as a `Node`.
 *
 * **effect publishes a plain tagged union**, `SchemaAST.AST`, with twenty-two members. That is the
 * cleanest of the three validators this library reads: zod's list of types has to be recovered from
 * its exports, arktype publishes its kinds as separate lists, and effect simply declares the sum. So
 * the dispatch is a `switch` on the tag and a case effect adds is a compile error at the
 * `satisfies never`, with nothing derived and no list kept beside it.
 *
 * Three things effect does that neither of the others does:
 *
 * A **refinement is a node wrapping a node**, so a schema stating two bounds is two nodes deep, and
 * reading an assertion means walking a chain. zod folds them into one bag, arktype keeps them beside
 * a basis.
 *
 * A **transformation is bidirectional by construction**. Every one carries a decode and an encode,
 * so effect produces the codec case as a matter of course where zod produces it rarely and arktype
 * cannot produce it at all.
 *
 * An **optional property states itself twice**: the property carries `isOptional` and its type is a
 * union holding `undefined`. The edge is the statement this library keeps.
 */
export const effectSource: Source<SchemaAST.AST> = { read }

function read(ast: SchemaAST.AST): Node<SchemaAST.AST> | UnreadableSchema {
  switch (ast._tag) {
    case 'StringKeyword':
      return { kind: 'scalar', name: 'string', assertions: {} }
    case 'NumberKeyword':
      return { kind: 'scalar', name: 'number', assertions: {} }
    case 'BooleanKeyword':
      return { kind: 'scalar', name: 'boolean', assertions: {} }
    case 'BigIntKeyword':
      return { kind: 'scalar', name: 'bigint', assertions: {} }

    // Three names for one statement about a value, which is that nothing is stated.
    case 'AnyKeyword':
    case 'UnknownKeyword':
    case 'ObjectKeyword':
      return { kind: 'scalar', name: 'unknown', assertions: {} }

    case 'Literal':
      return literal(ast)
    case 'Enums':
      return enums(ast)

    case 'Refinement':
      return refinement(ast)
    case 'Union':
      return union(ast)
    case 'TypeLiteral':
      return typeLiteral(ast)
    case 'TupleType':
      return tupleType(ast, {})

    case 'Transformation':
      // Both directions, always. `from` is the wire form and travels whichever way the conversion
      // runs, so `to` is an in-memory type no document describes.
      return { kind: 'conversion', how: 'codec', wire: ast.from, value: ast.to }

    case 'Suspend':
      return { kind: 'deferred', resolve: () => ast.f() }

    case 'Declaration':
      return declaration(ast)

    case 'TemplateLiteral':
      return new UnreadableSchema(
        ast,
        'a template literal states a pattern this package does not derive from its parts'
      )

    case 'NeverKeyword':
      return new UnreadableSchema(
        ast,
        'this admits no value, so it describes nothing a caller could send'
      )

    case 'UndefinedKeyword':
    case 'VoidKeyword':
      return new UnreadableSchema(
        ast,
        'a document says a value may be absent, and has no name for the absent value itself'
      )

    case 'SymbolKeyword':
    case 'UniqueSymbol':
      return new UnreadableSchema(ast, 'a symbol is not a value JSON carries')

    default:
      // effect declares `AST` as a plain tagged union, so this is the whole of it.
      ast satisfies never
      throw new Error(`effect states a node this package reads no case for: ${String(ast)}`)
  }
}

/** One admitted value. */
function literal(ast: SchemaAST.Literal): Node<SchemaAST.AST> | UnreadableSchema {
  const value = asAdmittedValue(ast.literal)

  return value === undefined
    ? new UnreadableSchema(ast, 'this admits one value, and the value is not one JSON carries')
    : { kind: 'values', admitted: [value] }
}

/** A TypeScript enum, whose members are the values it admits. */
function enums(ast: SchemaAST.Enums): Node<SchemaAST.AST> | UnreadableSchema {
  const admitted: AdmittedValue[] = []

  for (const [, member] of ast.enums) {
    const value = asAdmittedValue(member)
    if (value === undefined) {
      return new UnreadableSchema(ast, `this admits a ${typeof member}, which JSON does not carry`)
    }
    admitted.push(value)
  }

  const [first, ...rest] = admitted
  return first === undefined
    ? new UnreadableSchema(ast, 'this admits no value, so it describes nothing a caller could send')
    : { kind: 'values', admitted: [first, ...rest] }
}

/**
 * A refinement, and everything the chain beneath it states.
 *
 * The base decides which assertions apply, because a keyword means one thing on a string and another
 * on an array: `minLength` is a length and `minItems` is a count, and effect states both in the same
 * annotation vocabulary.
 */
function refinement(ast: SchemaAST.Refinement): Node<SchemaAST.AST> | UnreadableSchema {
  const { base, refined } = refinedFrom(ast)

  switch (base._tag) {
    case 'StringKeyword':
      return { kind: 'scalar', name: 'string', assertions: stringAssertionsOf(refined) }
    case 'NumberKeyword':
      return { kind: 'scalar', name: 'number', assertions: numberAssertionsOf(refined) }
    case 'TupleType':
      return tupleType(base, refined)
    default:
      // A refinement over anything else states its condition as a function and this package has no
      // reading for the condition. The schema beneath it still reads, so the refinement is dropped
      // rather than the schema, and the loss is that the document is wider than the schema.
      return read(base)
  }
}

/** A disjunction. effect writes a multi-literal and a nullable this way as well. */
function union(ast: SchemaAST.Union): Node<SchemaAST.AST> | UnreadableSchema {
  const [first, second, ...rest] = ast.types

  if (first === undefined || second === undefined) {
    return first === undefined
      ? new UnreadableSchema(ast, 'a union of no members admits no value')
      : new UnreadableSchema(
          ast,
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

/** An object or a record. effect writes both through one node, as arktype does. */
function typeLiteral(ast: SchemaAST.TypeLiteral): Node<SchemaAST.AST> | UnreadableSchema {
  const named = ast.propertySignatures
  const index = ast.indexSignatures

  if (named.length > 0 && index.length > 0) {
    return new UnreadableSchema(
      ast,
      'this states named properties and an index signature at once, and this package reads one or the other'
    )
  }

  const [only] = index
  if (named.length === 0 && index.length === 1 && only !== undefined) {
    return { kind: 'structural', of: 'dictionary', keys: only.parameter, values: only.type }
  }

  const properties = new Map<string, ObjectProperty<SchemaAST.AST>>()
  for (const property of named) {
    if (typeof property.name !== 'string') {
      return new UnreadableSchema(ast, 'a property of this object is named by a symbol')
    }

    properties.set(property.name, {
      // An optional property states itself twice: `isOptional` here and `undefined` as a member of
      // the type. The edge is kept and the member dropped, because a key that may be absent and a
      // value that may be undefined are one statement in a document.
      schema: property.isOptional ? withoutUndefined(property.type) : property.type,
      required: !property.isOptional,
      default: undefined
    })
  }

  return { kind: 'structural', of: 'object', properties, rest: restOf(index) }
}

function restOf(index: SchemaAST.TypeLiteral['indexSignatures']): Rest<SchemaAST.AST> {
  const [only] = index
  return only === undefined ? { allows: 'nothing' } : { allows: 'schema', schema: only.type }
}

/**
 * The type of an optional property, with the `undefined` effect adds to it removed.
 *
 * A union of exactly one member after the removal is that member, which is the common case:
 * `Schema.optional(Schema.Number)` is a union of a number and `undefined`.
 */
function withoutUndefined(ast: SchemaAST.AST): SchemaAST.AST {
  if (!SchemaAST.isUnion(ast)) {
    return ast
  }

  const stated = ast.types.filter((member) => member._tag !== 'UndefinedKeyword')
  const [only] = stated

  return stated.length === 1 && only !== undefined ? only : ast
}

/** An array or a tuple. effect writes both as a tuple with elements and a rest. */
function tupleType(ast: SchemaAST.TupleType, refined: Refined): Node<SchemaAST.AST> {
  const positions = ast.elements.map((element) => element.type)
  const [rest] = ast.rest

  if (positions.length > 0) {
    return {
      kind: 'structural',
      of: 'tuple',
      positions,
      rest: rest === undefined ? { allows: 'nothing' } : { allows: 'schema', schema: rest.type }
    }
  }

  return rest === undefined
    ? {
        kind: 'structural',
        of: 'tuple',
        positions: [],
        rest: { allows: 'nothing' }
      }
    : {
        kind: 'structural',
        of: 'list',
        items: rest.type,
        assertions: listAssertionsOf(refined)
      }
}

/** A declared type, which effect names rather than describes. */
function declaration(ast: SchemaAST.Declaration): Node<SchemaAST.AST> | UnreadableSchema {
  const named = ast.annotations[SchemaAST.IdentifierAnnotationId]
  const name = typeof named === 'string' ? named : undefined

  return name === 'DateFromSelf' || name === 'Date'
    ? { kind: 'scalar', name: 'date', assertions: {} }
    : new UnreadableSchema(
        ast,
        `this declares ${name ?? 'a type'}, and this package has no reading for a declared type`
      )
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

/** Declared for symmetry with the other readings, and unused until a default reaches this one. */
export function asJsonValue(value: unknown): JsonValue | undefined {
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
