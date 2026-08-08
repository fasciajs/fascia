import type { ArkNode } from '@fasciajs/arktype'
import {
  ArkKinds,
  arktypeSource,
  ReadArkConstraints,
  ReadArkRoots,
  UnreadArkConstraints
} from '@fasciajs/arktype'
import { isError, type Node, type UnreadableSchema } from '@fasciajs/core'
import { type } from 'arktype'
import { describe, expect, it } from 'vitest'

function nodeOf(schema: unknown): Node<ArkNode> | UnreadableSchema {
  return arktypeSource.read(schema as ArkNode)
}

function assertionsOf(schema: unknown): Record<string, unknown> {
  const node = nodeOf(schema)
  if (isError(node)) {
    throw new Error(`the schema read as nothing: ${node.message}`)
  }
  const assertions = (node as { assertions?: Record<string, unknown> }).assertions
  if (assertions === undefined) {
    throw new Error('this node states no assertions')
  }
  return assertions
}

/**
 * The lists are held to arktype's own, at runtime as well as by the compiler.
 *
 * The compile-time assertions in `ark-kinds.ts` say a kind arktype adds is classified. These say the
 * lists name nothing arktype does not have, and that the counts have not drifted apart, which a
 * `satisfies` alone cannot report.
 */
describe('every kind arktype states is classified', () => {
  it('reads every root, so there is no unread list to keep', () => {
    expect([...ReadArkRoots].sort()).toEqual([...ArkKinds.rootKinds].sort())
  })

  it('classifies every constraint as read or unread, and neither list is longer than arktype own', () => {
    const classified = [...ReadArkConstraints, ...Object.keys(UnreadArkConstraints)].sort()

    expect(classified).toEqual([...ArkKinds.constraintKinds].sort())
  })

  it('names no kind twice', () => {
    const unread: string[] = Object.keys(UnreadArkConstraints)
    expect(ReadArkConstraints.filter((name) => unread.includes(name))).toEqual([])
  })
})

/**
 * A Date bound, which the classification is what reported.
 *
 * arktype states these as `after` and `before`, and the reading had neither. Nothing failed at the
 * time: a caller stating a Date bound reached a document that accepted every Date, which is wider
 * than the schema and so passes anything that only asks whether the document is sound.
 */
describe('a constraint filed as read reaches an assertion', () => {
  it('reads a Date lower bound, which arktype calls after', () => {
    const assertions = assertionsOf(type('Date >= d"2020-01-01"'))

    expect(assertions['minimum']).toEqual({
      value: new Date('2020-01-01T00:00:00.000Z'),
      exclusive: false
    })
  })

  it('reads a Date upper bound, which arktype calls before', () => {
    const assertions = assertionsOf(type('Date <= d"2030-01-01"'))

    expect(assertions['maximum']).toEqual({
      value: new Date('2030-01-01T00:00:00.000Z'),
      exclusive: false
    })
  })

  it('carries the shift arktype makes, because arktype holds no exclusive Date bound', () => {
    // `Date > x` is normalised to `Date >= x plus one millisecond`, and `exclusive` is never set.
    // The shifted bound is what the schema accepts, so the shifted bound is what the reading states.
    const assertions = assertionsOf(type('Date > d"2020-01-01"'))

    expect(assertions['minimum']).toEqual({
      value: new Date('2020-01-01T00:00:00.001Z'),
      exclusive: false
    })
  })

  it('states nothing for a Date with no bound', () => {
    expect(assertionsOf(type('Date'))).toEqual({})
  })
})

describe('the dispatch is total over arktype own roots', () => {
  it('turns away a node that is not a root at all', () => {
    // A constraint reached where a root belongs. arktype would not hand one over, and the reading
    // says so by name rather than matching some case by accident.
    const constraint = { kind: 'divisor', rule: 2 } as unknown as ArkNode
    const node = arktypeSource.read(constraint)

    expect(isError(node) ? node.message : 'read as something').toContain('reads no such node')
  })
})
