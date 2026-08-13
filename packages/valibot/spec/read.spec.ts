import { describe as description, isError } from '@fasciajs/core'
import type { ValibotSchema } from '@fasciajs/valibot'
import { valibotSource } from '@fasciajs/valibot'
import * as v from 'valibot'
import { describe, expect, it } from 'vitest'

/**
 * A valibot schema, read as a `Node`.
 *
 * **The fourth frontend, and the first added after the waist grew.** `Source` gained `metaOf`, and
 * `describe` gained a side with semantics every reader has to satisfy. Nothing had implemented one
 * from scratch since, so nothing would have said whether the waist had quietly become zod-shaped.
 *
 * valibot states an assertion as a list of actions on the node itself, which is a fourth shape for
 * one fact: zod folds them into a bag, arktype keeps them beside a basis, effect wraps the schema in
 * one node per refinement.
 */

const read = (schema: v.GenericSchema) => valibotSource.read(schema as unknown as ValibotSchema)

function termOf(schema: v.GenericSchema) {
  const described = description(schema as unknown as ValibotSchema, valibotSource, 'input')
  if (isError(described)) {
    throw new Error(described.message)
  }
  return described.term
}

describe('an assertion is a list of actions rather than a shape of its own', () => {
  it('reads a bounded string off the pipe, where the node still says string', () => {
    expect(read(v.pipe(v.string(), v.minLength(2), v.maxLength(5), v.regex(/^a/)))).toMatchObject({
      kind: 'scalar',
      name: 'string',
      assertions: { minLength: 2, maxLength: 5, patterns: ['^a'] }
    })
  })

  it('reads a bound and says whether the bound itself is admitted', () => {
    expect(read(v.pipe(v.number(), v.gtValue(1), v.maxValue(9), v.integer()))).toMatchObject({
      assertions: {
        minimum: { value: 1, exclusive: true },
        maximum: { value: 9, exclusive: false },
        integer: true
      }
    })
  })

  it('reads a format from the action that states it', () => {
    expect(read(v.pipe(v.string(), v.isoDateTime()))).toMatchObject({
      assertions: { format: 'date-time' }
    })
  })
})

describe('a conversion stands in the same list as the assertions', () => {
  it('keeps what a schema checks before it converts', () => {
    // A converting schema and a checking one carry the same `type`, so the pipe is what tells them
    // apart, and the assertions before the conversion are what a caller may send.
    const node = read(
      v.pipe(
        v.string(),
        v.minLength(2),
        v.transform((value) => value.length)
      )
    )
    expect(node).toMatchObject({ kind: 'conversion', how: 'unstatedOutput' })

    expect(
      termOf(
        v.pipe(
          v.string(),
          v.minLength(2),
          v.transform((value) => value.length)
        )
      )
    ).toMatchObject({
      name: 'string',
      assertions: { minLength: 2 }
    })
  })
})

describe('a tuple means the opposite of what zod means by the word', () => {
  it('accepts what stands past the positions, because valibot drops it', () => {
    // Found by the property on its first run. `v.tuple` removes an extra element rather than
    // refusing the value, and `strictTuple` is the one that refuses.
    expect(v.safeParse(v.tuple([v.string()]), ['a', 1]).success).toBe(true)
    expect(read(v.tuple([v.string()]))).toMatchObject({ rest: { allows: 'anything' } })
  })

  it('refuses it where the schema does', () => {
    expect(read(v.strictTuple([v.string()]))).toMatchObject({ rest: { allows: 'nothing' } })
  })
})

describe('what a caller states about a schema reaches the term', () => {
  it('takes a title and a description from the actions that carry them', () => {
    expect(termOf(v.pipe(v.string(), v.title('Name'), v.description('who they are'))).meta).toEqual(
      {
        title: 'Name',
        description: 'who they are'
      }
    )
  })

  it('takes nothing from a bare schema, because valibot states nothing of its own', () => {
    expect(termOf(v.string()).meta).toEqual({})
  })

  it('names a schema from the metadata a caller attached', () => {
    const named = v.pipe(v.object({ id: v.string() }), v.metadata({ id: 'User' }))
    expect(termOf(named)).toEqual({ kind: 'ref', name: 'User', admitsNull: false, meta: {} })
  })
})

describe('an unreadable schema says why, rather than reading as something else', () => {
  it('turns away a value JSON does not carry', () => {
    const said = (schema: v.GenericSchema) => {
      const node = read(schema)
      return isError(node) ? node.message : 'read'
    }

    expect(said(v.set(v.string()))).toContain('An array of unique items is')
    expect(said(v.blob())).toContain('sent as a body')
    expect(said(v.never())).toContain('describes nothing a caller could send')
  })

  it('turns away a pattern whose flag changes what it matches', () => {
    // valibot holds the expression itself, like zod does, so the source alone states a narrower
    // pattern than the schema holds. A document carries no flag beside a pattern, and the flag is
    // gone before a term exists, so no target could report the loss.
    const node = read(v.pipe(v.string(), v.regex(/^ab$/i)))

    expect(v.safeParse(v.pipe(v.string(), v.regex(/^ab$/i)), 'AB').success).toBe(true)
    expect(isError(node) ? node.message : 'read').toContain('under the flag i')
  })

  it('reads a pattern whose flag matches nothing differently', () => {
    expect(read(v.pipe(v.string(), v.regex(/^ab$/g)))).toMatchObject({
      assertions: { patterns: ['^ab$'] }
    })
  })
})
