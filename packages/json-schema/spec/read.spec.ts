import { a, schemaToJsonSchema } from '@arrirpc/schema'
import type { Described, Describing, Description } from '@fasciajs/core'
import { admits, describe as description, isError } from '@fasciajs/core'
import { jsonSchemaAt, jsonSchemaSource, spellJsonSchemaAll } from '@fasciajs/json-schema'
import { default as Ajv } from 'ajv'
import { Ajv2020 } from 'ajv/dist/2020.js'
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

describe('a library this repository never read becomes a frontend', () => {
  it('describes an arri schema through the document arri writes', () => {
    // arri states Standard Schema and writes its own document, and nothing here reads its
    // internals. `@fasciajs/atd` writes ATD and never read one, so this is a fifth library
    // described by a package that was already here.
    const User = a.object({ id: a.string(), age: a.uint32() })
    const document = schemaToJsonSchema(User) as JSONSchema

    const whole = wholeOf(document)
    expect(whole.term).toMatchObject({ kind: 'typed', name: 'object' })

    // The term agrees with arri about what arri takes.
    for (const value of [
      { id: 'a', age: 1 },
      { id: 'a', age: -1 },
      { id: 1, age: 1 }
    ]) {
      expect(admits(whole, value)).toBe(a.validate(User, value))
    }
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

/**
 * Each value's verdict, asked of the term read from a document and of Ajv over the document.
 *
 * Both sides are returned, so a test states the verdicts the business needs and that Ajv gives them.
 */
function verdictsOf(document: JSONSchema, values: readonly unknown[]) {
  const validate = new Ajv2020({ strict: false }).compile(document as object)
  const whole = wholeOf(document)

  return {
    byTerm: values.map((value) => admits(whole, value)),
    byDocument: values.map((value) => validate(value) === true)
  }
}

function refusalOf(document: JSONSchema): string {
  const refusal = description(jsonSchemaAt(document), jsonSchemaSource, 'input')
  return isError(refusal) ? refusal.message : 'described'
}

describe('a schema holds every keyword it states at once', () => {
  it('holds a disjunction to the type stated beside it', () => {
    const verdicts = verdictsOf({ type: 'string', anyOf: [{ minLength: 3 }, { pattern: '^x' }] }, [
      5,
      'xy',
      'ab',
      'abc'
    ])

    expect(verdicts).toEqual({
      byTerm: [false, true, false, true],
      byDocument: [false, true, false, true]
    })
  })

  it('conjoins two patterns written under one type', () => {
    const verdicts = verdictsOf({ type: 'string', allOf: [{ pattern: '^a' }, { pattern: 'b$' }] }, [
      5,
      'ab',
      'a'
    ])

    expect(verdicts).toEqual({ byTerm: [false, true, false], byDocument: [false, true, false] })
  })

  it('carries an assertion that names no type into the disjunction beside it', () => {
    // arktype writes a uuid as `{ anyOf: [...], format: 'uuid' }`, and every member names a type.
    const verdicts = verdictsOf(
      { anyOf: [{ type: 'string', maxLength: 3 }, { const: 'abcd' }], minLength: 2 },
      ['a', 'ab', 'abcd', 5]
    )

    expect(verdicts).toEqual({
      byTerm: [false, true, true, false],
      byDocument: [false, true, true, false]
    })
  })

  it('admits only the listed values that are of the type beside them', () => {
    const verdicts = verdictsOf({ type: 'string', enum: ['a', 1] }, ['a', 1])

    expect(verdicts).toEqual({ byTerm: [true, false], byDocument: [true, false] })
  })

  it('holds a required key that no property names to the rest of the object', () => {
    const verdicts = verdictsOf(
      { type: 'object', required: ['a'], additionalProperties: { type: 'number' } },
      [{}, { a: 1 }, { a: 'x' }]
    )

    expect(verdicts).toEqual({ byTerm: [false, true, false], byDocument: [false, true, false] })
  })

  it('holds a tuple to a count past its positions', () => {
    const verdicts = verdictsOf(
      {
        type: 'array',
        prefixItems: [{ type: 'string' }],
        items: { type: 'number' },
        minItems: 3,
        maxItems: 4
      },
      [['a'], ['a', 1, 2], ['a', 1, 2, 3], ['a', 1, 2, 3, 4], ['a', 1, 'b']]
    )

    expect(verdicts).toEqual({
      byTerm: [false, true, true, false, false],
      byDocument: [false, true, true, false, false]
    })
  })

  it('holds a value to the stricter of two bounds on one side', () => {
    const verdicts = verdictsOf({ type: 'number', minimum: 5, exclusiveMinimum: 1 }, [3, 5])

    expect(verdicts).toEqual({ byTerm: [false, true], byDocument: [false, true] })
  })
})

describe('a document the term cannot state is refused, and the refusal names why', () => {
  it('refuses an assertion that names no type, which admits every value of another type', () => {
    expect(refusalOf({ properties: { a: { type: 'string' } } })).toContain(
      'this states properties and names no type'
    )
  })

  it('refuses a keyword no term has a word for, rather than reading the rest', () => {
    expect(refusalOf({ type: 'object', minProperties: 1 })).toContain('this states minProperties')
  })

  it('refuses a reference to another document, naming the reference', () => {
    expect(refusalOf({ $ref: 'other.json#/A' })).toContain(
      'this refers to other.json#/A, which is not a place in this document'
    )
  })

  it('refuses a tuple whose counts no list meets', () => {
    expect(
      refusalOf({ type: 'array', prefixItems: [{ type: 'string' }], items: false, minItems: 2 })
    ).toContain('this needs at least 2 values and holds at most 1')
  })
})

describe('a name holding a pointer character reaches the definition it names', () => {
  it('writes a definition named with a slash back under that name', () => {
    const document: JSONSchema = {
      type: 'object',
      properties: { p: { $ref: '#/$defs/a~1b' } },
      $defs: { 'a/b': { type: 'string' } }
    }

    const spelled = spellJsonSchemaAll(wholeOf(document))
    if (isError(spelled)) {
      throw new Error(spelled.message)
    }

    expect(spelled.written).toEqual(document)
    expect(verdictsOf(spelled.written, [{ p: 'x' }, { p: 1 }])).toEqual({
      byTerm: [true, false],
      byDocument: [true, false]
    })
  })
})

describe('a draft-07 document admits what it admits in draft-07', () => {
  const DRAFT_07 = 'http://json-schema.org/draft-07/schema#'

  function draft07VerdictsOf(document: object, values: readonly unknown[]) {
    const validate = new Ajv.default({ strict: false }).compile(document)
    const whole = wholeOf(document as JSONSchema)

    return {
      byTerm: values.map((value) => admits(whole, value)),
      byDocument: values.map((value) => validate(value) === true)
    }
  }

  it('reads a list in items as positions, and additionalItems as what follows them', () => {
    const verdicts = draft07VerdictsOf(
      {
        $schema: DRAFT_07,
        type: 'array',
        items: [{ type: 'string' }],
        additionalItems: { type: 'number' }
      },
      [['a', 1], ['a', 'b'], [1]]
    )

    expect(verdicts).toEqual({ byTerm: [true, false, false], byDocument: [true, false, false] })
  })

  it('refuses an assertion beside a reference, which the draft ignores and Ajv holds', () => {
    const document = {
      $schema: DRAFT_07,
      type: 'object',
      properties: { p: { $ref: '#/definitions/A', maxLength: 1 } },
      definitions: { A: { type: 'string' } }
    }

    expect(refusalOf(document as JSONSchema)).toContain(
      'this is a draft-07 reference with an assertion beside it'
    )
  })

  it('reads a reference beside the definitions it points into', () => {
    // effect and valibot write a root that refers to a definition and holds the definitions.
    const verdicts = draft07VerdictsOf(
      { $schema: DRAFT_07, $ref: '#/definitions/A', definitions: { A: { type: 'string' } } },
      ['a', 1]
    )

    expect(verdicts).toEqual({ byTerm: [true, false], byDocument: [true, false] })
  })

  it('ignores a keyword only 2020-12 asserts by', () => {
    const verdicts = draft07VerdictsOf(
      { $schema: DRAFT_07, type: 'array', prefixItems: [{ type: 'string' }] },
      [[1], ['a']]
    )

    expect(verdicts).toEqual({ byTerm: [true, true], byDocument: [true, true] })
  })
})
