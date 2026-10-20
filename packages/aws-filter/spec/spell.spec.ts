import type { Scope } from '@fasciajs/aws-filter'
import { spellFilterPolicy } from '@fasciajs/aws-filter'
import { describe as description, isError } from '@fasciajs/core'
import { zodSource } from '@fasciajs/zod'
import { describe, expect, it } from 'vitest'
import * as z from 'zod'

/** What a scope writes for a zod schema: the policy, or the reason there is none. */
function spelled(schema: z.core.$ZodType, scope: Scope) {
  const described = description(schema, zodSource, 'input')
  if (isError(described)) {
    throw new Error(described.message)
  }
  const spelling = spellFilterPolicy(described.term, scope)
  return isError(spelling)
    ? { refused: spelling.message }
    : {
        written: spelling.written,
        said: spelling.departures.map(
          (one) => `${one.direction} at [${one.at.join('.')}]: ${one.said}`
        )
      }
}

const LIST =
  'wider at []: a policy matches a list by any one of its members, so a message holding a list where this states a value or an object is delivered too'

describe('a subscriber receives each event its schema takes, and no other where a policy can say so', () => {
  it('routes a tagged union of events by the tag, with $or, exactly', () => {
    const event = z.discriminatedUnion('type', [
      z.object({ type: z.literal('order.created'), total: z.number().min(0) }),
      z.object({ type: z.literal('order.cancelled'), reason: z.enum(['fraud', 'customer']) })
    ])

    expect(spelled(event, 'sns:body')).toEqual({
      written: {
        $or: [
          { type: ['order.created'], total: [{ numeric: ['>=', 0] }] },
          { type: ['order.cancelled'], reason: ['fraud', 'customer'] }
        ]
      },
      said: [LIST]
    })
  })

  it('delivers an event without an optional key, by exists: false', () => {
    const event = z.object({ type: z.literal('a'), region: z.enum(['eu', 'us']).optional() })

    expect(spelled(event, 'sqs:body')).toEqual({
      written: { type: ['a'], region: ['eu', 'us', { exists: false }] },
      said: [LIST]
    })
  })

  it('holds a number to its range, and a range of one number to that number', () => {
    const event = z.object({ low: z.number().gt(1).lte(5), one: z.number().gte(3).lte(3) })

    expect(spelled(event, 'sns:attributes')).toEqual({
      written: { low: [{ numeric: ['>', 1, '<=', 5] }], one: [{ numeric: ['=', 3] }] },
      said: [LIST]
    })
  })

  it('states a pattern held to one end as a prefix or a suffix', () => {
    const event = z.object({ id: z.string().regex(/^ord_/), file: z.string().regex(/\.json$/) })

    expect(spelled(event, 'sqs:attributes')).toEqual({
      written: { id: [{ prefix: 'ord_' }], file: [{ suffix: '.json' }] },
      said: [LIST]
    })
  })
})

describe('a policy is never narrower than its schema, and says where it is wider', () => {
  it('delivers any present value where no condition holds a value to its type', () => {
    expect(spelled(z.object({ name: z.string().min(2) }), 'sns:body')).toEqual({
      written: { name: [{ exists: true }] },
      said: [
        LIST,
        'wider at [name]: this is a string, and no condition holds a value to a type, so any value present here is delivered',
        'wider at [name]: this states minLength, and a policy has no condition for that'
      ]
    })
  })

  it('states nothing for a number in SQS attributes, which carry every value as a string', () => {
    expect(
      spelled(z.object({ kind: z.literal('a'), count: z.number() }), 'sqs:attributes')
    ).toEqual({
      written: { kind: ['a'] },
      said: [
        LIST,
        'wider at [count]: this is a number, and a message in this scope carries a number as a string, so the policy states nothing here and delivers what stands here whatever it is'
      ]
    })
  })

  it('writes no policy for an event that may be null, because a policy holds null back', () => {
    expect(spelled(z.object({ kind: z.literal('a') }).nullable(), 'sns:body')).toEqual({
      written: undefined,
      said: [
        'wider at []: this admits null where a policy matches an object by its keys, so the policy states nothing here and delivers what stands here whatever it is'
      ]
    })
  })
})

describe('a policy AWS would refuse is not written', () => {
  it('refuses six keys in SNS, which takes five, and writes them for Lambda', () => {
    const event = z.object(
      Object.fromEntries(['a', 'b', 'c', 'd', 'e', 'f'].map((key) => [key, z.literal('x')]))
    )

    expect(spelled(event, 'sns:body')).toEqual({
      refused: 'this cannot be written soundly: this states 6 keys, past the 5 SNS takes'
    })
    expect(spelled(event, 'sqs:body')).toEqual({
      written: { a: ['x'], b: ['x'], c: ['x'], d: ['x'], e: ['x'], f: ['x'] },
      said: [LIST]
    })
  })
})
