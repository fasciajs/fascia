import type { BaseRoot } from '@ark/schema'
import {
  ArkConstraintKinds,
  arktypeSource,
  ReadArkConstraints,
  UnreadArkConstraints
} from '@fasciajs/arktype'
import type { Node, UnreadableSchema } from '@fasciajs/core'
import { isError } from '@fasciajs/core'
import { type } from 'arktype'
import { describe, expect, it } from 'vitest'

function nodeOf(schema: unknown): Node<BaseRoot> | UnreadableSchema {
  return arktypeSource.read(schema as BaseRoot)
}

/** The node a schema reads as, with a failure reported rather than returned. */
function read(schema: unknown): Node<BaseRoot> {
  const node = nodeOf(schema)
  if (isError(node)) {
    throw new Error(`the schema read as nothing: ${node.message}`)
  }
  return node
}

/**
 * One schema per read constraint, and what the reading must state for it.
 *
 * A `Record` over the list, so a name added to the list with no witness is a compile error. This is
 * the half the compile-time assertion cannot give: that one says every constraint arktype states is
 * classified, and this one says every constraint filed as read actually reaches something.
 *
 * The five structural constraints reach a shape rather than an assertion, which is why the
 * expectation is over the whole node rather than over its assertions.
 */
const aSchemaPerReadConstraint: Record<ReadArkConstraints, [unknown, object]> = {
  min: [type('number > 1'), { assertions: { minimum: { value: 1, exclusive: true } } }],
  max: [type('number < 9'), { assertions: { maximum: { value: 9, exclusive: true } } }],
  minLength: [type('string > 2'), { assertions: { minLength: 3 } }],
  maxLength: [type('string < 9'), { assertions: { maxLength: 8 } }],
  exactLength: [type('string == 3'), { assertions: { minLength: 3, maxLength: 3 } }],
  before: [
    type('Date <= d"2030-01-01"'),
    { assertions: { maximum: { value: new Date('2030-01-01T00:00:00.000Z'), exclusive: false } } }
  ],
  after: [
    type('Date >= d"2020-01-01"'),
    { assertions: { minimum: { value: new Date('2020-01-01T00:00:00.000Z'), exclusive: false } } }
  ],
  pattern: [type('/^a.c$/'), { assertions: { patterns: ['^a.c$'] } }],
  divisor: [type('number % 2'), { assertions: { multipleOf: 2 } }],
  structure: [type({ a: 'string' }), { kind: 'structural', of: 'object' }],
  required: [type({ a: 'string' }), { kind: 'structural', of: 'object' }],
  optional: [type({ 'a?': 'string' }), { kind: 'structural', of: 'object' }],
  index: [type({ '[string]': 'number' }), { kind: 'structural', of: 'dictionary' }],
  sequence: [type('string[]'), { kind: 'structural', of: 'list' }]
}

describe('every constraint arktype states is classified', () => {
  it('files each one as read or unread, and names nothing arktype does not have', () => {
    const classified = [...ReadArkConstraints, ...Object.keys(UnreadArkConstraints)].sort()

    expect(classified).toEqual([...ArkConstraintKinds].sort())
  })

  it('names no constraint twice', () => {
    const unread: string[] = Object.keys(UnreadArkConstraints)

    expect(ReadArkConstraints.filter((name) => unread.includes(name))).toEqual([])
  })

  it('gives a reason for each one it does not read', () => {
    for (const [name, reason] of Object.entries(UnreadArkConstraints)) {
      expect(reason.length, `${name} has no reason`).toBeGreaterThan(20)
    }
  })
})

describe('a constraint filed as read reaches something', () => {
  for (const name of ReadArkConstraints) {
    it(`reads ${name}`, () => {
      const [schema, expected] = aSchemaPerReadConstraint[name]

      expect(read(schema)).toMatchObject(expected)
    })
  }

  it('states optionality on the edge, which is what the optional constraint is', () => {
    const node = read(type({ 'a?': 'string' }))
    if (node.kind !== 'structural' || node.of !== 'object') {
      throw new Error('the schema did not read as an object')
    }

    expect(node.properties.get('a')).toMatchObject({ required: false })
  })
})

/**
 * The Date bounds, which the classification is what reported.
 *
 * The reading had neither when the lists were first written. Nothing failed at the time: a caller
 * stating a Date bound reached a document accepting every Date, which is wider than the schema and
 * so passes anything that only asks whether the document is sound.
 */
describe('a Date states its bounds where arktype puts them', () => {
  it('carries the shift arktype makes, because arktype holds no exclusive Date bound', () => {
    // `Date > x` is normalised to `Date >= x plus one millisecond`, and `exclusive` is never set.
    // The shifted bound is what the schema accepts, so it is what the reading states.
    expect(read(type('Date > d"2020-01-01"'))).toMatchObject({
      assertions: { minimum: { value: new Date('2020-01-01T00:00:00.001Z'), exclusive: false } }
    })
  })

  it('states nothing for a Date with no bound', () => {
    expect(read(type('Date'))).toMatchObject({ kind: 'scalar', name: 'date', assertions: {} })
  })
})
