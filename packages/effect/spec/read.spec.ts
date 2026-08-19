import type { Node, NodeFold } from '@fasciajs/core'
import { foldSource, isError } from '@fasciajs/core'
import { effectSource } from '@fasciajs/effect'
import { Schema, type SchemaAST } from 'effect'
import { describe, expect, it } from 'vitest'

function nodeOf(schema: Schema.Schema.All): Node<SchemaAST.AST> | Error {
  return effectSource.read(schema.ast)
}

/** The group a schema reads as, or `unreadable` where it reads as nothing. */
function groupOf(schema: Schema.Schema.All): string {
  const node = nodeOf(schema)
  return isError(node) ? 'unreadable' : node.kind
}

enum Colour {
  Red = 'red',
  Blue = 'blue'
}

/**
 * One schema per member of effect's own tagged union, and the group each one reaches.
 *
 * A `Record` over `SchemaAST.AST['_tag']`, so a node effect adds is a compile error here as well as
 * at the reading's `satisfies never`. Neither zod nor arktype allows this: zod's list of types has
 * to be recovered from its exports and arktype's kinds are published as separate lists, while effect
 * declares the sum and so a spec can be total over it for nothing.
 */
const aSchemaPerTag: Record<SchemaAST.AST['_tag'], [Schema.Schema.All, string]> = {
  StringKeyword: [Schema.String, 'scalar'],
  NumberKeyword: [Schema.Number, 'scalar'],
  BooleanKeyword: [Schema.Boolean, 'scalar'],
  BigIntKeyword: [Schema.BigIntFromSelf, 'scalar'],
  AnyKeyword: [Schema.Any, 'scalar'],
  UnknownKeyword: [Schema.Unknown, 'scalar'],
  ObjectKeyword: [Schema.Object, 'scalar'],
  Literal: [Schema.Literal('a'), 'values'],
  Enums: [Schema.Enums(Colour), 'values'],
  Refinement: [Schema.String.pipe(Schema.minLength(2)), 'scalar'],
  Union: [Schema.Union(Schema.String, Schema.Number), 'combination'],
  TypeLiteral: [Schema.Struct({ a: Schema.String }), 'structural'],
  TupleType: [Schema.Array(Schema.String), 'structural'],
  Transformation: [Schema.NumberFromString, 'conversion'],
  Suspend: [Schema.suspend((): Schema.Schema<string> => Schema.String), 'deferred'],
  Declaration: [Schema.DateFromSelf, 'scalar'],
  TemplateLiteral: [Schema.TemplateLiteral(Schema.Literal('a'), Schema.String), 'unreadable'],
  NeverKeyword: [Schema.Never, 'unreadable'],
  UndefinedKeyword: [Schema.Undefined, 'unreadable'],
  VoidKeyword: [Schema.Void, 'unreadable'],
  SymbolKeyword: [Schema.SymbolFromSelf, 'unreadable'],
  UniqueSymbol: [Schema.UniqueSymbolFromSelf(Symbol.for('fascia/probe')), 'unreadable']
}

describe('every node effect states reaches a group or says why it does not', () => {
  for (const [tag, [schema, group]] of Object.entries(aSchemaPerTag)) {
    it(`reads a ${tag}`, () => {
      expect(schema.ast._tag, `the fixture for ${tag} is not one`).toBe(tag)
      expect(groupOf(schema)).toBe(group)
    })
  }
})

describe('a refinement is a node wrapping a node, so an assertion is a walk', () => {
  it('reads one refinement', () => {
    expect(nodeOf(Schema.String.pipe(Schema.minLength(2)))).toEqual({
      kind: 'scalar',
      name: 'string',
      assertions: { minLength: 2 }
    })
  })

  it('reads a chain of refinements, which zod folds into one place and effect does not', () => {
    const schema = Schema.String.pipe(Schema.minLength(2), Schema.maxLength(5))

    // Two nodes deep. The outer states maxLength and the inner minLength, and the walk collects
    // both before it reaches the string underneath.
    expect(schema.ast._tag).toBe('Refinement')
    expect(nodeOf(schema)).toEqual({
      kind: 'scalar',
      name: 'string',
      assertions: { minLength: 2, maxLength: 5 }
    })
  })

  it('reads a bound stated exclusively, which effect writes under its own keyword', () => {
    expect(nodeOf(Schema.Number.pipe(Schema.greaterThan(1)))).toEqual({
      kind: 'scalar',
      name: 'number',
      assertions: { minimum: { value: 1, exclusive: true } }
    })
  })

  it('reads an array bound, where the same annotation vocabulary means a count', () => {
    expect(nodeOf(Schema.Array(Schema.String).pipe(Schema.minItems(2)))).toEqual({
      kind: 'structural',
      of: 'list',
      items: expect.objectContaining({ _tag: 'StringKeyword' }),
      assertions: { minItems: 2 }
    })
  })

  it('drops a refinement it cannot read and keeps the schema underneath', () => {
    // The condition is a function with no annotation to read, so nothing about it can be stated.
    // The document is then wider than the schema, which is the recoverable direction.
    const schema = Schema.Struct({ a: Schema.String }).pipe(Schema.filter(() => true))

    expect(groupOf(schema)).toBe('structural')
  })
})

describe('a transformation is bidirectional, so effect states codecs as a matter of course', () => {
  it('reads one as a wire form and a value', () => {
    // zod produces this rarely and arktype cannot produce it at all. Effect's transformations carry
    // a decode and an encode by construction.
    expect(nodeOf(Schema.NumberFromString)).toEqual({
      kind: 'conversion',
      how: 'codec',
      wire: expect.objectContaining({ _tag: 'StringKeyword' }),
      value: expect.objectContaining({ _tag: 'NumberKeyword' })
    })
  })

  it('states the side that travels as the wire form', () => {
    const node = nodeOf(Schema.NumberFromString)
    if (isError(node) || node.kind !== 'conversion' || node.how !== 'codec') {
      throw new Error('a transformation did not read as a codec')
    }

    // `from` is what a caller sends in both directions, and `to` is an in-memory type no document
    // describes.
    expect(node.wire._tag).toBe('StringKeyword')
    expect(node.value._tag).toBe('NumberKeyword')
  })
})

describe('an optional property states itself twice, and the edge is what is kept', () => {
  function propertyAt(schema: Schema.Schema.All, key: string): unknown {
    const node = nodeOf(schema)
    if (isError(node) || node.kind !== 'structural' || node.of !== 'object') {
      throw new Error('the schema did not read as an object')
    }
    return node.properties.get(key)
  }

  it('reads a required key', () => {
    expect(propertyAt(Schema.Struct({ a: Schema.String }), 'a')).toEqual({
      schema: expect.objectContaining({ _tag: 'StringKeyword' }),
      required: true,
      default: undefined
    })
  })

  it('reads an optional key from the edge', () => {
    expect(propertyAt(Schema.Struct({ a: Schema.optional(Schema.String) }), 'a')).toEqual({
      schema: expect.objectContaining({ _tag: 'StringKeyword' }),
      required: false,
      default: undefined
    })
  })

  it('drops the undefined effect adds to the type, because the edge already said it', () => {
    const property = propertyAt(Schema.Struct({ a: Schema.optional(Schema.String) }), 'a')
    const schema = (property as { schema: SchemaAST.AST }).schema

    // Left alone, the value would read as a disjunction holding a member no document can name.
    expect(schema._tag).toBe('StringKeyword')
  })
})

describe('one node covers an object and a record', () => {
  it('reads an index signature as a dictionary', () => {
    expect(nodeOf(Schema.Record({ key: Schema.String, value: Schema.Number }))).toEqual({
      kind: 'structural',
      of: 'dictionary',
      keys: expect.objectContaining({ _tag: 'StringKeyword' }),
      values: expect.objectContaining({ _tag: 'NumberKeyword' })
    })
  })

  it('reads a tuple as its positions', () => {
    expect(nodeOf(Schema.Tuple(Schema.String, Schema.Number))).toEqual({
      kind: 'structural',
      of: 'tuple',
      positions: [
        expect.objectContaining({ _tag: 'StringKeyword' }),
        expect.objectContaining({ _tag: 'NumberKeyword' })
      ],
      rest: { allows: 'nothing' }
    })
  })
})

describe('the walk ends on a schema that holds itself', () => {
  it('reaches a revisit rather than running forever', () => {
    interface Tree {
      readonly name: string
      readonly children: readonly Tree[]
    }

    const Tree: Schema.Schema<Tree> = Schema.Struct({
      name: Schema.String,
      children: Schema.Array(Schema.suspend((): Schema.Schema<Tree> => Tree))
    })

    const leaves: NodeFold<SchemaAST.AST, string[]> = {
      scalar: (node) => [node.name],
      values: () => ['values'],
      wrapper: (node, follow) => follow(node.inner),
      structural: (node, follow) =>
        node.of === 'object'
          ? [...node.properties.values()].flatMap((property) => follow(property.schema))
          : node.of === 'list'
            ? follow(node.items)
            : [],
      combination: (node, follow) => node.members.flatMap(follow),
      conversion: () => ['conversion'],
      deferred: (node, follow) => follow(node.resolve()),
      unreadable: () => ['unreadable'],
      revisited: () => ['revisited']
    }

    expect(foldSource(Tree.ast, effectSource, leaves)).toEqual(['string', 'revisited'])
  })
})
