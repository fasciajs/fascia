import type { Described, Describing, Description } from '@fasciajs/core'
import { admits, describe as description, isError } from '@fasciajs/core'
import { jsonSchemaAt, jsonSchemaSource, spellJsonSchemaAll } from '@fasciajs/json-schema'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'
import { describe, expect, it } from 'vitest'
import * as z from 'zod'

/**
 * A document, read back into the term it was written from.
 *
 * The one frontend here that reads a document. A validator that writes its own 2020-12 becomes a
 * frontend through this one, and what this library writes it can read.
 */
function described(describing: Describing): Description {
  if (isError(describing)) {
    throw new Error(`the document could not be described: ${describing.message}`)
  }
  return describing
}

const termOf = (document: JSONSchema): Described =>
  described(description(jsonSchemaAt(document), jsonSchemaSource, 'input')).term

const wholeOf = (document: JSONSchema): Description =>
  described(description(jsonSchemaAt(document), jsonSchemaSource, 'input'))

describe('a document states what a term states', () => {
  it('reads a string and every assertion beside it', () => {
    expect(
      termOf({ type: 'string', minLength: 2, maxLength: 5, pattern: '^a', format: 'email' })
    ).toEqual({
      kind: 'typed',
      name: 'string',
      assertions: { minLength: 2, maxLength: 5, patterns: ['^a'], format: 'email' },
      admitsNull: false,
      meta: {}
    })
  })

  it('reads a whole number as a number that is whole', () => {
    expect(termOf({ type: 'integer', minimum: 1 })).toEqual({
      kind: 'typed',
      name: 'number',
      assertions: { integer: true, minimum: { value: 1, exclusive: false } },
      admitsNull: false,
      meta: {}
    })
  })

  it('reads a type list as the type it names and the null beside it', () => {
    expect(termOf({ type: ['string', 'null'] })).toEqual({
      kind: 'typed',
      name: 'string',
      assertions: {},
      admitsNull: true,
      meta: {}
    })
  })

  it('reads a tuple and how many of its positions must be present', () => {
    const term = termOf({
      type: 'array',
      prefixItems: [{ type: 'string' }, { type: 'number' }],
      minItems: 2,
      items: false
    })

    expect(term.kind).toBe('tuple')
    expect(term).toMatchObject({ minPositions: 2, rest: { allows: 'nothing' } })
  })

  it('states that nothing must be present where a document states no count', () => {
    // `prefixItems` alone accepts the empty list, so a term reading one demands nothing.
    expect(termOf({ type: 'array', prefixItems: [{ type: 'string' }] })).toMatchObject({
      kind: 'tuple',
      minPositions: 0
    })
  })

  it('reads items that do not repeat as a set', () => {
    // This library writes a set as exactly this document, so reading it back is the round trip.
    expect(termOf({ type: 'array', items: { type: 'string' }, uniqueItems: true })).toMatchObject({
      kind: 'set'
    })
  })

  it('reads a reference under the name it points at', () => {
    const whole = wholeOf({
      $ref: '#/$defs/User',
      $defs: { User: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } }
    })

    expect(whole.term).toEqual({ kind: 'ref', name: 'User', admitsNull: false, meta: {} })
    expect([...whole.definitions.keys()]).toEqual(['User'])
  })

  it('reads a document that holds itself', () => {
    const whole = wholeOf({
      $ref: '#/$defs/Tree',
      $defs: {
        Tree: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            children: { type: 'array', items: { $ref: '#/$defs/Tree' } }
          },
          required: ['name']
        }
      }
    })

    expect(whole.term).toEqual({ kind: 'ref', name: 'Tree', admitsNull: false, meta: {} })
    expect([...whole.definitions.keys()]).toEqual(['Tree'])
  })

  it('refuses a schema that admits no value', () => {
    const refusal = description(jsonSchemaAt(false), jsonSchemaSource, 'input')

    expect(isError(refusal) ? refusal.message : 'described').toContain('admits no value')
  })
})

describe('a validator that writes its own document becomes a frontend', () => {
  it('reads what zod writes through the standard interface', () => {
    // `~standard.jsonSchema` is the interface a validator states its own document through. Read
    // here, a validator that implements it needs no reading of its internals at all.
    const User = z.object({ id: z.string(), age: z.number().min(0) })
    const document = User['~standard'].jsonSchema.input({ target: 'draft-2020-12' })

    expect(termOf(document as JSONSchema)).toMatchObject({
      kind: 'typed',
      name: 'object'
    })
    expect(admits(wholeOf(document as JSONSchema), { id: 'a', age: 1 })).toBe(true)
    expect(admits(wholeOf(document as JSONSchema), { id: 'a', age: -1 })).toBe(false)
  })
})

describe('what this library writes, it reads', () => {
  const documents: readonly [string, JSONSchema][] = [
    ['a string', { type: 'string', minLength: 2 }],
    ['a whole number', { type: 'integer', maximum: 9 }],
    ['an object', { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] }],
    ['a list', { type: 'array', items: { type: 'number' }, minItems: 1 }],
    ['a set', { type: 'array', items: { type: 'string' }, uniqueItems: true }],
    ['a tuple', { type: 'array', prefixItems: [{ type: 'string' }], minItems: 1, items: false }],
    ['a disjunction', { anyOf: [{ type: 'string' }, { type: 'number' }] }],
    ['an enum', { type: 'string', enum: ['a', 'b'] }]
  ]

  for (const [what, document] of documents) {
    it(`writes ${what} back as the document it was read from`, () => {
      const spelled = spellJsonSchemaAll(wholeOf(document))
      if (isError(spelled)) {
        throw new Error(spelled.message)
      }

      expect(spelled.written).toEqual(document)
    })
  }
})
