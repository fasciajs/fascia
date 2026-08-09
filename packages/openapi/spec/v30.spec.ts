import { describe as description, isError } from '@fasciajs/core'
import { spellJsonSchema, toV30 } from '@fasciajs/openapi'
import { zodSource } from '@fasciajs/zod'
import { describe, expect, it } from 'vitest'
import * as z from 'zod'
import { fromV30 } from './lib/reverse.js'

/**
 * The translation into 3.0, read back.
 *
 * **A translation nothing reads backwards is a claim.** 3.0 says four things another way, and each
 * of the four is reversible: a flag beside one type is a type list, a flag beside a bound is the
 * exclusive keyword. So the way back is written here, in the check rather than in the library, and
 * a schema that survives the round trip is one the translation did not quietly change.
 *
 * What does not survive is what was reported. A positional form and a list of examples have no 3.0
 * keyword, and both are named in the departures rather than being lost in silence.
 */

function roundTrip(schema: z.core.$ZodType): { there: unknown; back: unknown; said: number } {
  const described = description(schema, zodSource, 'input')
  if (isError(described)) {
    throw new Error(described.message)
  }
  const spelled = spellJsonSchema(described.term)
  if (isError(spelled)) {
    throw new Error(spelled.message)
  }

  const there = toV30(spelled.written)
  return { there: there.written, back: fromV30(there.written), said: there.departures.length }
}

describe('what 3.0 says another way, it says reversibly', () => {
  const reversible: readonly [string, z.core.$ZodType][] = [
    ['a string', z.string()],
    ['a bounded string', z.string().min(2).max(5).regex(/^a/)],
    ['a nullable string', z.string().nullable()],
    ['an exclusive bound', z.number().gt(1).lte(9)],
    ['a whole number', z.number().int()],
    ['an object', z.object({ a: z.string(), b: z.number().optional() })],
    ['a nullable object', z.object({ a: z.string() }).nullable()],
    ['a list', z.array(z.string()).min(1)],
    ['a record', z.record(z.string(), z.number())],
    ['a strict object', z.strictObject({ a: z.string() })],
    ['an enum', z.enum(['a', 'b'])],
    ['a nullable enum', z.enum(['a', 'b']).nullable()]
  ]

  for (const [what, schema] of reversible) {
    it(`says ${what} and says it back`, () => {
      const { back, said } = roundTrip(schema)
      const described = description(schema, zodSource, 'input')
      if (isError(described)) {
        throw new Error(described.message)
      }
      const spelled = spellJsonSchema(described.term)
      if (isError(spelled)) {
        throw new Error(spelled.message)
      }

      expect(back).toEqual(spelled.written)
      expect(said).toBe(0)
    })
  }
})

describe('what 3.0 cannot say, it reports rather than loses', () => {
  it('says a tuple is a list of anything a position admits, and reports it', () => {
    const { there, said } = roundTrip(z.tuple([z.string(), z.number()]))

    expect(there).toMatchObject({ items: { anyOf: [{ type: 'string' }, { type: 'number' }] } })
    expect(there).not.toHaveProperty('prefixItems')
    expect(said).toBeGreaterThan(0)
  })

  it('says one example where a term states several, and reports it', () => {
    const { there, said } = roundTrip(z.string().meta({ examples: ['a', 'b'] }))

    expect(there).toEqual({ type: 'string', example: 'a' })
    expect(said).toBe(1)
  })
})
