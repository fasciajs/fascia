import type { Node, NodeFold } from '@fasciajs/core'
import { foldSource, isError, type UnreadableSchema } from '@fasciajs/core'
import { ReadableZodTypes, zodSource } from '@fasciajs/zod'
import { describe, expect, it } from 'vitest'
import * as z from 'zod'

/** The node a schema reads as, without walking into it. */
function nodeOf(schema: z.core.$ZodType): Node<z.core.$ZodType> | UnreadableSchema {
  return zodSource.read(schema)
}

/** The group a schema reads as, or the reason it reads as nothing. */
function groupOf(schema: z.core.$ZodType): string {
  const node = nodeOf(schema)
  return isError(node) ? `unreadable: ${node.message}` : node.kind
}

describe('every readable zod type reaches a group', () => {
  const perType: Record<ReadableZodTypes, [z.core.$ZodType, string]> = {
    string: [z.string(), 'scalar'],
    number: [z.number(), 'scalar'],
    bigint: [z.bigint(), 'scalar'],
    boolean: [z.boolean(), 'scalar'],
    date: [z.date(), 'scalar'],
    null: [z.null(), 'scalar'],
    any: [z.any(), 'scalar'],
    unknown: [z.unknown(), 'scalar'],
    literal: [z.literal('a'), 'values'],
    enum: [z.enum(['a', 'b']), 'values'],
    template_literal: [z.templateLiteral(['a', 'b']), 'scalar'],
    optional: [z.string().optional(), 'wrapper'],
    nullable: [z.string().nullable(), 'wrapper'],
    nonoptional: [z.string().optional().nonoptional(), 'wrapper'],
    default: [z.string().default('a'), 'wrapper'],
    prefault: [z.string().prefault('a'), 'wrapper'],
    catch: [z.string().catch('a'), 'wrapper'],
    readonly: [z.string().readonly(), 'wrapper'],
    object: [z.object({ a: z.string() }), 'structural'],
    array: [z.array(z.string()), 'structural'],
    tuple: [z.tuple([z.string()]), 'structural'],
    record: [z.record(z.string(), z.string()), 'structural'],
    union: [z.union([z.string(), z.number()]), 'combination'],
    intersection: [
      z.intersection(z.object({ a: z.string() }), z.object({ b: z.string() })),
      'combination'
    ],
    pipe: [z.string().pipe(z.string()), 'conversion'],
    transform: [z.transform((value: string) => value), 'unreadable'],
    lazy: [z.lazy(() => z.string()), 'deferred']
  }

  for (const name of ReadableZodTypes) {
    it(`reads a ${name}`, () => {
      const [schema, group] = perType[name]
      expect(groupOf(schema)).toMatch(new RegExp(`^${group}`))
    })
  }
})

describe('an unreadable type says why, rather than reading as something else', () => {
  it('turns away a value JSON does not carry', () => {
    expect(groupOf(z.symbol())).toContain('not a value JSON carries')
    expect(groupOf(z.map(z.string(), z.string()))).toContain('A record of the same shape is')
    expect(groupOf(z.set(z.string()))).toContain('An array of unique items is')
  })

  it('turns away a schema that admits no value', () => {
    expect(groupOf(z.never())).toContain('describes nothing a caller could send')
  })
})

describe('a union is one of three things, and the reading says which', () => {
  it('reads a plain union as any of its members', () => {
    expect(nodeOf(z.union([z.string(), z.number()]))).toMatchObject({
      kind: 'combination',
      law: 'any',
      discriminant: undefined
    })
  })

  it('reads a discriminated union as exactly one, and names the property', () => {
    const node = nodeOf(
      z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('a') }),
        z.object({ kind: z.literal('b') })
      ])
    )
    expect(node).toMatchObject({ kind: 'combination', law: 'exactlyOne', discriminant: 'kind' })
  })

  it('reads an intersection as all of its members', () => {
    const node = nodeOf(z.intersection(z.object({ a: z.string() }), z.object({ b: z.string() })))
    expect(node).toMatchObject({ kind: 'combination', law: 'all' })
  })
})

describe('a pipe states what each of its sides says', () => {
  it('reads a checking pipe as both sides describing one value', () => {
    expect(nodeOf(z.string().pipe(z.string()))).toMatchObject({ kind: 'conversion', how: 'checks' })
  })

  it('reads a transform as a stated input and an unstated output', () => {
    expect(nodeOf(z.string().transform((value) => value.length))).toMatchObject({
      kind: 'conversion',
      how: 'unstatedOutput'
    })
  })

  it('reads a preprocessor as an unstated input and a stated output', () => {
    expect(nodeOf(z.preprocess((value) => String(value), z.string()))).toMatchObject({
      kind: 'conversion',
      how: 'unstatedInput'
    })
  })

  it('reads a codec as a wire form and a value, not as one value checked twice', () => {
    expect(
      nodeOf(
        z.codec(z.string(), z.number(), {
          decode: (value) => Number(value),
          encode: (value) => String(value)
        })
      )
    ).toMatchObject({ kind: 'conversion', how: 'codec' })
  })
})

describe('an object says what it accepts at a key it does not name', () => {
  it('accepts an unnamed key, because zod removes one rather than refusing the value', () => {
    expect(nodeOf(z.object({ a: z.string() }))).toMatchObject({ rest: { allows: 'anything' } })
  })

  it('refuses an unnamed key where the schema does', () => {
    expect(nodeOf(z.strictObject({ a: z.string() }))).toMatchObject({ rest: { allows: 'nothing' } })
  })

  it('names the schema an unnamed key is held to', () => {
    expect(nodeOf(z.object({ a: z.string() }).catchall(z.number()))).toMatchObject({
      rest: { allows: 'schema' }
    })
  })
})

describe('the walk ends on a schema that holds itself', () => {
  it('reaches a revisit rather than running forever', () => {
    type Tree = { name: string; children: Tree[] }
    const tree: z.ZodType<Tree> = z.lazy(() =>
      z.object({ name: z.string(), children: z.array(tree) })
    )

    const groups: NodeFold<z.core.$ZodType, string[]> = {
      scalar: (node) => [node.name],
      values: () => ['values'],
      wrapper: (node, follow) => follow(node.inner),
      structural: (node, follow) =>
        node.of === 'object'
          ? [...node.properties.values()].flatMap(follow)
          : node.of === 'list'
            ? follow(node.items)
            : [],
      combination: (node, follow) => node.members.flatMap(follow),
      conversion: () => ['conversion'],
      deferred: (node, follow) => follow(node.resolve()),
      unreadable: ({ error }) => [`unreadable: ${error.message}`],
      revisited: () => ['revisited']
    }

    // `name` is a string, and `children` is an array of the schema that holds it. The second arrival
    // at the lazy is a revisit, so the walk ends.
    expect(foldSource(tree, zodSource, groups)).toEqual(['string', 'revisited'])
  })
})
