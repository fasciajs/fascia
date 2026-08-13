import { arktypeSource } from '@fasciajs/arktype'
import type { Describing, Description } from '@fasciajs/core'
import { describeAll, describe as description, isError } from '@fasciajs/core'
import { effectSource } from '@fasciajs/effect'
import { zodSource } from '@fasciajs/zod'
import { scope } from 'arktype'
import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'
import * as z from 'zod'

/**
 * A schema that holds itself, from three validators that name one three ways.
 *
 * The name is bound before the body is walked, so meeting the schema again yields a reference and
 * the knot ties itself. Nothing else can write a cycle down: a term is a tree, and a tree cannot
 * hold itself.
 */
function described(describing: Describing): Description {
  if (isError(describing)) {
    throw new Error(`the schema could not be described: ${describing.message}`)
  }
  return describing
}

/** The names a description refers to, and the shape of the body under each. */
function shapeOf(description: Description, name: string): string {
  const body = description.definitions.get(name)
  if (body === undefined) {
    throw new Error(`nothing was defined under ${name}`)
  }
  return body.kind === 'typed' ? `${body.kind}/${body.name}` : body.kind
}

describe('a schema that holds itself is described once and referred to', () => {
  it('describes a zod tree, named by the caller', () => {
    // zod names nothing on its own, so a caller states one. Without it there is nothing to bind.
    const Tree: z.ZodType = z
      .lazy(() => z.object({ name: z.string(), children: z.array(Tree) }))
      .meta({ id: 'Tree' })

    const result = described(description(Tree, zodSource, 'input'))

    expect(result.term).toEqual({ kind: 'ref', name: 'Tree', admitsNull: false, meta: {} })
    expect(shapeOf(result, 'Tree')).toBe('typed/object')
  })

  it('describes an arktype tree, which arktype names itself', () => {
    const types = scope({ Tree: { name: 'string', children: 'Tree[]' } }).export()
    const result = described(
      description(
        types.Tree as unknown as Parameters<typeof arktypeSource.read>[0],
        arktypeSource,
        'input'
      )
    )

    // arktype names the alias rather than the schema, so the name is found on the way down and
    // points back at what the walk began at. That schema is filed under the name when it finishes.
    expect(result.term).toEqual({ kind: 'ref', name: 'Tree', admitsNull: false, meta: {} })
    expect(shapeOf(result, 'Tree')).toBe('typed/object')
  })

  it('describes an effect tree, named by an annotation', () => {
    interface Tree {
      readonly name: string
      readonly children: readonly Tree[]
    }

    const Tree: Schema.Schema<Tree> = Schema.Struct({
      name: Schema.String,
      children: Schema.Array(Schema.suspend((): Schema.Schema<Tree> => Tree))
    }).annotations({ identifier: 'Tree' })

    const result = described(description(Tree.ast, effectSource, 'input'))

    expect(result.term).toEqual({ kind: 'ref', name: 'Tree', admitsNull: false, meta: {} })
    expect(shapeOf(result, 'Tree')).toBe('typed/object')
  })

  it('points the child at the same name the root was bound under', () => {
    const Tree: z.ZodType = z
      .lazy(() => z.object({ name: z.string(), children: z.array(Tree) }))
      .meta({ id: 'Tree' })

    const result = described(description(Tree, zodSource, 'input'))
    const body = result.definitions.get('Tree')

    if (body?.kind !== 'typed' || body.name !== 'object') {
      throw new Error('the definition is not an object')
    }

    const children = body.assertions.properties.get('children')?.term
    if (children?.kind !== 'typed' || children.name !== 'array') {
      throw new Error('children is not a list')
    }

    // The knot. The list holds the same name the whole schema was bound under.
    expect(children.assertions.items).toEqual({
      kind: 'ref',
      name: 'Tree',
      admitsNull: false,
      meta: {}
    })
  })
})

describe('a cycle with nothing to name it is refused, and says what would fix it', () => {
  it('refuses an unnamed zod cycle', () => {
    const Loop: z.ZodType = z.lazy(() => z.array(Loop))
    const describing = description(Loop, zodSource, 'input')

    expect(isError(describing) ? describing.message : 'described').toContain(
      'holds itself and nothing names it'
    )
  })
})

describe('a name is described once wherever it is used, not only in a cycle', () => {
  it('describes one named schema once and points at it twice', () => {
    const Name = z.string().min(2).meta({ id: 'Name' })
    const Pair = z.object({ first: Name, second: Name })

    const result = described(description(Pair, zodSource, 'input'))
    const body = result.term

    if (body.kind !== 'typed' || body.name !== 'object') {
      throw new Error('the schema is not an object')
    }

    const ref = { kind: 'ref', name: 'Name', admitsNull: false, meta: {} }
    expect(body.assertions.properties.get('first')?.term).toEqual(ref)
    expect(body.assertions.properties.get('second')?.term).toEqual(ref)

    // Described once, under the name, with the assertions the schema stated.
    expect(result.definitions.get('Name')).toMatchObject({
      kind: 'typed',
      name: 'string',
      assertions: { minLength: 2 }
    })
  })
})

describe('two schemas claiming one name is refused, not silently merged', () => {
  it('refuses two different schemas under one name', () => {
    // Left alone this is the worst kind of wrong: both keys become a reference to one definition,
    // the document states one shape where the schema states two, and the document is well formed.
    const A = z.object({ kind: z.literal('a'), a: z.string() }).meta({ id: 'User' })
    const B = z.object({ kind: z.literal('b'), b: z.number() }).meta({ id: 'User' })

    const describing = description(z.object({ first: A, second: B }), zodSource, 'input')

    expect(isError(describing) ? describing.message : 'described').toContain(
      'two different schemas are named User'
    )
  })

  it('shares one name across two schemas that describe the same thing', () => {
    // Two objects, one shape. A validator rebuilding a schema is not a collision, so this is a
    // comparison of what they describe rather than of which object they are.
    const first = z.string().min(2).meta({ id: 'Name' })
    const second = z.string().min(2).meta({ id: 'Name' })

    const describing = description(z.object({ a: first, b: second }), zodSource, 'input')
    if (isError(describing)) {
      throw new Error(describing.message)
    }

    expect([...describing.definitions.keys()]).toEqual(['Name'])
  })

  it('describes a use of a shared name, because a sentence is not a second shape', () => {
    // The idiom a service reaches for: one shared type, and a description of this use of it. A
    // factory returns a fresh object each call, so the two claim one name and are not one object.
    // Compared with what each says about itself set aside, the two are one shape, and the sentence
    // the second adds stands on the reference.
    const first = z.string().min(2).meta({ id: 'Name' })
    const second = z.string().min(2).meta({ id: 'Name', description: 'the name this caller sends' })

    const result = described(description(z.object({ a: first, b: second }), zodSource, 'input'))
    const body = result.term
    if (body.kind !== 'typed' || body.name !== 'object') {
      throw new Error('the schema is not an object')
    }

    expect(body.assertions.properties.get('a')?.term).toEqual({
      kind: 'ref',
      name: 'Name',
      admitsNull: false,
      meta: {}
    })
    expect(body.assertions.properties.get('b')?.term).toEqual({
      kind: 'ref',
      name: 'Name',
      admitsNull: false,
      meta: { description: 'the name this caller sends' }
    })

    // One definition, and it says nothing this caller said about their use of it.
    expect([...result.definitions.keys()]).toEqual(['Name'])
    expect(result.definitions.get('Name')?.meta).toEqual({})
  })

  it('says a word once where the two schemas already agree about it', () => {
    // Both state the same sentence, so the reference states nothing. A reference and the schema it
    // names both carrying one sentence say what one says.
    const said = { id: 'Name', description: 'a name' }
    const result = described(
      description(
        z.object({ a: z.string().meta(said), b: z.string().meta(said) }),
        zodSource,
        'input'
      )
    )

    const body = result.term
    if (body.kind !== 'typed' || body.name !== 'object') {
      throw new Error('the schema is not an object')
    }

    expect(body.assertions.properties.get('b')?.term).toMatchObject({ meta: {} })
    expect(result.definitions.get('Name')?.meta).toEqual({ description: 'a name' })
  })

  it('refuses a name claimed while the first is still being described', () => {
    const Outer: z.ZodType = z
      .lazy(() => z.object({ inner: z.string().meta({ id: 'Shared' }) }))
      .meta({ id: 'Shared' })

    const describing = description(Outer, zodSource, 'input')

    expect(isError(describing) ? describing.message : 'described').toContain(
      'still being described'
    )
  })
})

describe('a name is scoped to one description, and holds across every root in it', () => {
  it('describes one named schema once across two roots', () => {
    const User = z.object({ id: z.string() }).meta({ id: 'User' })

    const described = describeAll(
      [
        { schema: z.object({ author: User }), io: 'input' },
        { schema: z.array(User), io: 'input' }
      ],
      zodSource,
      { sides: { input: (name) => `${name}Input`, output: (name) => `${name}Output` } }
    )
    if (isError(described)) {
      throw new Error(described.message)
    }

    // One definition, reached from both roots. A document holds several schemas and one set of
    // names, which is why the scope is the call rather than the schema.
    expect([...described.definitions.keys()]).toEqual(['User'])
    expect(described.terms).toHaveLength(2)
  })

  it('refuses two roots that disagree about a name', () => {
    const A = z.object({ a: z.string() }).meta({ id: 'Thing' })
    const B = z.object({ b: z.number() }).meta({ id: 'Thing' })

    const described = describeAll(
      [
        { schema: A, io: 'input' },
        { schema: B, io: 'input' }
      ],
      zodSource,
      { sides: { input: (name) => `${name}Input`, output: (name) => `${name}Output` } }
    )

    expect(isError(described) ? described.message : 'described').toContain(
      'two different schemas are named Thing'
    )
  })

  it('lets two descriptions disagree, because a name belongs to a document', () => {
    const A = z.object({ a: z.string() }).meta({ id: 'Thing' })
    const B = z.object({ b: z.number() }).meta({ id: 'Thing' })

    // The same name, two documents, no contradiction. A reading could not allow this: zod keeps its
    // names in a registry that outlives every document.
    for (const one of [A, B]) {
      const described = description(one, zodSource, 'input')
      expect(isError(described) ? 'refused' : [...described.definitions.keys()]).toEqual(['Thing'])
    }
  })
})
