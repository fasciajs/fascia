import { arktypeSource } from '@fasciajs/arktype'
import type { Described, Io } from '@fasciajs/core'
import { describe as description, isError } from '@fasciajs/core'
import { effectSource } from '@fasciajs/effect'
import { zodSource } from '@fasciajs/zod'
import { type } from 'arktype'
import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'
import * as z from 'zod'

/**
 * One schema has two sides, and a document describes one of them.
 *
 * A conversion is the only construct whose two ends are two different schemas, and all three
 * validators write one. So the side is not a zod question wearing a neutral name: each of the three
 * needs it, and each states it somewhere else.
 *
 * The side is stated by whoever asks. A request body is what a caller sends and a response body is
 * what a caller receives, and the same schema stands in both places, so nothing about the schema
 * decides it.
 */

type ArkRoot = Parameters<typeof arktypeSource.read>[0]

/**
 * The term, with a reference followed to what it names.
 *
 * A validator that names a schema makes a reference, and effect names plenty of its own: both sides
 * of `NumberFromString` are filed under that one name. Two sides claiming one name is harmless while
 * a description is about one side, and it is the naming question a document of two sides will have
 * to answer.
 */
function termOf(describing: ReturnType<typeof description>): Described {
  if (isError(describing)) {
    throw new Error(`the schema could not be described: ${describing.message}`)
  }

  const term = describing.term
  if (term.kind !== 'ref') {
    return term
  }

  const named = describing.definitions.get(term.name)
  if (named === undefined) {
    throw new Error(`nothing is defined under ${term.name}`)
  }
  return named
}

const fromZod = (schema: z.core.$ZodType, io: Io) => termOf(description(schema, zodSource, io))
const fromArk = (schema: unknown, io: Io) =>
  termOf(description(schema as ArkRoot, arktypeSource, io))
const fromEffect = (schema: Schema.Schema.AnyNoContext, io: Io) =>
  termOf(description(schema.ast, effectSource, io))

const refusalFromZod = (schema: z.core.$ZodType, io: Io) => description(schema, zodSource, io)
const refusalFromArk = (schema: unknown, io: Io) =>
  description(schema as ArkRoot, arktypeSource, io)

/** Whether an object term states that a key must be present. */
function requires(term: Described, key: string): boolean {
  if (term.kind !== 'typed' || term.name !== 'object') {
    throw new Error(`the term is a ${term.kind} rather than an object`)
  }
  const property = term.assertions.properties.get(key)
  if (property === undefined) {
    throw new Error(`the term states no key ${key}`)
  }
  return property.required
}

describe('a conversion is described by the side that was asked for', () => {
  it('describes what zod checks before a pipe, and what it checks after', () => {
    expect(fromZod(z.string().pipe(z.string().min(2)), 'input')).toMatchObject({
      name: 'string',
      assertions: {}
    })
    expect(fromZod(z.string().pipe(z.string().min(2)), 'output')).toMatchObject({
      name: 'string',
      assertions: { minLength: 2 }
    })
  })

  it("describes a zod codec's wire form on one side and its value on the other", () => {
    const codec = z.codec(z.string(), z.number(), {
      decode: (value) => Number(value),
      encode: (value) => String(value)
    })

    expect(fromZod(codec, 'input')).toMatchObject({ name: 'string' })
    expect(fromZod(codec, 'output')).toMatchObject({ name: 'number' })
  })

  it('describes what arktype converts, and what it converts to where the caller said', () => {
    // arktype compiles a declared output to a node standing last among the morphs, and leaves a
    // function there otherwise. So a morph states its far side exactly when a caller stated one.
    const declared = type('string').pipe((value) => value.length, type('number'))

    expect(fromArk(declared, 'input')).toMatchObject({ name: 'string' })
    expect(fromArk(declared, 'output')).toMatchObject({ name: 'number' })
  })

  it("describes an effect transformation's encoded side and its type side", () => {
    expect(fromEffect(Schema.NumberFromString, 'input')).toMatchObject({ name: 'string' })
    expect(fromEffect(Schema.NumberFromString, 'output')).toMatchObject({ name: 'number' })
  })
})

describe('an end no schema states is a refusal, and which end depends on the side', () => {
  it('refuses the far side of a zod transform, and describes the near one', () => {
    const transformed = z.string().transform((value) => value.length)

    expect(fromZod(transformed, 'input')).toMatchObject({ name: 'string' })
    expect(refusalFromZod(transformed, 'output')).toMatchObject({
      message: expect.stringContaining('no schema states what comes out of it')
    })
  })

  it('refuses the near side of a zod preprocessor, and describes the far one', () => {
    const preprocessed = z.preprocess((value) => String(value), z.string())

    expect(refusalFromZod(preprocessed, 'input')).toMatchObject({
      message: expect.stringContaining('no schema states what a caller may send')
    })
    expect(fromZod(preprocessed, 'output')).toMatchObject({ name: 'string' })
  })

  it('refuses the far side of an arktype morph the caller declared nothing for', () => {
    const bare = type('string').pipe((value) => value.length)

    expect(fromArk(bare, 'input')).toMatchObject({ name: 'string' })
    expect(refusalFromArk(bare, 'output')).toMatchObject({
      message: expect.stringContaining('no schema states what comes out of it')
    })
  })
})

describe('a key with a default may be left out of what is sent and is always in what comes back', () => {
  it('states both sides of a zod default', () => {
    const schema = z.object({ a: z.string().default('x') })

    expect(requires(fromZod(schema, 'input'), 'a')).toBe(false)
    expect(requires(fromZod(schema, 'output'), 'a')).toBe(true)
  })

  it('states both sides of an arktype default', () => {
    const schema = type({ a: 'number = 1' })

    expect(requires(fromArk(schema, 'input'), 'a')).toBe(false)
    expect(requires(fromArk(schema, 'output'), 'a')).toBe(true)
  })

  it('states both sides of an effect default, which effect writes as two shapes', () => {
    // effect states this as a transformation rather than on the edge, so it reaches the two sides
    // through the conversion and never through the rule the other two need. The answer is the same.
    const schema = Schema.Struct({
      a: Schema.optionalWith(Schema.Number, { default: () => 1 })
    })

    expect(requires(fromEffect(schema, 'input'), 'a')).toBe(false)
    expect(requires(fromEffect(schema, 'output'), 'a')).toBe(true)
  })

  it('leaves a key that is merely optional absent-able on both sides', () => {
    const schema = z.object({ a: z.string().optional() })

    expect(requires(fromZod(schema, 'input'), 'a')).toBe(false)
    expect(requires(fromZod(schema, 'output'), 'a')).toBe(false)
  })
})
