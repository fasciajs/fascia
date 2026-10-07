import { a, schemaToJsonSchema } from '@arrirpc/schema'
import type { Described, Describing, Description } from '@fasciajs/core'
import { admits, describe as description, isError } from '@fasciajs/core'
import type { Dialect } from '@fasciajs/json-schema'
import { jsonSchemaAt, jsonSchemaSource, spellJsonSchemaAll } from '@fasciajs/json-schema'
import { default as Ajv } from 'ajv'
import { Ajv2019 } from 'ajv/dist/2019.js'
import { Ajv2020 } from 'ajv/dist/2020.js'
import { default as AjvDraft04 } from 'ajv-draft-04'
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

/** A document, read in the dialect a test names. */
function readIn(document: unknown, dialect: Dialect): Description {
  const at = jsonSchemaAt(document, dialect)
  if (isError(at)) {
    throw new Error(`the document could not be read: ${at.message}`)
  }
  return described(description(at, jsonSchemaSource, 'input'))
}

/** A document in 2020-12, the dialect this library writes. */
const termOf = (document: JSONSchema): Described => readIn(document, '2020-12').term

const wholeOf = (document: JSONSchema): Description => readIn(document, '2020-12')

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
    expect(refusalOf(false, '2020-12')).toContain('admits no value')
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
  // The writer names its dialect, so each document it writes states one.
  const DRAFT_2020_12 = 'https://json-schema.org/draft/2020-12/schema'
  const documents: readonly [string, JSONSchema][] = [
    ['a string', { $schema: DRAFT_2020_12, type: 'string', minLength: 2 }],
    ['a whole number', { $schema: DRAFT_2020_12, type: 'integer', maximum: 9 }],
    [
      'an object',
      {
        $schema: DRAFT_2020_12,
        type: 'object',
        properties: { a: { type: 'string' } },
        required: ['a']
      }
    ],
    ['a list', { $schema: DRAFT_2020_12, type: 'array', items: { type: 'number' }, minItems: 1 }],
    [
      'a set',
      { $schema: DRAFT_2020_12, type: 'array', items: { type: 'string' }, uniqueItems: true }
    ],
    [
      'a tuple',
      {
        $schema: DRAFT_2020_12,
        type: 'array',
        prefixItems: [{ type: 'string' }],
        minItems: 1,
        items: false
      }
    ],
    ['a disjunction', { $schema: DRAFT_2020_12, anyOf: [{ type: 'string' }, { type: 'number' }] }],
    ['an enum', { $schema: DRAFT_2020_12, type: 'string', enum: ['a', 'b'] }]
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

/** Why a document is refused, at whichever step refuses it. */
function refusalOf(document: unknown, dialect: Dialect): string {
  const at = jsonSchemaAt(document, dialect)
  if (isError(at)) {
    return at.message
  }
  const refusal = description(at, jsonSchemaSource, 'input')
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
    expect(refusalOf({ properties: { a: { type: 'string' } } }, '2020-12')).toContain(
      'this states properties and names no type'
    )
  })

  it('refuses a keyword no term has a word for, rather than reading the rest', () => {
    expect(refusalOf({ type: 'object', minProperties: 1 }, '2020-12')).toContain(
      'this states minProperties'
    )
  })

  it('refuses a reference to another document, naming the reference', () => {
    expect(refusalOf({ $ref: 'other.json#/A' }, '2020-12')).toContain(
      'this refers to other.json#/A, which is not a place in this document'
    )
  })

  it('refuses a tuple whose counts no list meets', () => {
    expect(
      refusalOf(
        { type: 'array', prefixItems: [{ type: 'string' }], items: false, minItems: 2 },
        '2020-12'
      )
    ).toContain('this needs at least 2 values and holds at most 1')
  })
})

describe('a name holding a pointer character reaches the definition it names', () => {
  it('writes a definition named with a slash back under that name', () => {
    const document: JSONSchema = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
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
    const whole = readIn(document, 'draft-07')

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

    expect(refusalOf(document, 'draft-07')).toContain(
      'this is a reference with an assertion beside it, which the dialect ignores and Ajv holds'
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

  it('refuses a keyword only 2020-12 asserts by, which draft-07 ignores and Ajv may hold', () => {
    expect(
      refusalOf({ $schema: DRAFT_07, type: 'array', prefixItems: [{ type: 'string' }] }, 'draft-07')
    ).toContain('this states prefixItems, which the dialect it names does not know')
  })
})

describe('a document admits what it admits in the dialect it states', () => {
  /** Each dialect asked of the Ajv that reads it. */
  function verdictsIn(
    dialect: Dialect,
    validator: { compile: (schema: object) => (value: unknown) => unknown },
    document: object,
    values: readonly unknown[]
  ) {
    const validate = validator.compile(document)
    const whole = readIn(document, dialect)

    return {
      byTerm: values.map((value) => admits(whole, value)),
      byDocument: values.map((value) => validate(value) === true)
    }
  }

  it('reads a draft-04 exclusive bound as excluding the number beside it', () => {
    const verdicts = verdictsIn(
      'draft-04',
      new AjvDraft04.default({ strict: false }),
      {
        $schema: 'http://json-schema.org/draft-04/schema#',
        type: 'number',
        minimum: 5,
        exclusiveMinimum: true,
        maximum: 9,
        exclusiveMaximum: false
      },
      [5, 6, 9, 10]
    )

    expect(verdicts).toEqual({
      byTerm: [false, true, true, false],
      byDocument: [false, true, true, false]
    })
  })

  it('refuses a keyword draft-04 does not know, because Ajv asserts it anyway', () => {
    const document = {
      $schema: 'http://json-schema.org/draft-04/schema#',
      type: 'string',
      const: 'a'
    }

    // The draft ignores `const`, and Ajv refuses `b`. The document has no one answer.
    expect(new AjvDraft04.default({ strict: false }).compile(document)('b')).toBe(false)
    expect(refusalOf(document, 'draft-04')).toContain(
      'this states const, which the dialect it names does not know'
    )
  })

  it('refuses if and else in draft-06, which draft-07 added', () => {
    expect(
      refusalOf(
        {
          $schema: 'http://json-schema.org/draft-06/schema#',
          type: 'number',
          if: { minimum: 0 },
          else: { minimum: 100 }
        },
        'draft-06'
      )
    ).toContain('this states if, else, which the dialect it names does not know')
  })

  it('reads a 2019-09 tuple, and holds the keywords beside a reference', () => {
    const verdicts = verdictsIn(
      '2019-09',
      new Ajv2019({ strict: false }),
      {
        $schema: 'https://json-schema.org/draft/2019-09/schema',
        type: 'array',
        items: [{ $ref: '#/$defs/A', type: 'string', maxLength: 1 }],
        additionalItems: false,
        $defs: { A: { type: 'string' } }
      },
      [['a'], ['ab'], ['a', 'b'], [1]]
    )

    expect(verdicts).toEqual({
      byTerm: [true, false, false, false],
      byDocument: [true, false, false, false]
    })
  })

  it('reads OpenAPI 3.0 nullable as null joined to the one type beside it', () => {
    const verdicts = verdictsIn(
      'oas-3.0',
      new AjvDraft04.default({ strict: false }),
      { type: 'string', nullable: true },
      [null, 'a', 1]
    )

    expect(verdicts).toEqual({ byTerm: [true, true, false], byDocument: [true, true, false] })
  })

  it('holds an OpenAPI 3.0 enum beside nullable, which still refuses null', () => {
    // "Other Schema Object constraints retain their defined behavior", so null must be listed.
    const verdicts = verdictsIn(
      'oas-3.0',
      new AjvDraft04.default({ strict: false }),
      { type: 'string', nullable: true, enum: ['a'] },
      [null, 'a']
    )

    expect(verdicts).toEqual({ byTerm: [false, true], byDocument: [false, true] })
  })

  it('reads an OpenAPI 3.0 exclusive bound as excluding the number beside it', () => {
    const verdicts = verdictsIn(
      'oas-3.0',
      new AjvDraft04.default({ strict: false }),
      { type: 'number', minimum: 5, exclusiveMinimum: true },
      [5, 6]
    )

    expect(verdicts).toEqual({ byTerm: [false, true], byDocument: [false, true] })
  })

  it('refuses OpenAPI 3.0 nullable with no type beside it, which takes no effect', () => {
    expect(refusalOf({ allOf: [{ type: 'string' }], nullable: true }, 'oas-3.0')).toContain(
      'this states nullable with no type beside it'
    )
  })

  it('refuses what OpenAPI 3.0 does not support: a type list, and a keyword it never mentions', () => {
    expect(refusalOf({ type: ['string', 'null'] }, 'oas-3.0')).toContain(
      'this states a list where the dialect it names allows one schema or one type'
    )
    expect(refusalOf({ type: 'string', const: 'a' }, 'oas-3.0')).toContain(
      'this states const, which the dialect it names does not know'
    )
  })

  it('refuses a $schema in an OpenAPI 3.0 Schema Object, which names its dialect elsewhere', () => {
    expect(
      refusalOf(
        { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'string' },
        'oas-3.0'
      )
    ).toContain('this names 2020-12 in $schema, and it was read as oas-3.0')
  })

  it('refuses a boolean bound in a document that names no draft-04', () => {
    expect(refusalOf({ type: 'number', minimum: 5, exclusiveMinimum: true }, '2020-12')).toContain(
      "this states exclusiveMinimum as a boolean, which is draft-04's form"
    )
  })
})

describe('a dialect is named, never assumed', () => {
  it('refuses a document whose $schema names a dialect other than the one it is read in', () => {
    expect(
      refusalOf({ $schema: 'http://json-schema.org/draft-07/schema#', type: 'string' }, '2020-12')
    ).toContain('this names draft-07 in $schema, and it was read as 2020-12')
  })

  it('refuses a $schema that names no dialect this package reads', () => {
    expect(
      refusalOf({ $schema: 'https://example.com/my-dialect', type: 'string' }, '2020-12')
    ).toContain(
      'this names https://example.com/my-dialect in $schema, which is no dialect this package reads'
    )
  })

  it('refuses an OpenAPI 3.1 document read as plain 2020-12, because it names its own dialect', () => {
    expect(
      refusalOf(
        { $schema: 'https://spec.openapis.org/oas/3.1/dialect/base', type: 'string' },
        '2020-12'
      )
    ).toContain('this names oas-3.1 in $schema, and it was read as 2020-12')
  })

  it('reads the OpenAPI 3.1 dialect by either URI, and its discriminator changes no verdict', () => {
    for (const uri of [
      'https://spec.openapis.org/oas/3.1/dialect/base',
      'https://spec.openapis.org/oas/3.1/dialect/2024-11-10'
    ]) {
      const document = {
        $schema: uri,
        oneOf: [
          { type: 'object', properties: { kind: { const: 'a' } }, required: ['kind'] },
          { type: 'object', properties: { kind: { const: 'b' } }, required: ['kind'] }
        ],
        discriminator: { propertyName: 'kind' },
        example: { kind: 'a' }
      }

      // The dialect asserts what 2020-12 asserts, so Ajv is asked under the 2020-12 URI.
      const validate = new Ajv2020({ strict: false }).compile({
        ...document,
        $schema: 'https://json-schema.org/draft/2020-12/schema'
      })
      const whole = readIn(document, 'oas-3.1')
      const values = [{ kind: 'a' }, { kind: 'b' }, { kind: 'c' }, {}]

      expect({
        byTerm: values.map((value) => admits(whole, value)),
        byDocument: values.map((value) => validate(value) === true)
      }).toEqual({ byTerm: [true, true, false, false], byDocument: [true, true, false, false] })
    }
  })

  it('reads a $schema written with either scheme and with or without an empty fragment', () => {
    for (const uri of [
      'https://json-schema.org/draft-07/schema',
      'http://json-schema.org/draft-07/schema#'
    ]) {
      expect(readIn({ $schema: uri, type: 'string' }, 'draft-07').term).toEqual({
        kind: 'typed',
        name: 'string',
        assertions: {},
        admitsNull: false,
        meta: {}
      })
    }
  })
})
