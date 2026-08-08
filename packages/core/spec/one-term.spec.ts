import { arktypeSource } from '@fasciajs/arktype'
import type { Described } from '@fasciajs/core'
import { describe as description, isError } from '@fasciajs/core'
import { effectSource } from '@fasciajs/effect'
import { zodSource } from '@fasciajs/zod'
import { type } from 'arktype'
import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'
import * as z from 'zod'

/**
 * One schema, written three ways, described once.
 *
 * The claim the whole shape rests on. Three validators that agree about nothing structurally have
 * to reach the same term for the same value, or the term is one validator's model wearing a neutral
 * name.
 *
 * This spec lives in `core` rather than in a frontend package, deliberately: it is the one claim no
 * single frontend can make about itself.
 */
function termOf(described: ReturnType<typeof description>): Described {
  if (isError(described)) {
    throw new Error(`the schema could not be described: ${described.message}`)
  }
  return described.term
}

type ArkRoot = Parameters<typeof arktypeSource.read>[0]

/** One cast, here, because arktype publishes `Type` and keeps its node types private. */
const arkDescription = (schema: unknown) => description(schema as ArkRoot, arktypeSource, 'input')

const asZod = (schema: z.core.$ZodType) => termOf(description(schema, zodSource, 'input'))
const asArk = (schema: unknown) => termOf(arkDescription(schema))
const asEffect = (schema: Schema.Schema.All) =>
  termOf(description(schema.ast, effectSource, 'input'))

describe('three validators reach one term for one value', () => {
  it('describes a string the same way from each', () => {
    const expected = { kind: 'typed', name: 'string', assertions: {}, admitsNull: false }

    expect(asZod(z.string())).toEqual(expected)
    expect(asArk(type('string'))).toEqual(expected)
    expect(asEffect(Schema.String)).toEqual(expected)
  })

  it('describes a bounded string the same way, from three different mechanisms', () => {
    // zod folds the bound into a bag, arktype keeps it beside a basis, and effect wraps the schema
    // in a refinement node. One term.
    const expected = {
      kind: 'typed',
      name: 'string',
      assertions: { minLength: 2 },
      admitsNull: false
    }

    expect(asZod(z.string().min(2))).toEqual(expected)
    expect(asArk(type('string >= 2'))).toEqual(expected)
    expect(asEffect(Schema.String.pipe(Schema.minLength(2)))).toEqual(expected)
  })

  it('describes a boolean the same way, though arktype holds no boolean at all', () => {
    const expected = { kind: 'typed', name: 'boolean', assertions: {}, admitsNull: false }

    expect(asZod(z.boolean())).toEqual(expected)
    // arktype writes this as the two unit types and holds no boolean domain.
    expect(asArk(type('boolean'))).toEqual(expected)
    expect(asEffect(Schema.Boolean)).toEqual(expected)
  })

  it('describes a nullable string the same way, from a wrapper and from two unions', () => {
    // The sharpest of these. zod states it as a wrapper around the schema, arktype and effect as a
    // union holding null. Nullability is a fact about the value, so all three land on one flag.
    const expected = { kind: 'typed', name: 'string', assertions: {}, admitsNull: true }

    expect(asZod(z.string().nullable())).toEqual(expected)
    expect(asArk(type('string|null'))).toEqual(expected)
    expect(asEffect(Schema.NullOr(Schema.String))).toEqual(expected)
  })

  it('describes an object with an optional key the same way, from three edges', () => {
    const zodTerm = asZod(z.object({ a: z.string(), b: z.number().optional() }))
    const arkTerm = asArk(type({ a: 'string', 'b?': 'number' }))
    const effectTerm = asEffect(
      Schema.Struct({ a: Schema.String, b: Schema.optional(Schema.Number) })
    )

    for (const term of [zodTerm, arkTerm, effectTerm]) {
      if (term.kind !== 'typed' || term.name !== 'object') {
        throw new Error('a schema did not describe as an object')
      }
      expect(term.assertions.properties.get('a')).toMatchObject({ required: true })
      expect(term.assertions.properties.get('b')).toMatchObject({ required: false })
    }
  })

  it('describes a list of strings the same way', () => {
    const expected = {
      kind: 'typed',
      name: 'array',
      assertions: { items: { kind: 'typed', name: 'string', assertions: {}, admitsNull: false } },
      admitsNull: false
    }

    expect(asZod(z.array(z.string()))).toEqual(expected)
    expect(asArk(type('string[]'))).toEqual(expected)
    expect(asEffect(Schema.Array(Schema.String))).toEqual(expected)
  })

  it('describes a disjunction the same way', () => {
    expect(asZod(z.union([z.string(), z.number()])).kind).toBe('some')
    expect(asArk(type('string|number')).kind).toBe('some')
    expect(asEffect(Schema.Union(Schema.String, Schema.Number)).kind).toBe('some')
  })
})

describe('where the three disagree, the term says what each one actually stated', () => {
  it('keeps zod exclusive discriminated union as exactly one, which the others cannot state', () => {
    const term = asZod(
      z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('a') }),
        z.object({ kind: z.literal('b') })
      ])
    )

    expect(term).toMatchObject({ kind: 'exactlyOne', discriminant: 'kind' })
  })

  it('describes an effect codec by its wire form, which zod states rarely and arktype never', () => {
    // effect names this one itself, so it is described once and pointed at. The wire form is what
    // the definition holds: `from` travels whichever way the conversion runs.
    const described = description(Schema.NumberFromString.ast, effectSource, 'input')
    if (isError(described)) {
      throw new Error(described.message)
    }

    expect(described.term).toEqual({ kind: 'ref', name: 'NumberFromString', admitsNull: false })
    expect(described.definitions.get('NumberFromString')).toEqual({
      kind: 'typed',
      name: 'string',
      assertions: {},
      admitsNull: false
    })
  })

  it('refuses a date from every one of them, for the same reason', () => {
    for (const described of [
      description(z.date(), zodSource, 'input'),
      arkDescription(type('Date')),
      description(Schema.DateFromSelf.ast, effectSource, 'input')
    ]) {
      expect(isError(described) ? described.message : 'described').toContain('no JSON form')
    }
  })
})
