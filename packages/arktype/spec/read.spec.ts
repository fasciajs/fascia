import type { ArkNode } from '@fasciajs/arktype'
import { arktypeSource } from '@fasciajs/arktype'
import type { Node, NodeFold } from '@fasciajs/core'
import { foldSource, isError } from '@fasciajs/core'
import { type } from 'arktype'
import { describe, expect, it } from 'vitest'

/**
 * A `Type` is one of arktype's nodes, which is what makes a reading possible at one level.
 *
 * Stated as a function rather than assumed at each call, because it is the claim this package rests
 * on: if a `Type` stopped being a node, every test here would fail on the same line.
 */
function nodeOf(schema: unknown): Node<ArkNode> | Error {
  return arktypeSource.read(schema as ArkNode)
}

function groupOf(schema: unknown): string {
  const node = nodeOf(schema)
  return isError(node) ? `unreadable: ${node.message}` : node.kind
}

describe('a Type is a node, and its children are nodes', () => {
  it('reads a bare domain', () => {
    expect(nodeOf(type('string'))).toMatchObject({ kind: 'scalar', name: 'string' })
    expect(nodeOf(type('number'))).toMatchObject({ kind: 'scalar', name: 'number' })
    expect(nodeOf(type('bigint'))).toMatchObject({ kind: 'scalar', name: 'bigint' })
  })

  it('reads a constrained domain, with the constraints beside it', () => {
    expect(nodeOf(type('string > 2'))).toMatchObject({
      kind: 'scalar',
      name: 'string',
      assertions: { minLength: 3 }
    })
    expect(nodeOf(type('1 < number < 9'))).toMatchObject({
      kind: 'scalar',
      name: 'number',
      assertions: {
        minimum: { value: 1, exclusive: true },
        maximum: { value: 9, exclusive: true }
      }
    })
  })

  it('reads a pattern', () => {
    expect(nodeOf(type('/^a.c$/'))).toMatchObject({ assertions: { patterns: ['^a.c$'] } })
  })

  it('reads a Date, and turns away a prototype with no wire form', () => {
    expect(nodeOf(type('Date'))).toMatchObject({ kind: 'scalar', name: 'date' })
    expect(groupOf(type('symbol'))).toContain('not a value a document carries')
  })
})

describe('arktype writes as a union three things that are not disjunctions', () => {
  it('reads a boolean, which arktype holds no domain for', () => {
    // arktype writes `boolean` as the two unit types. Reading it as a disjunction of two constants
    // would accept the same values and say so in a way no reader of a document would recognise.
    expect(type('boolean').json).toEqual([{ unit: false }, { unit: true }])
    expect(nodeOf(type('boolean'))).toMatchObject({ kind: 'scalar', name: 'boolean' })
  })

  it('turns away never, which arktype writes as a union of no branches', () => {
    expect(type('never').json).toEqual([])
    expect(groupOf(type('never'))).toContain('describes nothing a caller could send')
  })

  it('reads a real disjunction as one', () => {
    expect(nodeOf(type('string|number'))).toMatchObject({ kind: 'combination', law: 'any' })
  })

  it('reads a nullable as a disjunction holding the null unit', () => {
    // zod states this as a wrapper and arktype as a union. The sum holds both, and nothing
    // canonicalises the two into one shape.
    expect(nodeOf(type('string|null'))).toMatchObject({ kind: 'combination', law: 'any' })
  })
})

describe('an object states optionality and a default on its edge', () => {
  function propertyAt(schema: unknown, key: string): unknown {
    const node = nodeOf(schema)
    if (isError(node) || node.kind !== 'structural' || node.of !== 'object') {
      throw new Error(`the schema did not read as an object: ${groupOf(schema)}`)
    }
    return node.properties.get(key)
  }

  it('reads a required key', () => {
    expect(propertyAt(type({ a: 'string' }), 'a')).toMatchObject({ required: true })
  })

  it('reads an optional key, which holds no wrapper to unwrap', () => {
    // The whole reason the edge carries this. arktype's value here is `number`, and no arktype
    // schema means "optional number".
    expect(propertyAt(type({ 'b?': 'number' }), 'b')).toMatchObject({
      required: false,
      default: undefined
    })
  })

  it('reads a default, which arktype also states on the edge', () => {
    expect(propertyAt(type({ b: 'number = 3' }), 'b')).toMatchObject({
      required: false,
      default: 3
    })
  })
})

describe('one structure node covers four shapes', () => {
  it('reads an array, and the bounds it states', () => {
    expect(nodeOf(type('string[]'))).toMatchObject({ kind: 'structural', of: 'list' })
    expect(nodeOf(type('string[] > 2'))).toMatchObject({ assertions: { minItems: 3 } })
  })

  it('reads a tuple as its positions', () => {
    const node = nodeOf(type(['string', 'number']))
    expect(node).toMatchObject({ kind: 'structural', of: 'tuple' })
    expect((node as unknown as { positions: unknown[] }).positions).toHaveLength(2)
  })

  it('reads an index signature as a dictionary, keeping the key schema', () => {
    expect(nodeOf(type({ '[string]': 'number' }))).toMatchObject({
      kind: 'structural',
      of: 'dictionary'
    })
  })

  it('turns away an object that states named keys and an index at once', () => {
    // One arktype shape that this sum holds as two. Refused rather than read as either, because
    // dropping the named keys and dropping the key schema are both losses nobody asked for.
    //
    // The named key has to satisfy the index, or arktype refuses the schema itself: `a: string`
    // beside `[string]: number` is unsatisfiable and never reaches a reading.
    expect(groupOf(type({ a: 'number', '[string]': 'number' }))).toContain(
      'named properties and an index signature at once'
    )
  })
})

describe('a morph states what it is given and not what it produces', () => {
  it('reads a morph as a stated input with an unstated output', () => {
    expect(nodeOf(type('string').pipe((value: string) => value.length))).toMatchObject({
      kind: 'conversion',
      how: 'unstatedOutput'
    })
  })
})

describe('the walk reaches the same answers over two validators', () => {
  const leaves: NodeFold<ArkNode, string[]> = {
    scalar: (node) => [node.name],
    values: (node) => node.admitted.map((value) => value.of),
    wrapper: (node, follow) => follow(node.inner),
    structural: (node, follow) =>
      node.of === 'object'
        ? [...node.properties.values()].flatMap((property) => follow(property.schema))
        : node.of === 'list'
          ? follow(node.items)
          : node.of === 'tuple'
            ? node.positions.flatMap(follow)
            : [],
    combination: (node, follow) => node.members.flatMap(follow),
    conversion: () => ['conversion'],
    deferred: (node, follow) => follow(node.resolve()),
    unreadable: ({ error }) => [`unreadable: ${error.message}`],
    revisited: () => ['revisited']
  }

  it('folds an object of scalars to the scalars it holds', () => {
    const schema = type({ name: 'string', 'age?': 'number', tags: 'string[]' })

    // Required keys before optional ones, which is arktype's own order and not the one written
    // above. A reading states what it is given, so the order is arktype's to choose.
    expect(foldSource(schema as unknown as ArkNode, arktypeSource, leaves)).toEqual([
      'string',
      'string',
      'number'
    ])
  })
})
