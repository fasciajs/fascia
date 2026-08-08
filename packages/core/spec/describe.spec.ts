import { attest } from '@ark/attest'
import type { Described, Node, Source } from '@fasciajs/core'
import { describe as description, isError, noMeta } from '@fasciajs/core'
import { describe, expect, it } from 'vitest'

/**
 * A source library standing in for a real one.
 *
 * The term is what every frontend produces and every target consumes, so a spec of it states the
 * tree it walks rather than importing a validator. What a real validator produces is each frontend
 * package's own spec to hold.
 */
type Named = string

function sourceOver(tree: Record<Named, Node<Named>>): Source<Named> {
  return {
    read: (name) => {
      const node = tree[name]
      if (node === undefined) {
        throw new Error(`the spec named a schema it did not define: ${name}`)
      }
      return node
    },
    nameOf: () => undefined,
    metaOf: () => noMeta
  }
}

function termOf(tree: Record<Named, Node<Named>>, root: Named = 'root'): Described {
  const described = description(root, sourceOver(tree), 'input')
  if (isError(described)) {
    throw new Error(`the schema could not be described: ${described.message}`)
  }
  return described.term
}

function failureOf(tree: Record<Named, Node<Named>>, root: Named = 'root'): string {
  const described = description(root, sourceOver(tree), 'input')
  if (!isError(described)) {
    throw new Error(`the schema was described as a ${described.term.kind}`)
  }
  return described.message
}

describe('a scalar becomes a type with what is asserted about it', () => {
  it('keeps the assertions beside the type they belong to', () => {
    expect(
      termOf({ root: { kind: 'scalar', name: 'string', assertions: { minLength: 2 } } })
    ).toEqual({
      kind: 'typed',
      name: 'string',
      assertions: { minLength: 2 },
      admitsNull: false,
      meta: {}
    })
  })

  it('describes what states nothing as stating nothing', () => {
    expect(termOf({ root: { kind: 'scalar', name: 'unknown', assertions: {} } })).toEqual({
      kind: 'untyped',
      admitsNull: false,
      meta: {}
    })
  })

  it('describes null as a value rather than as a type', () => {
    // A document names a type and null is not one of them, so a schema admitting only null admits
    // one value and says so.
    expect(termOf({ root: { kind: 'scalar', name: 'null', assertions: {} } })).toEqual({
      kind: 'values',
      admitted: [{ of: 'null' }],
      admitsNull: true,
      meta: {}
    })
  })

  it('refuses a value JSON has no form for', () => {
    expect(failureOf({ root: { kind: 'scalar', name: 'date', assertions: {} } })).toContain(
      'no JSON form'
    )
    expect(failureOf({ root: { kind: 'scalar', name: 'bigint', assertions: {} } })).toContain(
      'no JSON form'
    )
  })
})

describe('nullability is decided once, and it is a fact about the value', () => {
  it('states it on the term beneath rather than nesting a case', () => {
    expect(
      termOf({
        root: { kind: 'wrapper', how: 'nullable', inner: 'name' },
        name: { kind: 'scalar', name: 'string', assertions: { minLength: 2 } }
      })
    ).toEqual({
      kind: 'typed',
      name: 'string',
      assertions: { minLength: 2 },
      admitsNull: true,
      meta: {}
    })
  })

  it('takes a null member out of a disjunction and states it on the disjunction', () => {
    // arktype and effect write a nullable as a union holding null. Left as a member it would reach
    // a target that has to decide the same thing again, and the two answers could disagree.
    const term = termOf({
      root: {
        kind: 'combination',
        law: 'any',
        members: ['name', 'nothing'],
        discriminant: undefined
      },
      name: { kind: 'scalar', name: 'string', assertions: {} },
      nothing: { kind: 'scalar', name: 'null', assertions: {} }
    })

    expect(term).toEqual({
      kind: 'typed',
      name: 'string',
      assertions: {},
      admitsNull: true,
      meta: {}
    })
  })

  it('leaves one member as itself where the null member was the only other one', () => {
    const term = termOf({
      root: {
        kind: 'combination',
        law: 'any',
        members: ['count', 'nothing'],
        discriminant: undefined
      },
      count: { kind: 'scalar', name: 'number', assertions: { integer: true } },
      nothing: { kind: 'scalar', name: 'null', assertions: {} }
    })

    // Four validators state this four ways and the term states it once.
    expect(term.kind).toBe('typed')
    expect(term.admitsNull).toBe(true)
  })
})

describe('a combination becomes the law it was read under', () => {
  const three = {
    root: {
      kind: 'combination' as const,
      law: 'any' as const,
      members: ['a', 'b'] as [Named, Named],
      discriminant: undefined
    },
    a: { kind: 'scalar' as const, name: 'string' as const, assertions: {} },
    b: { kind: 'scalar' as const, name: 'number' as const, assertions: {} }
  }

  it('describes any of as some', () => {
    expect(termOf(three).kind).toBe('some')
  })

  it('describes exactly one of as exactlyOne, keeping the discriminant', () => {
    const term = termOf({
      ...three,
      root: { ...three.root, law: 'exactlyOne', discriminant: 'tag' }
    })

    expect(term).toMatchObject({ kind: 'exactlyOne', discriminant: 'tag' })
  })

  it('describes all of as every', () => {
    expect(termOf({ ...three, root: { ...three.root, law: 'all' } }).kind).toBe('every')
  })
})

describe('an object states on the edge what the edge was read with', () => {
  it('carries required and default through to the term', () => {
    const term = termOf({
      root: {
        kind: 'structural',
        of: 'object',
        properties: new Map([
          ['a', { schema: 'name', required: true, default: undefined }],
          ['b', { schema: 'name', required: false, default: 'x' }]
        ]),
        rest: { allows: 'nothing' }
      },
      name: { kind: 'scalar', name: 'string', assertions: {} }
    })

    if (term.kind !== 'typed' || term.name !== 'object') {
      throw new Error('the schema did not describe as an object')
    }

    expect(term.assertions.properties.get('a')).toMatchObject({ required: true })
    expect(term.assertions.properties.get('b')).toMatchObject({ required: false, default: 'x' })
  })

  it('describes a dictionary as an object that names no key', () => {
    const term = termOf({
      root: { kind: 'structural', of: 'dictionary', keys: 'name', values: 'name' },
      name: { kind: 'scalar', name: 'string', assertions: {} }
    })

    expect(term).toMatchObject({
      kind: 'typed',
      name: 'object',
      assertions: { rest: { allows: 'term' } }
    })
  })
})

describe('a conversion is described by what a caller sends', () => {
  it('describes a codec as its wire form, which travels in both directions', () => {
    const term = termOf({
      root: { kind: 'conversion', how: 'codec', wire: 'wire', value: 'inMemory' },
      wire: { kind: 'scalar', name: 'string', assertions: {} },
      inMemory: { kind: 'scalar', name: 'date', assertions: {} }
    })

    // The value side is a date, which has no JSON form. Describing it would be the invention the
    // codec exists to avoid, and the term never reaches it.
    expect(term).toMatchObject({ kind: 'typed', name: 'string' })
  })

  it('refuses a conversion that states no input', () => {
    expect(
      failureOf({
        root: { kind: 'conversion', how: 'unstatedInput', produced: 'name' },
        name: { kind: 'scalar', name: 'string', assertions: {} }
      })
    ).toContain('no schema states what a caller may send')
  })
})

describe('the term refuses what cannot be written', () => {
  it('refuses a keyword the type beside it says nothing about', () => {
    attest(() => {
      const wrong: Described = {
        kind: 'typed',
        name: 'string',
        // @ts-expect-error `multipleOf` belongs to a number.
        assertions: { multipleOf: 2 },
        admitsNull: false,
        meta: {}
      }
      return wrong
    }).type.errors("'multipleOf' does not exist in type")
  })

  it('refuses null as a type name', () => {
    attest(() => {
      const wrong: Described = {
        kind: 'typed',
        // @ts-expect-error null is a value and not a type a document names.
        name: 'null',
        assertions: {},
        admitsNull: false,
        meta: {}
      }
      return wrong
    }).type.errors('not assignable')
  })

  it('refuses a discriminant on a law whose members do not exclude each other', () => {
    attest(() => {
      const members: [Described, Described] = [
        { kind: 'untyped', admitsNull: false, meta: noMeta },
        { kind: 'untyped', admitsNull: false, meta: noMeta }
      ]
      const wrong: Described = {
        kind: 'some',
        members,
        // @ts-expect-error only exactlyOne carries a discriminant.
        discriminant: 'tag',
        admitsNull: false,
        meta: {}
      }
      return wrong
    }).type.errors('discriminant')
  })

  it('refuses a target that leaves a case unspelled', () => {
    attest(() => {
      const partial = {
        typed: () => '',
        values: () => '',
        some: () => '',
        exactlyOne: () => '',
        every: () => '',
        tuple: () => ''
      }
      // @ts-expect-error `untyped` is unspelled.
      const spelling: import('@fasciajs/core').SpellsDescribed<string> = partial
      return spelling
    }).type.errors(/missing the following properties.*ref, untyped/)
  })
})
