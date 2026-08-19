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
 * The five structural constraints reach a shape rather than an assertion. Each witness states the
 * whole node, so a reading that grows a field states the field here or the test says so.
 */
const aSchemaPerReadConstraint: Record<ReadArkConstraints, [unknown, object]> = {
  min: [
    type('number > 1'),
    { kind: 'scalar', name: 'number', assertions: { minimum: { value: 1, exclusive: true } } }
  ],
  max: [
    type('number < 9'),
    { kind: 'scalar', name: 'number', assertions: { maximum: { value: 9, exclusive: true } } }
  ],
  minLength: [type('string > 2'), { kind: 'scalar', name: 'string', assertions: { minLength: 3 } }],
  maxLength: [type('string < 9'), { kind: 'scalar', name: 'string', assertions: { maxLength: 8 } }],
  exactLength: [
    type('string == 3'),
    { kind: 'scalar', name: 'string', assertions: { minLength: 3, maxLength: 3 } }
  ],
  before: [
    type('Date <= d"2030-01-01"'),
    {
      kind: 'scalar',
      name: 'date',
      assertions: { maximum: { value: new Date('2030-01-01T00:00:00.000Z'), exclusive: false } }
    }
  ],
  after: [
    type('Date >= d"2020-01-01"'),
    {
      kind: 'scalar',
      name: 'date',
      assertions: { minimum: { value: new Date('2020-01-01T00:00:00.000Z'), exclusive: false } }
    }
  ],
  pattern: [
    type('/^a.c$/'),
    { kind: 'scalar', name: 'string', assertions: { patterns: ['^a.c$'] } }
  ],
  divisor: [type('number % 2'), { kind: 'scalar', name: 'number', assertions: { multipleOf: 2 } }],
  structure: [
    type({ a: 'string' }),
    {
      kind: 'structural',
      of: 'object',
      properties: new Map([
        ['a', { schema: expect.any(Function), required: true, default: undefined }]
      ]),
      rest: { allows: 'anything' }
    }
  ],
  required: [
    type({ a: 'string' }),
    {
      kind: 'structural',
      of: 'object',
      properties: new Map([
        ['a', { schema: expect.any(Function), required: true, default: undefined }]
      ]),
      rest: { allows: 'anything' }
    }
  ],
  optional: [
    type({ 'a?': 'string' }),
    {
      kind: 'structural',
      of: 'object',
      properties: new Map([
        ['a', { schema: expect.any(Function), required: false, default: undefined }]
      ]),
      rest: { allows: 'anything' }
    }
  ],
  index: [
    type({ '[string]': 'number' }),
    {
      kind: 'structural',
      of: 'dictionary',
      keys: expect.any(Function),
      values: expect.any(Function)
    }
  ],
  sequence: [
    type('string[]'),
    { kind: 'structural', of: 'list', items: expect.any(Function), assertions: {} }
  ]
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

      expect(read(schema)).toEqual(expected)
    })
  }

  it('states optionality on the edge, which is what the optional constraint is', () => {
    const node = read(type({ 'a?': 'string' }))
    if (node.kind !== 'structural' || node.of !== 'object') {
      throw new Error('the schema did not read as an object')
    }

    expect(node.properties.get('a')).toEqual({
      schema: expect.any(Function),
      required: false,
      default: undefined
    })
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
    expect(read(type('Date > d"2020-01-01"'))).toEqual({
      kind: 'scalar',
      name: 'date',
      assertions: { minimum: { value: new Date('2020-01-01T00:00:00.001Z'), exclusive: false } }
    })
  })

  it('states nothing for a Date with no bound', () => {
    expect(read(type('Date'))).toEqual({ kind: 'scalar', name: 'date', assertions: {} })
  })
})
