import { arktypeSource } from '@fasciajs/arktype'
import type { AtdSchema } from '@fasciajs/atd'
import { spellAtd } from '@fasciajs/atd'
import type { Departure, Spelled } from '@fasciajs/core'
import { describe as description, isError } from '@fasciajs/core'
import { effectSource } from '@fasciajs/effect'
import { zodSource } from '@fasciajs/zod'
import { type } from 'arktype'
import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'
import * as z from 'zod'

/** A zod schema, all the way to a document. The first thing this library does end to end. */
function atdOf(schema: z.core.$ZodType): Spelled<AtdSchema> {
  const term = description(schema, zodSource)
  if (isError(term)) {
    throw new Error(`the schema could not be described: ${term.message}`)
  }

  const spelled = spellAtd(term)
  if (isError(spelled)) {
    throw new Error(`the term could not be written: ${spelled.message}`)
  }
  return spelled
}

/** The reason ATD refuses a schema outright, for the cases where it does. */
function refusalOf(schema: z.core.$ZodType): string {
  const term = description(schema, zodSource)
  if (isError(term)) {
    throw new Error(`the schema could not be described: ${term.message}`)
  }

  const spelled = spellAtd(term)
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

    expect(spelled.written).toMatchObject({ type: 'int32' })
    expect(said(spelled.departures)).toContain('no ATD width matches')
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
      members: [
        { kind: 'typed', name: 'string', assertions: {}, admitsNull: false },
        { kind: 'typed', name: 'string', assertions: {}, admitsNull: false }
      ]
    })

    expect(isError(spelled) ? spelled.message : 'written').toContain('must be an object')
  })

  it('refuses a tagged disjunction whose member states no one value at the tag', () => {
    const spelled = spellAtd({
      kind: 'exactlyOne',
      discriminant: 'kind',
      admitsNull: false,
      members: [
        {
          kind: 'typed',
          name: 'object',
          admitsNull: false,
          assertions: {
            properties: new Map([
              [
                'kind',
                {
                  term: { kind: 'typed', name: 'string', assertions: {}, admitsNull: false },
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
      zodSource
    )
    const fromArk = description(
      type({ name: 'string', 'age?': 'number' }) as unknown as Parameters<
        typeof arktypeSource.read
      >[0],
      arktypeSource
    )
    const fromEffect = description(
      Schema.Struct({ name: Schema.String, age: Schema.optional(Schema.Number) }).ast,
      effectSource
    )

    for (const term of [fromZod, fromArk, fromEffect]) {
      if (isError(term)) {
        throw new Error(term.message)
      }
      const spelled = spellAtd(term)
      if (isError(spelled)) {
        throw new Error(spelled.message)
      }
      expect(spelled.written).toEqual(expected)
    }
  })
})
