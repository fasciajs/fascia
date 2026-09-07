import type { Described, Describing, Description } from '@fasciajs/core'
import { admits, describe as description, isError, UndecidedAdmission } from '@fasciajs/core'
import { zodSource } from '@fasciajs/zod'
import { describe, expect, it } from 'vitest'
import * as z from 'zod'

/** A term that admits what its schema refuses is not a term of that schema. */
function described(describing: Describing): Description {
  if (isError(describing)) {
    throw new Error(`the schema could not be described: ${describing.message}`)
  }
  return describing
}

const fromZod = (schema: z.core.$ZodType) => described(description(schema, zodSource, 'input'))

/** A description written here, for the two cases no frontend produces. */
const standing = (term: Described, definitions: readonly [string, Described][]): Description => ({
  term,
  definitions: new Map(definitions)
})

const aString: Described = {
  kind: 'typed',
  name: 'string',
  assertions: {},
  admitsNull: false,
  meta: {}
}

describe('a term admits what the schema it was read from admits', () => {
  it('agrees with zod over every value, on the whole table rather than on one', () => {
    const User = z.object({
      id: z.string().min(2),
      age: z.number().int().min(0),
      tags: z.array(z.string()).max(2)
    })
    const term = fromZod(User)

    const values: readonly unknown[] = [
      { id: 'ab', age: 0, tags: [] },
      { id: 'ab', age: 3, tags: ['x', 'y'] },
      { id: 'a', age: 3, tags: [] },
      { id: 'ab', age: -1, tags: [] },
      { id: 'ab', age: 1.5, tags: [] },
      { id: 'ab', age: 3, tags: ['x', 'y', 'z'] },
      { id: 'ab', age: 3, tags: [1] },
      { id: 'ab', age: 3 },
      null,
      'ab',
      []
    ]

    expect(values.map((value) => admits(term, value))).toEqual(
      values.map((value) => User.safeParse(value).success)
    )
  })

  it('refuses a list shorter than the positions the tuple demands', () => {
    // This once admitted the shorter list, and was right about a term that stated no length.
    const term = fromZod(z.tuple([z.string()]))

    expect(admits(term, [])).toBe(false)
    expect(admits(term, ['a'])).toBe(true)
    expect(admits(term, [4])).toBe(false)
  })

  it('admits a shorter list exactly where the tuple lets a position be absent', () => {
    const term = fromZod(z.tuple([z.string(), z.number().optional()]))

    expect(admits(term, ['a'])).toBe(true)
    expect(admits(term, [])).toBe(false)
    expect(admits(term, ['a', 1])).toBe(true)
  })

  it('admits a value nested under a name the schema holds itself by', () => {
    const Tree: z.ZodType = z
      .lazy(() => z.object({ name: z.string(), children: z.array(Tree) }))
      .meta({ id: 'Tree' })
    const term = fromZod(Tree)

    expect(admits(term, { name: 'a', children: [{ name: 'b', children: [] }] })).toBe(true)
    expect(admits(term, { name: 'a', children: [{ name: 1, children: [] }] })).toBe(false)
  })
})

describe('a term that states what this does not decide reports no verdict', () => {
  it('reports no verdict for a format, rather than admitting the value', () => {
    // zod states an email as a pattern and a format at once, and the pattern decides the first.
    const term = fromZod(z.email())

    expect(admits(term, 'not-an-email')).toBe(false)
    expect(admits(term, 'a@b.com')).toBeInstanceOf(UndecidedAdmission)
  })

  it('refuses a value the term already refuses, where a format is stated beside', () => {
    const term = fromZod(z.email())

    expect(admits(term, 4)).toBe(false)
  })

  it('reports no verdict for a name that stands for nothing', () => {
    const term = standing({ kind: 'ref', name: 'Missing', admitsNull: false, meta: {} }, [])

    expect(admits(term, 'a')).toBeInstanceOf(UndecidedAdmission)
  })

  it('reports no verdict where a name reaches itself with no value between', () => {
    const self: Described = {
      kind: 'some',
      members: [
        { kind: 'ref', name: 'Loop', admitsNull: false, meta: {} },
        { kind: 'typed', name: 'string', assertions: {}, admitsNull: false, meta: {} }
      ],
      admitsNull: false,
      meta: {}
    }
    const term = standing({ kind: 'ref', name: 'Loop', admitsNull: false, meta: {} }, [
      ['Loop', self]
    ])

    expect(admits(term, 'a')).toBe(true)
    expect(admits(term, 4)).toBeInstanceOf(UndecidedAdmission)
  })
})

describe('a set admits a value with no order and no repeat', () => {
  it('refuses a value held twice, and takes the same values in another order', () => {
    // The half a value can be asked about. No single value shows that a position is not part of it.
    const term = standing({ kind: 'set', items: aString, admitsNull: false, meta: {} }, [])

    expect(admits(term, ['a', 'b'])).toBe(true)
    expect(admits(term, ['b', 'a'])).toBe(true)
    expect(admits(term, ['a', 'a'])).toBe(false)
    expect(admits(term, ['a', 1])).toBe(false)
  })
})

describe('a combination admits what its law says', () => {
  it('refuses a value two members of an exclusive combination take', () => {
    const term = standing(
      {
        kind: 'exactlyOne',
        members: [aString, aString],
        discriminant: undefined,
        admitsNull: false,
        meta: {}
      },
      []
    )

    expect(admits(term, 'a')).toBe(false)
    expect(admits(term, 4)).toBe(false)
  })
})
