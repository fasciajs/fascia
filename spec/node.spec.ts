import { attest } from '@ark/attest'
import type { Node, NodeFold, Source } from '@fasciajs/core'
import { foldSource, UnreadableSchema } from '@fasciajs/core'
import { describe, expect, it } from 'vitest'

/**
 * A source library standing in for a real one.
 *
 * A schema is a name and the reading is a lookup, so a spec states the tree it walks rather than
 * importing a validator to build one. Nothing here asserts what zod does.
 */
type Named = string

function sourceOver(tree: Record<Named, Node<Named> | UnreadableSchema>): Source<Named> {
  return {
    read: (name) => {
      const node = tree[name]
      if (node === undefined) {
        throw new Error(`the spec named a schema it did not define: ${name}`)
      }
      return node
    }
  }
}

/** An answer that names every leaf the walk reaches, in the order the walk reaches them. */
const reached: NodeFold<Named, string[]> = {
  scalar: (node) => [node.name],
  values: (node) => node.admitted.map((value) => value.of),
  wrapper: (node, follow) => follow(node.inner),
  structural: (node, follow) =>
    node.of === 'object' ? [...node.properties.values()].flatMap(follow) : [],
  combination: (node, follow) => node.members.flatMap(follow),
  conversion: (node, follow) => (node.how === 'codec' ? follow(node.wire) : []),
  deferred: (node, follow) => follow(node.resolve()),
  unreadable: () => ['unreadable'],
  revisited: () => ['revisited']
}

describe('foldSource reaches every child a node holds', () => {
  it('descends a wrapper, an object and a combination', () => {
    const source = sourceOver({
      root: {
        kind: 'structural',
        of: 'object',
        properties: new Map([
          ['title', 'optionalTitle'],
          ['size', 'sizeOrLabel']
        ]),
        rest: { allows: 'nothing' }
      },
      optionalTitle: { kind: 'wrapper', how: 'optional', inner: 'title' },
      title: { kind: 'scalar', name: 'string', assertions: { minLength: 1 } },
      sizeOrLabel: {
        kind: 'combination',
        law: 'any',
        members: ['size', 'label'],
        discriminant: undefined
      },
      size: { kind: 'scalar', name: 'number', assertions: { integer: true } },
      label: {
        kind: 'values',
        admitted: [{ of: 'string', value: 'small' }, { of: 'null' }]
      }
    })

    expect(foldSource('root', source, reached)).toEqual(['string', 'number', 'string', 'null'])
  })

  it('reads one schema twice where two branches share it, rather than calling it a cycle', () => {
    const source = sourceOver({
      root: {
        kind: 'combination',
        law: 'any',
        members: ['shared', 'shared'],
        discriminant: undefined
      },
      shared: { kind: 'scalar', name: 'boolean', assertions: {} }
    })

    // The ancestors of the schema in hand, not every schema seen. A set of everything seen would
    // report the second branch as a revisit and lose a member.
    expect(foldSource('root', source, reached)).toEqual(['boolean', 'boolean'])
  })
})

describe('the walk ends, and the algebra cannot make it not end', () => {
  it('answers a schema that holds itself without descending again', () => {
    const source = sourceOver({
      root: { kind: 'wrapper', how: 'nullable', inner: 'self' },
      self: { kind: 'deferred', resolve: () => 'root' }
    })

    // `deferred` descends, which is what a describer must do: a thunk is how a recursive schema is
    // written. The walk still ends, because `revisited` answers the second arrival at `root`.
    expect(foldSource('root', source, reached)).toEqual(['revisited'])
  })

  it('gives revisited no way to descend', () => {
    // Annotated, because an object literal with no type to check against checks nothing and the
    // directive below would pass by there being no error at all.
    const answers: NodeFold<Named, string[]> = {
      ...reached,
      // @ts-expect-error `revisited` receives the schema and nothing else, so a second descent
      // through this case is unrepresentable rather than merely unwise.
      revisited: (schema: Named, follow: (child: Named) => string[]) => follow(schema)
    }

    expect(typeof answers.revisited).toBe('function')
  })
})

describe('a reading may fail, and the failure is a value', () => {
  it('hands the algebra the failure instead of a node', () => {
    const source = sourceOver({
      root: { kind: 'wrapper', how: 'optional', inner: 'aPromise' },
      aPromise: new UnreadableSchema('aPromise', 'a promise is not a value a document carries')
    })

    expect(foldSource('root', source, reached)).toEqual(['unreadable'])
  })

  it('lets an answer carry the failure out, so a caller reads it without a wrapper', () => {
    const source = sourceOver({
      root: new UnreadableSchema('root', 'a function describes no value')
    })

    const orFail: NodeFold<Named, string | UnreadableSchema> = {
      ...reached,
      scalar: (node) => node.name,
      values: () => 'values',
      wrapper: (node, follow) => follow(node.inner),
      structural: () => 'structural',
      combination: () => 'combination',
      conversion: () => 'conversion',
      deferred: (node, follow) => follow(node.resolve()),
      unreadable: ({ error }) => error,
      revisited: () => 'revisited'
    }

    const answer = foldSource('root', source, orFail)

    expect(answer).toBeInstanceOf(UnreadableSchema)
  })
})

/**
 * What cannot be written, and the clause that refuses it.
 *
 * Through `attest` rather than `@ts-expect-error` alone. A directive is satisfied by any error, so a
 * rename that breaks the line for an unrelated reason leaves the directive passing while the claim
 * above it goes on describing a mechanism that may no longer do the work. `.type.errors` names the
 * clause, and it is a runtime assertion, so the claim fails in the same run as everything else.
 *
 * Matched by inclusion, so what is pinned is the part carrying the claim rather than TypeScript's
 * overload preamble, which it rewords between versions.
 */
describe('the type system holds the fold total', () => {
  it('refuses an algebra that leaves a group unanswered', () => {
    attest(() => {
      const answered = {
        scalar: () => 0,
        values: () => 0,
        wrapper: () => 0,
        structural: () => 0,
        combination: () => 0,
        conversion: () => 0,
        unreadable: () => 0,
        revisited: () => 0
      }
      // @ts-expect-error
      const incomplete: NodeFold<Named, number> = answered
      return incomplete
    }).type.errors("Property 'deferred' is missing")
  })

  it('refuses an algebra that answers every group and no failure', () => {
    attest(() => {
      const groupsOnly = {
        scalar: () => 0,
        values: () => 0,
        wrapper: () => 0,
        structural: () => 0,
        combination: () => 0,
        conversion: () => 0,
        deferred: () => 0
      }
      // @ts-expect-error
      const incomplete: NodeFold<Named, number> = groupsOnly
      return incomplete
    }).type.errors(/Type '.*' is missing the following properties.*unreadable, revisited/)
  })

  it('refuses an assertion the scalar beside it says nothing about', () => {
    attest(() => {
      // @ts-expect-error
      const wrong: Node<Named> = { kind: 'scalar', name: 'string', assertions: { multipleOf: 2 } }
      return wrong
      // The excess property, not a mismatch downstream. `multipleOf` belongs to `number`.
    }).type.errors("'multipleOf' does not exist in type")
  })

  it('refuses a combination of one member', () => {
    attest(() => {
      const lonely: Node<Named> = {
        kind: 'combination',
        law: 'any',
        // @ts-expect-error
        members: ['only'],
        discriminant: undefined
      }
      return lonely
    }).type.errors('Source has 1 element(s) but target requires 2')
  })

  it('refuses a conversion that states an input it also says is unstated', () => {
    attest(() => {
      const conflicting: Node<Named> = {
        kind: 'conversion',
        how: 'unstatedInput',
        // @ts-expect-error
        sent: 'something',
        produced: 'produced'
      }
      return conflicting
    }).type.errors("'sent' does not exist in type")
  })
})
