import { spellAtd, spellAtdAll } from '@fasciajs/atd'
import type { Described } from '@fasciajs/core'
import { describe as description, isError } from '@fasciajs/core'
import { spellJsonSchema, spellJsonSchemaAll } from '@fasciajs/json-schema'
import { zodSource } from '@fasciajs/zod'
import { describe, expect, it } from 'vitest'
import * as z from 'zod'

function termOf(schema: z.core.$ZodType): Described {
  const described = description(schema, zodSource)
  if (isError(described)) {
    throw new Error(`the schema could not be described: ${described.message}`)
  }
  return described.term
}

function writtenOf(schema: z.core.$ZodType): unknown {
  const spelled = spellJsonSchema(termOf(schema))
  if (isError(spelled)) {
    throw new Error(`the term could not be written: ${spelled.message}`)
  }
  return spelled.written
}

describe('2020-12 has a keyword for every assertion a term carries', () => {
  it('writes every string assertion, where ATD writes none of them', () => {
    expect(writtenOf(z.string().min(2).max(5).regex(/^a/))).toEqual({
      type: 'string',
      minLength: 2,
      maxLength: 5,
      pattern: '^a'
    })
  })

  it('writes a bound, and states an exclusive one under its own keyword', () => {
    expect(writtenOf(z.number().gt(1).lte(9))).toEqual({
      type: 'number',
      exclusiveMinimum: 1,
      maximum: 9
    })
  })

  it('names a whole number as a type, where ATD reads a width off the bounds', () => {
    // One fact, two words. The term says whole numbers in a range and each target picks its own.
    expect(writtenOf(z.int32())).toMatchObject({ type: 'integer', minimum: -2147483648 })
  })

  it('writes a count on a list', () => {
    expect(writtenOf(z.array(z.string()).min(2))).toMatchObject({ type: 'array', minItems: 2 })
  })

  it('writes a divisor', () => {
    expect(writtenOf(z.number().multipleOf(2))).toMatchObject({ multipleOf: 2 })
  })

  it('conjoins several patterns, because a schema states one per term and every one holds', () => {
    expect(writtenOf(z.string().regex(/^a/).regex(/z$/))).toEqual({
      allOf: [{ type: 'string', pattern: '^a' }, { pattern: 'z$' }]
    })
  })
})

describe('what ATD refuses, 2020-12 states', () => {
  it('writes a disjunction that is not chosen by a tag', () => {
    expect(writtenOf(z.union([z.string(), z.number()]))).toEqual({
      anyOf: [{ type: 'string' }, { type: 'number' }]
    })
  })

  it('writes an intersection', () => {
    expect(
      writtenOf(z.intersection(z.object({ a: z.string() }), z.object({ b: z.string() })))
    ).toMatchObject({ allOf: [{ type: 'object' }, { type: 'object' }] })
  })

  it('writes an enum that admits something other than strings', () => {
    expect(writtenOf(z.literal(1))).toEqual({ enum: [1] })
  })

  it('writes a tuple at its positions, where ATD writes a list of anything', () => {
    // No `minItems`. It would be exact where every position must be present, and a term does not
    // say which are: a validator may hold a position that admits a missing value, and zod does.
    // A tuple of one `unknown` accepts the empty list, and demanding the prefix refused it.
    expect(writtenOf(z.tuple([z.string(), z.number()]))).toEqual({
      type: 'array',
      prefixItems: [{ type: 'string' }, { type: 'number' }],
      items: false
    })
  })

  it('says that a shorter list is admitted, rather than leaving the widening silent', () => {
    const spelled = spellJsonSchema(termOf(z.tuple([z.string()])))
    if (isError(spelled)) {
      throw new Error(spelled.message)
    }

    expect(spelled.departures[0]).toMatchObject({ direction: 'wider' })
    expect(spelled.departures[0]?.said).toContain('does not say which of them must be present')
  })
})

describe('nullability is one fact and each target has its own word', () => {
  it('names null as a type beside the one it widens', () => {
    expect(writtenOf(z.string().nullable())).toEqual({ type: ['string', 'null'] })
  })

  it('states it beside the values of an enum, because a flag would not widen one', () => {
    expect(writtenOf(z.enum(['a', 'b']).nullable())).toEqual({ enum: ['a', 'b', null] })
  })

  it('joins a disjunction to null, having no type of its own to widen', () => {
    expect(writtenOf(z.union([z.string(), z.number()]).nullable())).toMatchObject({
      anyOf: [{ anyOf: [{ type: 'string' }, { type: 'number' }] }, { type: 'null' }]
    })
  })
})

describe('what this target gives up, which is almost nothing', () => {
  it('reports the property a source chose to tell members apart', () => {
    const spelled = spellJsonSchema(
      termOf(
        z.discriminatedUnion('kind', [
          z.object({ kind: z.literal('a') }),
          z.object({ kind: z.literal('b') })
        ])
      )
    )
    if (isError(spelled)) {
      throw new Error(spelled.message)
    }

    expect(spelled.written).toMatchObject({ oneOf: [{ type: 'object' }, { type: 'object' }] })
    expect(spelled.departures[0]).toMatchObject({ direction: 'neither' })
    expect(spelled.departures[0]?.said).toContain('the disjunction states it')
  })

  it('writes a default, which ATD has no keyword for', () => {
    expect(writtenOf(z.object({ a: z.string().default('x') }))).toMatchObject({
      properties: { a: { type: 'string', default: 'x' } }
    })
  })
})

describe('a description reaches a document, definitions and all', () => {
  const Tree: z.ZodType = z
    .lazy(() => z.object({ name: z.string(), children: z.array(Tree) }))
    .meta({ id: 'Tree' })

  function describedTree() {
    const described = description(Tree, zodSource)
    if (isError(described)) {
      throw new Error(described.message)
    }
    return described
  }

  it('writes a recursive schema as a reference and a definition', () => {
    const spelled = spellJsonSchemaAll(describedTree())
    if (isError(spelled)) {
      throw new Error(spelled.message)
    }

    expect(spelled.written).toMatchObject({
      $ref: '#/$defs/Tree',
      $defs: {
        Tree: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            children: { type: 'array', items: { $ref: '#/$defs/Tree' } }
          }
        }
      }
    })
  })

  it('writes the same schema as ATD, which refers to its definitions by name alone', () => {
    // The one function in this library with no spec until now. Both targets carry a definitions
    // table, and each points at it in its own way.
    const spelled = spellAtdAll(describedTree())
    if (isError(spelled)) {
      throw new Error(spelled.message)
    }

    expect(spelled.written.root).toEqual({ ref: 'Tree' })
    expect(spelled.written.definitions['Tree']).toMatchObject({
      metadata: { id: 'Tree' },
      properties: {
        name: { type: 'string' },
        children: { elements: { ref: 'Tree' } }
      }
    })
  })
})

describe('two targets that refuse different things agree about one term', () => {
  const cases: readonly [string, z.core.$ZodType][] = [
    ['a string', z.string()],
    ['an object', z.object({ a: z.string(), b: z.number().optional() })],
    ['a list', z.array(z.boolean())],
    ['a record', z.record(z.string(), z.string())],
    ['a nullable', z.string().nullable()],
    ['an enum of strings', z.enum(['a', 'b'])]
  ]

  for (const [what, schema] of cases) {
    it(`writes ${what} in both`, () => {
      const term = termOf(schema)

      // The claim a second target exists to test: one term, two specifications that refuse
      // different things, and neither needs a case the other does not.
      expect(isError(spellJsonSchema(term))).toBe(false)
      expect(isError(spellAtd(term))).toBe(false)
    })
  }
})
