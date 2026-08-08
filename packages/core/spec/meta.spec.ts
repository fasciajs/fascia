import { arktypeSource } from '@fasciajs/arktype'
import type { Described, Io, Meta } from '@fasciajs/core'
import { describe as description, isError } from '@fasciajs/core'
import { effectSource } from '@fasciajs/effect'
import { zodSource } from '@fasciajs/zod'
import { type } from 'arktype'
import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'
import * as z from 'zod'

/**
 * What a schema says about itself, taken from three libraries that each state it somewhere else.
 *
 * **Two of the three write one for every schema whether a caller did or not.** A reading that took
 * whatever the field held would fill a document with a formatter's prose, and nothing about the
 * document would say where it came from. So each frontend answers with what a caller wrote, and this
 * is where that is checked against a bare schema in each of them.
 */

type ArkRoot = Parameters<typeof arktypeSource.read>[0]

function termOf(describing: ReturnType<typeof description>): Described {
  if (isError(describing)) {
    throw new Error(describing.message)
  }
  return describing.term
}

const metaFromZod = (schema: z.core.$ZodType, io: Io = 'input'): Meta =>
  termOf(description(schema, zodSource, io)).meta
const metaFromArk = (schema: unknown): Meta =>
  termOf(description(schema as ArkRoot, arktypeSource, 'input')).meta
const metaFromEffect = (schema: Schema.Schema.AnyNoContext): Meta =>
  termOf(description(schema.ast, effectSource, 'input')).meta

describe('a schema that says nothing about itself says nothing in the term', () => {
  it('takes nothing from a bare zod schema', () => {
    expect(metaFromZod(z.string())).toEqual({})
  })

  it("takes nothing from a bare arktype schema, whose description already reads 'a string'", () => {
    expect(type.raw('string').description).toBe('a string')
    expect(metaFromArk(type.raw('string'))).toEqual({})
  })

  it("takes nothing from a bare effect schema, whose annotation already reads 'a string'", () => {
    expect(metaFromEffect(Schema.String)).toEqual({})
  })

  it('takes nothing from an effect refinement, whose words are a formatter naming the filter', () => {
    // The one place a caller's own words are lost. effect writes the description and the title onto
    // the refinement node and an annotation replaces the same field, so the two cannot be told
    // apart. Carrying them would put `minLength(2)` into a document as a title.
    expect(metaFromEffect(Schema.String.pipe(Schema.minLength(2)))).toEqual({})
  })
})

describe('what a caller states reaches the term from every one of them', () => {
  it('takes a description from zod', () => {
    expect(metaFromZod(z.string().describe('who they are'))).toEqual({
      description: 'who they are'
    })
  })

  it('takes a description from arktype', () => {
    expect(metaFromArk(type.raw('string').describe('who they are'))).toEqual({
      description: 'who they are'
    })
  })

  it('takes a description from effect', () => {
    expect(metaFromEffect(Schema.String.annotations({ description: 'who they are' }))).toEqual({
      description: 'who they are'
    })
  })

  it('takes all four from zod, which states them in one call', () => {
    expect(
      metaFromZod(
        z.string().meta({ title: 'Name', description: 'D', examples: ['a'], deprecated: true })
      )
    ).toEqual({ title: 'Name', description: 'D', examples: ['a'], deprecated: true })
  })
})

describe('a word that is not one of the four stays where a caller wrote it', () => {
  it('leaves an assertion out of the term, so metadata cannot widen or narrow a document', () => {
    // zod stores this, and a bag passed through would carry a keyword across a term that holds
    // none. An assertion arriving as metadata would change what a reader accepts while every
    // departure this library reports stayed silent about it.
    expect(metaFromZod(z.string().meta({ minimum: 3, description: 'D' }))).toEqual({
      description: 'D'
    })
  })

  it('leaves out examples where one of them has no JSON form', () => {
    // All of them or none. A list with one dropped states that a caller may send the others, which
    // is a narrower claim than the schema made.
    expect(metaFromZod(z.string().meta({ examples: ['a', () => 'b'] }))).toEqual({})
  })
})

describe('a wrapper carries a caller words about the value beneath it', () => {
  it('keeps a description written on an optional property', () => {
    // The wrapper is what the term drops, and it is what a caller annotated. Reading the schema the
    // edge points at left this out of every document.
    const term = termOf(
      description(z.object({ a: z.string().optional().describe('D') }), zodSource, 'input')
    )
    if (term.kind !== 'typed' || term.name !== 'object') {
      throw new Error('the term is not an object')
    }

    expect(term.assertions.properties.get('a')?.term.meta).toEqual({ description: 'D' })
  })

  it('lets the outer word win, because it is the later one about the same value', () => {
    expect(metaFromZod(z.string().describe('inner').optional().describe('outer'))).toEqual({
      description: 'outer'
    })
  })

  it('keeps the inner word where nothing outside states one', () => {
    expect(metaFromZod(z.string().describe('inner').optional())).toEqual({
      description: 'inner'
    })
  })
})
