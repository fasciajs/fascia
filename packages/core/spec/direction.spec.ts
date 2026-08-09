import { arktypeSource } from '@fasciajs/arktype'
import type { Ask, Described, Descriptions, Io, SideNames } from '@fasciajs/core'
import { describeAll, describe as description, isError } from '@fasciajs/core'
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
 * of `NumberFromString` are filed under that name. One description is about one side, so the name
 * stands for one thing here. The block at the end of this file is where both sides meet.
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

  it('describes what arktype converts, and what it converts to where the caller said', () => {
    // arktype compiles a declared output to a node standing last among the morphs, and leaves a
    // function there otherwise. So a morph states its far side exactly when a caller stated one.
    const declared = type('string').pipe((value) => value.length, type('number'))

    expect(fromArk(declared, 'input')).toMatchObject({ name: 'string' })
    expect(fromArk(declared, 'output')).toMatchObject({ name: 'number' })
  })
})

describe('a codec travels as its wire form, whichever way it runs', () => {
  /**
   * The one conversion the side does not choose, and it is forced rather than preferred.
   *
   * A codec encodes back to its wire form on the way out, so the wire form is what a document
   * describes in both directions and the value is an in-memory type that never reaches one.
   */
  it('says the wire form of a zod codec on both sides', () => {
    const codec = z.codec(z.string(), z.number(), {
      decode: (value) => Number(value),
      encode: (value) => String(value)
    })

    expect(fromZod(codec, 'input')).toMatchObject({ name: 'string' })
    expect(fromZod(codec, 'output')).toMatchObject({ name: 'string' })
  })

  it('says the encoded side of an effect transformation on both sides', () => {
    expect(fromEffect(Schema.NumberFromString, 'input')).toMatchObject({ name: 'string' })
    expect(fromEffect(Schema.NumberFromString, 'output')).toMatchObject({ name: 'string' })
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

  it('says less about an effect default, because effect writes one as a transformation', () => {
    // The one place the three do not agree, and the reason is worth stating. zod and arktype put a
    // default on the edge, so the rule above reaches it. effect writes one as a transformation,
    // which is a codec, and a codec's wire form travels both ways. So the encoded side is what both
    // documents say and it states the key as absent-able.
    //
    // Wider than what an effect server produces, which always has the key. Wider is sound, and a
    // document naming the type side would describe a value the wire never carries.
    const schema = Schema.Struct({
      a: Schema.optionalWith(Schema.Number, { default: () => 1 })
    })

    expect(requires(fromEffect(schema, 'input'), 'a')).toBe(false)
    expect(requires(fromEffect(schema, 'output'), 'a')).toBe(false)
  })

  it('leaves a key that is merely optional absent-able on both sides', () => {
    const schema = z.object({ a: z.string().optional() })

    expect(requires(fromZod(schema, 'input'), 'a')).toBe(false)
    expect(requires(fromZod(schema, 'output'), 'a')).toBe(false)
  })
})

describe('a document holds both sides, and a name states one shape', () => {
  /** What this document calls the two sides. Nothing in the library states one. */
  const sides: SideNames = { input: (name) => `${name}Input`, output: (name) => `${name}Output` }

  function bothSides(schema: z.core.$ZodType): Descriptions {
    const asks: readonly Ask<z.core.$ZodType>[] = [
      { schema, io: 'input' },
      { schema, io: 'output' }
    ]

    const described = describeAll(asks, zodSource, { sides })
    if (isError(described)) {
      throw new Error(described.message)
    }
    return described
  }

  it('keeps one name where the two sides say the same thing', () => {
    // The common case, and the reason a side is not simply part of every name. A shape with no
    // conversion and no default under it describes identically from both directions, and a document
    // naming it twice would state the same thing twice.
    const User = z.object({ id: z.string() }).meta({ id: 'User' })
    const described = bothSides(User)

    expect([...described.definitions.keys()]).toEqual(['User'])
    expect(described.terms).toEqual([
      { kind: 'ref', name: 'User', admitsNull: false, meta: {} },
      { kind: 'ref', name: 'User', admitsNull: false, meta: {} }
    ])
  })

  it('gives each side its own name where a default makes them differ', () => {
    const User = z
      .object({ id: z.string(), role: z.string().default('reader') })
      .meta({ id: 'User' })
    const described = bothSides(User)

    expect([...described.definitions.keys()].sort()).toEqual(['UserInput', 'UserOutput'])
    expect(described.terms).toEqual([
      { kind: 'ref', name: 'UserInput', admitsNull: false, meta: {} },
      { kind: 'ref', name: 'UserOutput', admitsNull: false, meta: {} }
    ])
  })

  it('splits what refers to a split name, whose own two sides are alike', () => {
    // The reason this is a closure rather than a comparison. Both sides of the envelope hold the
    // same term, `ref User`, so nothing about the envelope differs until the reference is written.
    // Then one says UserInput and the other UserOutput, and one definition cannot say both.
    const User = z.object({ role: z.string().default('reader') }).meta({ id: 'User' })
    const Envelope = z.object({ user: User }).meta({ id: 'Envelope' })

    const described = bothSides(Envelope)

    expect([...described.definitions.keys()].sort()).toEqual([
      'EnvelopeInput',
      'EnvelopeOutput',
      'UserInput',
      'UserOutput'
    ])
    expect(described.definitions.get('EnvelopeInput')).toMatchObject({
      assertions: {
        properties: new Map([
          [
            'user',
            expect.objectContaining({
              term: { kind: 'ref', name: 'UserInput', admitsNull: false, meta: {} }
            })
          ]
        ])
      }
    })
  })

  it('refuses to take a name a schema already has', () => {
    const User = z.object({ role: z.string().default('reader') }).meta({ id: 'User' })
    const UserInput = z.object({ other: z.string() }).meta({ id: 'UserInput' })

    const described = describeAll(
      [
        { schema: User, io: 'input' },
        { schema: User, io: 'output' },
        { schema: UserInput, io: 'input' }
      ],
      zodSource,
      { sides }
    )

    expect(isError(described) ? described.message : 'described').toContain(
      'two definitions are both called UserInput'
    )
  })

  it('refuses a naming that gives the two sides one name', () => {
    // The failure a caller can now write, and the reason nothing here supplies the names silently.
    // A naming that ignores the side leaves two bodies under one name, which is what a split is for.
    const User = z.object({ role: z.string().default('reader') }).meta({ id: 'User' })

    const described = describeAll(
      [
        { schema: User, io: 'input' },
        { schema: User, io: 'output' }
      ],
      zodSource,
      { sides: { input: (name) => `${name}Body`, output: (name) => `${name}Body` } }
    )

    expect(isError(described) ? described.message : 'described').toContain(
      'two definitions are both called UserBody'
    )
  })

  it('takes any naming a caller states, and states none of its own', () => {
    const User = z.object({ role: z.string().default('reader') }).meta({ id: 'User' })

    const described = describeAll(
      [
        { schema: User, io: 'input' },
        { schema: User, io: 'output' }
      ],
      zodSource,
      { sides: { input: (name) => `New${name}`, output: (name) => name } }
    )
    if (isError(described)) {
      throw new Error(described.message)
    }

    expect([...described.definitions.keys()].sort()).toEqual(['NewUser', 'User'])
  })

  it('still refuses two different schemas sharing a name, one on each side', () => {
    // A split is for two sides of one schema. Two schemas are the error they always were, and
    // reaching them from different sides must not read as a side to split.
    const first = z.object({ a: z.string() }).meta({ id: 'Thing' })
    const second = z.object({ b: z.number() }).meta({ id: 'Thing' })

    const described = describeAll(
      [
        { schema: first, io: 'input' },
        { schema: second, io: 'output' }
      ],
      zodSource,
      { sides }
    )

    expect(isError(described) ? described.message : 'described').toContain(
      'two different schemas are named Thing'
    )
  })
})

describe('a schema that holds itself, described from both sides', () => {
  const sides: SideNames = { input: (name) => `${name}Input`, output: (name) => `${name}Output` }

  it('splits a recursive name whose sides differ, and points the body at itself', () => {
    // The two mechanisms meeting: a name bound before its body is walked, and a name split because
    // its two sides say different things. A recursive name that splits refers to a split name, which
    // is itself, so the closure has to reach a fixed point rather than run forever.
    const Node: z.ZodType = z
      .lazy(() =>
        z.object({
          name: z.string(),
          depth: z.number().default(0),
          children: z.array(Node)
        })
      )
      .meta({ id: 'Node' })

    const described = describeAll(
      [
        { schema: Node, io: 'input' },
        { schema: Node, io: 'output' }
      ],
      zodSource,
      { sides }
    )
    if (isError(described)) {
      throw new Error(described.message)
    }

    expect([...described.definitions.keys()].sort()).toEqual(['NodeInput', 'NodeOutput'])
    expect(described.terms).toEqual([
      { kind: 'ref', name: 'NodeInput', admitsNull: false, meta: {} },
      { kind: 'ref', name: 'NodeOutput', admitsNull: false, meta: {} }
    ])

    // Each side's body refers to its own side, not to the other one. A body pointing at the wrong
    // side would state that a request holds responses.
    const inside = (name: string): string => {
      const body = described.definitions.get(name)
      if (body?.kind !== 'typed' || body.name !== 'object') {
        throw new Error(`${name} is not an object`)
      }
      const children = body.assertions.properties.get('children')?.term
      if (children?.kind !== 'typed' || children.name !== 'array') {
        throw new Error(`${name} states no list of children`)
      }
      const item = children.assertions.items
      return item.kind === 'ref' ? item.name : item.kind
    }

    expect(inside('NodeInput')).toBe('NodeInput')
    expect(inside('NodeOutput')).toBe('NodeOutput')
  })

  it('keeps one name for a recursive schema whose sides agree', () => {
    const Chain: z.ZodType = z.lazy(() => z.object({ next: z.array(Chain) })).meta({ id: 'Chain' })

    const described = describeAll(
      [
        { schema: Chain, io: 'input' },
        { schema: Chain, io: 'output' }
      ],
      zodSource,
      { sides }
    )
    if (isError(described)) {
      throw new Error(described.message)
    }

    expect([...described.definitions.keys()]).toEqual(['Chain'])
  })
})
