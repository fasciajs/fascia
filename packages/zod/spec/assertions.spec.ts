import type { Node } from '@fasciajs/core'
import { isError } from '@fasciajs/core'
import { ReadZodChecks, zodSource } from '@fasciajs/zod'
import { describe, expect, it } from 'vitest'
import * as z from 'zod'

/** The assertions a schema reads as, or a failure if the schema reads as nothing. */
function assertionsOf(schema: z.core.$ZodType): unknown {
  const node: Node<z.core.$ZodType> | Error = zodSource.read(schema)
  if (isError(node)) {
    throw new Error(`the schema read as nothing: ${node.message}`)
  }
  if (node.kind === 'scalar') {
    return node.assertions
  }
  if (node.kind === 'structural' && node.of === 'list') {
    return node.assertions
  }
  throw new Error(`a ${node.kind} states no assertions`)
}

/**
 * One schema per read check, so a name in the list is held to an assertion that arrives.
 *
 * A check filed as read and producing nothing is the failure this pairs with the compile-time
 * assertion. That one reports a check nobody classified. This one reports a check classified as read
 * and then not read.
 */
const aSchemaPerReadCheck: Record<ReadZodChecks, [z.core.$ZodType, object]> = {
  greater_than: [z.number().gt(1), { minimum: { value: 1, exclusive: true } }],
  less_than: [z.number().lt(9), { maximum: { value: 9, exclusive: true } }],
  multiple_of: [z.number().multipleOf(2), { multipleOf: 2 }],
  number_format: [z.int(), { integer: true }],
  bigint_format: [z.bigint().min(1n), { minimum: { value: 1n, exclusive: false } }],
  min_length: [z.string().min(2), { minLength: 2 }],
  max_length: [z.string().max(4), { maxLength: 4 }],
  length_equals: [z.string().length(3), { minLength: 3, maxLength: 3 }],
  string_format: [z.email(), { format: 'email' }]
}

describe('a check filed as read reaches an assertion', () => {
  for (const name of ReadZodChecks) {
    it(`reads ${name}`, () => {
      const [schema, expected] = aSchemaPerReadCheck[name]
      expect(assertionsOf(schema)).toMatchObject(expected)
    })
  }
})

describe('a bound says whether the bound itself is admitted', () => {
  it('reads an inclusive bound', () => {
    expect(assertionsOf(z.number().min(1).max(9))).toEqual({
      minimum: { value: 1, exclusive: false },
      maximum: { value: 9, exclusive: false }
    })
  })

  it('reads an exclusive bound, which zod writes under its own key', () => {
    expect(assertionsOf(z.number().gt(1).lt(9))).toEqual({
      minimum: { value: 1, exclusive: true },
      maximum: { value: 9, exclusive: true }
    })
  })

  it('takes the exclusive bound where a schema states both on one side', () => {
    expect(assertionsOf(z.number().min(1).gt(2))).toMatchObject({
      minimum: { value: 2, exclusive: true }
    })
  })
})

describe('one key of the bag means three things, and the reader is chosen by the type', () => {
  it('reads a string bound as a length', () => {
    expect(assertionsOf(z.string().min(2).max(4))).toEqual({ minLength: 2, maxLength: 4 })
  })

  it('reads an array bound as a count', () => {
    expect(assertionsOf(z.array(z.string()).min(2).max(4))).toEqual({ minItems: 2, maxItems: 4 })
  })

  it('reads a number bound as a value', () => {
    expect(assertionsOf(z.number().min(2))).toEqual({ minimum: { value: 2, exclusive: false } })
  })

  it('reads a date bound as a date', () => {
    const when = new Date('2020-01-01T00:00:00.000Z')
    expect(assertionsOf(z.date().min(when))).toEqual({ minimum: { value: when, exclusive: false } })
  })
})

describe('a constraint that never appears as a check still arrives', () => {
  it('reads z.int(), which holds no check at all', () => {
    expect(z.int()._zod.def.checks).toBeUndefined()
    expect(assertionsOf(z.int())).toMatchObject({ integer: true })
  })

  it('reads z.email(), which holds no check at all', () => {
    expect(z.email()._zod.def.checks).toBeUndefined()

    // The format and the pattern both, because zod states both and the parse uses the pattern. A
    // reading that kept only the format would be wider than the schema wherever the two disagree.
    expect(assertionsOf(z.email())).toMatchObject({ format: 'email' })
    expect(assertionsOf(z.email())).toHaveProperty('patterns')
  })
})

describe('a pattern is carried as text', () => {
  it('reads the source of a regular expression', () => {
    expect(assertionsOf(z.string().regex(/^a.c$/))).toMatchObject({ patterns: ['^a.c$'] })
  })

  it('carries every pattern a schema states, because each one holds', () => {
    const both = assertionsOf(z.string().regex(/^a/).regex(/z$/)) as { patterns: string[] }
    expect(both.patterns).toHaveLength(2)
  })
})

describe('a format no document names loses the name and keeps the constraint', () => {
  it('drops the name and carries the pattern the format states', () => {
    // zod calls this `nanoid`, and no document has a word for it. Passing the name through would
    // reach a target as a keyword no reader knows. The constraint survives anyway, because zod
    // states the pattern beside the name, so nothing about the schema is lost by dropping the name.
    const nanoid = assertionsOf(z.nanoid()) as Record<string, unknown>

    expect(nanoid['format']).toBeUndefined()
    expect(nanoid['patterns']).toEqual(['^[a-zA-Z0-9_-]{21}$'])
  })

  it('keeps a name a document does have', () => {
    expect(assertionsOf(z.uuid())).toMatchObject({ format: 'uuid' })
  })
})

describe('a schema stating nothing states nothing', () => {
  it('reads an unconstrained string as no assertions at all', () => {
    expect(assertionsOf(z.string())).toEqual({})
  })
})
