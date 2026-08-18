import { arktypeSource } from '@fasciajs/arktype'
import type { AtdSchema } from '@fasciajs/atd'
import {
  isAtdDiscriminator,
  isAtdElements,
  isAtdEnum,
  isAtdProperties,
  isAtdSchema,
  isAtdTypeForm,
  isAtdValues,
  spellAtd,
  spellAtdAll
} from '@fasciajs/atd'
import type { Departure, Spelled } from '@fasciajs/core'
import { describe as description, isError, noMeta } from '@fasciajs/core'
import { effectSource } from '@fasciajs/effect'
import { zodSource } from '@fasciajs/zod'
import { type } from 'arktype'
import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'
import * as z from 'zod'

/**
 * Every document this spec produces, held to arri's own guards.
 *
 * `isAtdSchema` alone is too weak to be the whole check, and knowing why is the point. The empty
 * form has no required key, so **any object at all** satisfies it, and a properties form missing its
 * `properties` passes as an empty form that accepts every value. So the check asks which form the
 * document is as well as whether it is one, and refuses a document that is only ever a legal empty
 * form by accident.
 */
function conforming(written: AtdSchema, at: readonly string[] = []): void {
  const where = at.length === 0 ? 'the document' : at.join('/')

  if (!isAtdSchema(written)) {
    throw new Error(`${where} is not an ATD schema: ${JSON.stringify(written)}`)
  }

  if (isAtdProperties(written)) {
    for (const [key, value] of Object.entries(written.properties)) {
      conforming(value, [...at, key])
    }
    for (const [key, value] of Object.entries(written.optionalProperties ?? {})) {
      conforming(value, [...at, key])
    }
    return
  }

  if (isAtdDiscriminator(written)) {
    for (const [tag, member] of Object.entries(written.mapping)) {
      if (!isAtdProperties(member)) {
        throw new Error(`${where} maps ${tag} to something that is not a properties form`)
      }
      conforming(member, [...at, tag])
    }
    return
  }

  if (isAtdElements(written)) {
    conforming(written.elements, [...at, 'elements'])
    return
  }

  if (isAtdValues(written)) {
    conforming(written.values, [...at, 'values'])
    return
  }

  if (isAtdEnum(written) || isAtdTypeForm(written)) {
    return
  }

  // What is left is the empty form, which every object satisfies. Reaching it by accident is the
  // failure this check exists for: a form missing a key it needs reads as this one.
  if (Object.keys(written).some((key) => key !== 'isNullable' && key !== 'metadata')) {
    throw new Error(`${where} states keys no ATD form names: ${JSON.stringify(written)}`)
  }
}

/** A zod schema, all the way to a document. The first thing this library does end to end. */
function atdOf(schema: z.core.$ZodType): Spelled<AtdSchema> {
  const described = description(schema, zodSource, 'input')
  if (isError(described)) {
    throw new Error(`the schema could not be described: ${described.message}`)
  }

  const spelled = spellAtd(described.term)
  if (isError(spelled)) {
    throw new Error(`the term could not be written: ${spelled.message}`)
  }

  conforming(spelled.written)
  return spelled
}

/** The reason ATD refuses a schema outright, for the cases where it does. */
function refusalOf(schema: z.core.$ZodType): string {
  const described = description(schema, zodSource, 'input')
  if (isError(described)) {
    throw new Error(`the schema could not be described: ${described.message}`)
  }

  const spelled = spellAtd(described.term)
  if (!isError(spelled)) {
    throw new Error(`the term was written as ${JSON.stringify(spelled.written)}`)
  }
  return spelled.message
}

const said = (departures: readonly Departure[]) => departures.map((one) => one.said).join(' ')

describe('a schema reaches a document', () => {
  it('writes a string', () => {
    expect(atdOf(z.string())).toEqual({ written: { type: 'string' }, departures: [] })
  })

  it('writes a nullable, which ATD states as a flag on any form', () => {
    expect(atdOf(z.string().nullable()).written).toEqual({ type: 'string', isNullable: true })
  })

  it('writes an object, with optionality on its own key as ATD has it', () => {
    expect(atdOf(z.strictObject({ a: z.string(), b: z.boolean().optional() })).written).toEqual({
      properties: { a: { type: 'string' } },
      optionalProperties: { b: { type: 'boolean' } },
      isStrict: true
    })
  })

  it('writes a list', () => {
    expect(atdOf(z.array(z.string())).written).toEqual({ elements: { type: 'string' } })
  })

  it('writes a record as the values form', () => {
    expect(atdOf(z.record(z.string(), z.boolean())).written).toEqual({
      values: { type: 'boolean' }
    })
  })

  it('writes an enum of strings', () => {
    expect(atdOf(z.enum(['a', 'b'])).written).toEqual({ enum: ['a', 'b'] })
  })

  it('writes what states nothing as the empty form', () => {
    expect(atdOf(z.unknown()).written).toEqual({})
  })
})

describe('a width is chosen from the bounds, which is the motto running forwards', () => {
  it('names int32 for the range int32 admits', () => {
    // The term says whole numbers in this range and the target picks the word. Nothing is given up,
    // because the width is what the bounds already said.
    expect(atdOf(z.int32())).toEqual({ written: { type: 'int32' }, departures: [] })
  })

  it('names uint32 for its range', () => {
    expect(atdOf(z.uint32()).written).toEqual({ type: 'uint32' })
  })

  it('names float64 for a number that is not whole', () => {
    expect(atdOf(z.number())).toEqual({ written: { type: 'float64' }, departures: [] })
  })

  it('reports a bound no width matches, because ATD has no keyword for one', () => {
    const spelled = atdOf(z.number().int().min(1).max(9))

    // `float64`, not `int32`. A width states its own bounds, so writing one the schema did not ask
    // for refuses whole numbers the schema takes: `int32` here refused 3000000000, and the property
    // beside this file found it. No ATD width holds every whole number, and `int64` travels as a
    // string, so a document naming one describes a value the schema rejects every instance of.
    expect(spelled.written).toEqual({ type: 'float64' })
    expect(said(spelled.departures)).toContain('no ATD width matches')
    expect(said(spelled.departures)).toContain('accepts a fraction')
  })

  it('writes the width where the schema asked for exactly one', () => {
    // Unchanged, and this is the case a width is for: the bounds are the width, so naming it gives
    // nothing up in either direction.
    expect(atdOf(z.int32()).written).toEqual({ type: 'int32' })
  })
})

describe('what ATD cannot say is said about the schema, not swallowed', () => {
  it('reports every assertion a string states', () => {
    const spelled = atdOf(z.string().min(2).max(5).regex(/^a/))

    expect(spelled.written).toEqual({ type: 'string' })
    expect(spelled.departures).toHaveLength(3)
    for (const departure of spelled.departures) {
      expect(departure.direction).toBe('wider')
      expect(departure.cause).toBe('noWordForIt')
      expect(departure.said).toContain('accepts strings the schema refuses')
    }
  })

  it('reports a count on a list', () => {
    expect(said(atdOf(z.array(z.string()).min(2)).departures)).toContain('no keyword for a count')
  })

  it('reports a divisor', () => {
    expect(said(atdOf(z.number().multipleOf(2)).departures)).toContain('no keyword for one')
  })

  it('reports a default, and says what a caller may send is unchanged', () => {
    const spelled = atdOf(z.object({ a: z.string().default('x') }))
    const [only] = spelled.departures

    expect(only?.direction).toBe('neither')
    expect(only?.said).toContain('unchanged')
  })

  it('says where it happened, as the path the walk took', () => {
    const spelled = atdOf(z.object({ outer: z.object({ inner: z.string().min(2) }) }))
    const [only] = spelled.departures

    // The path comes free: each case prefixes what the case beneath reported.
    expect(only?.at).toEqual(['outer', 'inner'])
  })

  it('writes a tuple as a list of anything, which is wider and sound', () => {
    const spelled = atdOf(z.tuple([z.string(), z.number()]))

    expect(spelled.written).toEqual({ elements: {} })
    expect(said(spelled.departures)).toContain('accepts any list at all')
  })
})

describe('what cannot be written soundly is refused rather than invented', () => {
  it('refuses a disjunction that is not chosen by a tag', () => {
    expect(refusalOf(z.union([z.string(), z.number()]))).toContain('no form for a disjunction')
  })

  it('refuses an intersection', () => {
    expect(
      refusalOf(z.intersection(z.object({ a: z.string() }), z.object({ b: z.string() })))
    ).toContain('no form for an intersection')
  })

  it('refuses an enum that admits anything but strings', () => {
    expect(refusalOf(z.literal(1))).toContain('names strings and nothing else')
  })
})

describe('a tagged disjunction is the one ATD has', () => {
  it('writes a discriminated union as a discriminator and a mapping', () => {
    const spelled = atdOf(
      z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('circle'), radius: z.number() }),
        z.object({ kind: z.literal('square'), side: z.number() })
      ])
    )

    // The tag is the key of the mapping, so the member no longer states it as a property.
    expect(spelled.written).toEqual({
      discriminator: 'kind',
      mapping: {
        circle: { properties: { radius: { type: 'float64' } } },
        square: { properties: { side: { type: 'float64' } } }
      }
    })
  })

  it('refuses a tagged disjunction whose member is not an object', () => {
    // Stated as a term, because no validator here builds one: each refuses a tagged disjunction
    // over anything but objects before this library sees it. ATD refuses it too, and says which.
    const spelled = spellAtd({
      kind: 'exactlyOne',
      discriminant: 'kind',
      admitsNull: false,
      meta: noMeta,
      members: [
        { kind: 'typed', name: 'string', assertions: {}, admitsNull: false, meta: noMeta },
        { kind: 'typed', name: 'string', assertions: {}, admitsNull: false, meta: noMeta }
      ]
    })

    expect(isError(spelled) ? spelled.message : 'written').toContain('must be an object')
  })

  it('refuses a tagged disjunction whose member states no one value at the tag', () => {
    const spelled = spellAtd({
      kind: 'exactlyOne',
      discriminant: 'kind',
      admitsNull: false,
      meta: noMeta,
      members: [
        {
          kind: 'typed',
          name: 'object',
          admitsNull: false,
          meta: noMeta,
          assertions: {
            properties: new Map([
              [
                'kind',
                {
                  term: {
                    kind: 'typed',
                    name: 'string',
                    assertions: {},
                    admitsNull: false,
                    meta: noMeta
                  },
                  required: true,
                  default: undefined
                }
              ]
            ]),
            rest: { allows: 'anything' }
          }
        },
        {
          kind: 'typed',
          name: 'object',
          admitsNull: false,
          meta: noMeta,
          assertions: { properties: new Map(), rest: { allows: 'anything' } }
        }
      ]
    })

    expect(isError(spelled) ? spelled.message : 'written').toContain(
      'nothing to key the mapping by'
    )
  })
})

describe('one document from three validators', () => {
  it('writes the same ATD for a value written three ways', () => {
    const expected = {
      properties: { name: { type: 'string' } },
      optionalProperties: { age: { type: 'float64' } }
    }

    const fromZod = description(
      z.object({ name: z.string(), age: z.number().optional() }),
      zodSource,
      'input'
    )
    const fromArk = description(
      type({ name: 'string', 'age?': 'number' }) as unknown as Parameters<
        typeof arktypeSource.read
      >[0],
      arktypeSource,
      'input'
    )
    const fromEffect = description(
      Schema.Struct({ name: Schema.String, age: Schema.optional(Schema.Number) }).ast,
      effectSource,
      'input'
    )

    for (const described of [fromZod, fromArk, fromEffect]) {
      if (isError(described)) {
        throw new Error(described.message)
      }
      const spelled = spellAtd(described.term)
      if (isError(spelled)) {
        throw new Error(spelled.message)
      }
      expect(spelled.written).toEqual(expected)
    }
  })
})

describe('what a schema says about itself, of which ATD has a word for two', () => {
  it('writes a description and a deprecation under metadata, where arri keeps a name', () => {
    expect(
      atdOf(z.string().meta({ description: 'who they are', deprecated: true })).written
    ).toEqual({
      type: 'string',
      metadata: { description: 'who they are', isDeprecated: true }
    })
  })

  it('reports a title and examples, which change nothing about what a reader accepts', () => {
    const spelled = atdOf(z.string().meta({ title: 'Name', examples: ['ada'] }))

    // Neither direction. ATD has no keyword for either, and a document without them accepts exactly
    // what one with them accepts, so this is a loss to report rather than a refusal.
    expect(spelled.departures.map((one) => one.direction)).toEqual(['neither', 'neither'])
    expect(spelled.departures.map((one) => one.said.slice(0, 20))).toEqual([
      'this states a title,',
      'this states examples'
    ])
    // Neither word reaches the document, which the comparison states by holding the whole value.
    expect(spelled.written).toEqual({ type: 'string' })
  })

  it('keeps a description beside the name a definition is filed under', () => {
    const User = z.object({ id: z.string() }).meta({ id: 'User', description: 'a person' })
    const described = description(User, zodSource, 'input')
    if (isError(described)) {
      throw new Error(described.message)
    }

    const spelled = spellAtdAll(described)
    if (isError(spelled)) {
      throw new Error(spelled.message)
    }

    expect(spelled.written.definitions['User']?.metadata).toEqual({
      id: 'User',
      description: 'a person'
    })
  })
})
