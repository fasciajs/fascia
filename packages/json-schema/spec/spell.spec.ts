import { spellAtd, spellAtdAll } from '@fasciajs/atd'
import type { Described } from '@fasciajs/core'
import { describe as description, isError } from '@fasciajs/core'
import { spellJsonSchema, spellJsonSchemaAll } from '@fasciajs/json-schema'
import { zodSource } from '@fasciajs/zod'
import { describe, expect, it } from 'vitest'
import * as z from 'zod'

function termOf(schema: z.core.$ZodType): Described {
  const described = description(schema, zodSource, 'input')
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

/** A set, stated as a term: no reading produces one, and every target has to answer about one. */
const aSetOf = (items: Described): Described => ({
  kind: 'set',
  items,
  admitsNull: false,
  meta: {}
})

const aString: Described = {
  kind: 'typed',
  name: 'string',
  assertions: {},
  admitsNull: false,
  meta: {}
}

describe('a value with no order is written as the nearest thing that has one', () => {
  it('writes the half a document can state, and says the half it cannot', () => {
    const spelled = spellJsonSchema(aSetOf(aString))
    if (isError(spelled)) {
      throw new Error(spelled.message)
    }

    // `uniqueItems` is the half 2020-12 states. An array has an order and a set does not, and no
    // keyword removes one, so the document accepts the same values and gives back one more fact.
    expect(spelled.written).toEqual({ type: 'array', items: { type: 'string' }, uniqueItems: true })
    expect(spelled.departures).toEqual([
      {
        at: [],
        direction: 'neither',
        cause: 'noWordForIt',
        said: 'this states a value with no order, and 2020-12 writes an array, which has one. The document accepts the same values, and a reader gives back an order the schema never stated.'
      }
    ])
  })

  it('gives up both halves in ATD, and each in its own direction', () => {
    const spelled = spellAtd(aSetOf(aString))
    if (isError(spelled)) {
      throw new Error(spelled.message)
    }

    expect(spelled.written).toEqual({ elements: { type: 'string' } })
    expect(spelled.departures.map((one) => one.direction)).toEqual(['wider', 'neither'])
  })
})

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
    expect(writtenOf(z.int32())).toEqual({
      type: 'integer',
      minimum: -2147483648,
      maximum: 2147483647
    })
  })

  it('writes a count on a list', () => {
    expect(writtenOf(z.array(z.string()).min(2))).toEqual({
      type: 'array',
      items: { type: 'string' },
      minItems: 2
    })
  })

  it('writes a divisor', () => {
    expect(writtenOf(z.number().multipleOf(2))).toEqual({ type: 'number', multipleOf: 2 })
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
    ).toEqual({
      allOf: [
        { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
        { type: 'object', properties: { b: { type: 'string' } }, required: ['b'] }
      ]
    })
  })

  it('writes an enum that admits something other than strings', () => {
    expect(writtenOf(z.literal(1))).toEqual({ type: 'number', enum: [1] })
  })

  it('writes a tuple at its positions, and demands the ones that must be there', () => {
    // `prefixItems` says what stands at each position and nothing about how many are there, so a
    // document holding it alone accepts the empty list. `minItems` is the other half.
    expect(writtenOf(z.tuple([z.string(), z.number()]))).toEqual({
      type: 'array',
      prefixItems: [{ type: 'string' }, { type: 'number' }],
      minItems: 2,
      items: false
    })
  })

  it('demands only the positions that must be there, where one may be absent', () => {
    // zod states an optional position by wrapping it, and every optional one trails, so the count
    // is what both zod and a document mean by it.
    expect(writtenOf(z.tuple([z.string(), z.number().optional()]))).toEqual({
      type: 'array',
      prefixItems: [{ type: 'string' }, { type: 'number' }],
      minItems: 1,
      items: false
    })
  })

  it('gives nothing up writing a tuple, where it used to report a widening', () => {
    const spelled = spellJsonSchema(termOf(z.tuple([z.string()])))
    if (isError(spelled)) {
      throw new Error(spelled.message)
    }

    // The term carries how many positions must be present, so the document states it and the
    // widening is gone rather than reported.
    expect(spelled.departures).toEqual([])
  })
})

describe('nullability is one fact and each target has its own word', () => {
  it('names null as a type beside the one it widens', () => {
    expect(writtenOf(z.string().nullable())).toEqual({ type: ['string', 'null'] })
  })

  it('states it beside the values of an enum, because a flag would not widen one', () => {
    // Null reaches the values, which is the claim here. The type beside them carries it as well,
    // because a type refuses null on its own and would turn away a value the list admits.
    expect(writtenOf(z.enum(['a', 'b']).nullable())).toEqual({
      type: ['string', 'null'],
      enum: ['a', 'b', null]
    })
  })

  it('joins a disjunction to null, having no type of its own to widen', () => {
    expect(writtenOf(z.union([z.string(), z.number()]).nullable())).toEqual({
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

    expect(spelled.written).toEqual({
      oneOf: [
        {
          type: 'object',
          properties: { kind: { type: 'string', enum: ['a'] } },
          required: ['kind']
        },
        {
          type: 'object',
          properties: { kind: { type: 'string', enum: ['b'] } },
          required: ['kind']
        }
      ]
    })
    expect(spelled.departures[0]).toEqual({
      at: [],
      direction: 'neither',
      cause: 'noWordForIt',
      said: expect.stringContaining('the disjunction states it')
    })
  })

  it('writes a default, which ATD has no keyword for', () => {
    expect(writtenOf(z.object({ a: z.string().default('x') }))).toEqual({
      type: 'object',
      properties: { a: { type: 'string', default: 'x' } }
    })
  })
})

describe('a description reaches a document, definitions and all', () => {
  const Tree: z.ZodType = z
    .lazy(() => z.object({ name: z.string(), children: z.array(Tree) }))
    .meta({ id: 'Tree' })

  function describedTree() {
    const described = description(Tree, zodSource, 'input')
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

    expect(spelled.written).toEqual({
      $ref: '#/$defs/Tree',
      $defs: {
        Tree: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            children: { type: 'array', items: { $ref: '#/$defs/Tree' } }
          },
          required: ['name', 'children']
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
    expect(spelled.written.definitions['Tree']).toEqual({
      properties: {
        name: { type: 'string' },
        children: { elements: { ref: 'Tree' } }
      },
      metadata: { id: 'Tree' }
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

describe('what a schema says about itself, which 2020-12 has a word for all of', () => {
  it('writes all four beside what the term states', () => {
    expect(
      writtenOf(
        z
          .string()
          .min(2)
          .meta({
            title: 'Name',
            description: 'who they are',
            examples: ['ada'],
            deprecated: true
          })
      )
    ).toEqual({
      type: 'string',
      minLength: 2,
      title: 'Name',
      description: 'who they are',
      examples: ['ada'],
      deprecated: true
    })
  })

  it('writes them outside a nullable, which is where they are about the whole value', () => {
    expect(writtenOf(z.union([z.string(), z.number()]).nullable().describe('D'))).toEqual({
      anyOf: [{ anyOf: [{ type: 'string' }, { type: 'number' }] }, { type: 'null' }],
      description: 'D'
    })
  })
})
