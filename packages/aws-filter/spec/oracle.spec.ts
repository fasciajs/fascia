import { readFileSync } from 'node:fs'
import type { Grammar } from '@fascia-internal/grammar'
import {
  arkGrammar,
  effectGrammar,
  numbers,
  VALUES,
  valibotGrammar,
  valuesNear,
  zodGrammar
} from '@fascia-internal/grammar'
import { arktypeSource } from '@fasciajs/arktype'
import type { FilterPolicy, Scope } from '@fasciajs/aws-filter'
import { spellFilterPolicy } from '@fasciajs/aws-filter'
import type { Source } from '@fasciajs/core'
import { describe as description, isError } from '@fasciajs/core'
import { effectSource } from '@fasciajs/effect'
import { valibotSource } from '@fasciajs/valibot'
import { zodSource } from '@fasciajs/zod'
import { describe, expect, it } from 'vitest'
import { accepts } from './lib/accepts.js'
import { exactly } from './lib/exact.js'
import { delivers } from './lib/match.js'

/**
 * A policy, against what AWS said of it.
 *
 * The rows under `oracle/` were measured against SNS and Lambda by lambada, which wrote them. The
 * verdicts say which policies AWS takes in each scope. The deliveries say which messages a policy
 * delivered. Neither can be asked in a spec, so each is held as a function here, and each function
 * is held to every row before it judges anything this package writes.
 */

const oracle = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`./oracle/${name}.json`, import.meta.url), 'utf8'))

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const rows = (name: string): readonly Readonly<Record<string, unknown>>[] => {
  const read = oracle(name)
  if (!Array.isArray(read) || !read.every(isRecord)) {
    throw new Error(`${name} is no list of rows`)
  }
  return read
}

/**
 * A message as SNS published it, or a body as Lambda received it: JSON where it parses, read so a
 * number keeps its value, and the text itself where it does not parse.
 */
function published(message: unknown): unknown {
  if (typeof message !== 'string') {
    return message
  }
  try {
    return exactly(message)
  } catch {
    return message
  }
}

const SCOPES: readonly Scope[] = ['sns:attributes', 'sns:body', 'sqs:body', 'sqs:attributes']

describe('the matching function delivers what AWS delivered', () => {
  it('agrees with every SNS delivery', () => {
    const apart = rows('snsDeliveries').filter((row) => {
      const body = row['scope'] === 'body'
      // A row names one condition at `value`, or a whole policy and the exact message published.
      const policy = Object.hasOwn(row, 'policy') ? row['policy'] : { value: row['condition'] }
      const message = Object.hasOwn(row, 'message')
        ? published(row['message'])
        : Object.hasOwn(row, 'published')
          ? { value: row['published'] }
          : {}
      return delivers(policy, message, body ? 'sns:body' : 'sns:attributes') !== row['delivered']
    })

    expect(apart).toEqual([])
  })

  it('agrees with every Lambda delivery', () => {
    const apart = rows('lambdaDeliveries').filter((row) => {
      const pattern = typeof row['pattern'] === 'string' ? exactly(row['pattern']) : undefined
      const message = isRecord(row['message']) ? row['message'] : {}
      const attributes = isRecord(message['attributes']) ? message['attributes'] : {}
      const event = {
        ...(Object.hasOwn(message, 'body') && { body: published(message['body']) }),
        messageAttributes: Object.fromEntries(
          Object.entries(attributes).map(([key, value]) => [key, { stringValue: value }])
        )
      }
      return delivers(pattern, event, 'lambda') !== row['delivered']
    })

    expect(apart).toEqual([])
  })
})

describe('the acceptance model takes what AWS took', () => {
  it('agrees with every verdict in every scope', () => {
    const apart = rows('awsVerdicts').flatMap((row) =>
      SCOPES.filter(
        (scope) =>
          Object.hasOwn(row, scope) && accepts(row['policy'], scope) !== (row[scope] === 'accepts')
      ).map((scope) => `${scope} ${String(row['name'])}`)
    )

    expect(apart).toEqual([])
  })

  it('agrees with every verdict on a number, read from the text AWS was sent', () => {
    const scopes: readonly Scope[] = ['sns:body', 'sqs:body']
    const apart = rows('numberVerdicts').flatMap((row) =>
      scopes
        .filter(
          (scope) =>
            typeof row['text'] !== 'string' ||
            accepts(exactly(row['text']), scope) !== (row[scope] === 'accepts')
        )
        .map((scope) => `${scope} ${String(row['text'])}`)
    )

    expect(apart).toEqual([])
  })
})

const RUN = { seed: 1, rounds: 300, depth: 2 }

interface Surveyed {
  readonly narrower: string[]
  readonly inexact: string[]
  readonly unaccepted: string[]
  written: number
  exact: number
  verdicts: number
}

/** A value JSON carries, which is what a body is. */
const isJson = (value: unknown): boolean =>
  value === null ||
  typeof value === 'string' ||
  typeof value === 'boolean' ||
  (typeof value === 'number' && Number.isFinite(value)) ||
  (Array.isArray(value) && value.every(isJson)) ||
  (isRecord(value) && Object.values(value).every(isJson))

/** A message in a scope: a JSON body, or attributes that each hold a value the scope carries. */
function isMessage(value: unknown, scope: Scope): boolean {
  switch (scope) {
    case 'sns:body':
    case 'sqs:body':
      return isJson(value)
    case 'sns:attributes':
      return (
        isRecord(value) &&
        Object.values(value).every(
          (one) => typeof one === 'string' || (typeof one === 'number' && Number.isFinite(one))
        )
      )
    case 'sqs:attributes':
      return isRecord(value) && Object.values(value).every((one) => typeof one === 'string')
    default:
      scope satisfies never
      throw new Error('a scope reached the survey with no message form')
  }
}

/** Each key's value as the event source mapping wraps it, which is what Lambda matches. */
const asAttributes = (held: Readonly<Record<string, unknown>>) =>
  Object.fromEntries(Object.entries(held).map(([key, one]) => [key, { stringValue: one }]))

/**
 * Whether a scope delivers a value, sent the way the scope receives it.
 *
 * A publisher escapes an SNS attribute holding `"` or `\` as JSON would, which is the rule the
 * writer states. Lambda receives an event, and a policy is wrapped the way lambada wraps it.
 */
function deliveredIn(scope: Scope, written: FilterPolicy, value: unknown): boolean {
  switch (scope) {
    case 'sns:body':
      return delivers(written, value, 'sns:body')
    case 'sns:attributes': {
      const sent = isRecord(value)
        ? Object.fromEntries(
            Object.entries(value).map(([key, one]) => [
              key,
              typeof one === 'string' ? JSON.stringify(one).slice(1, -1) : one
            ])
          )
        : value
      return delivers(written, sent, 'sns:attributes')
    }
    case 'sqs:body':
      return delivers({ body: written }, { body: value }, 'lambda')
    case 'sqs:attributes':
      return (
        isRecord(value) &&
        delivers(
          { messageAttributes: asAttributes(written) },
          { messageAttributes: asAttributes(value) },
          'lambda'
        )
      )
    default:
      scope satisfies never
      throw new Error('a scope reached the survey with no delivery')
  }
}

const holdsList = (value: unknown): boolean =>
  Array.isArray(value) || (isRecord(value) && Object.values(value).some(holdsList))

const LIST_DEPARTURE = 'a policy matches a list by any one of its members'

function survey<S>(grammar: Grammar<S>, source: Source<S>, scope: Scope): Surveyed {
  const next = numbers(RUN.seed)
  const surveyed: Surveyed = {
    narrower: [],
    inexact: [],
    unaccepted: [],
    written: 0,
    exact: 0,
    verdicts: 0
  }

  for (let round = 0; round < RUN.rounds; round += 1) {
    const subject = grammar(next, RUN.depth)
    const described = description(subject.schema, source, 'input')
    if (isError(described)) {
      continue
    }
    const spelled = spellFilterPolicy(described.term, scope)
    if (isError(spelled)) {
      continue
    }

    const { written } = spelled
    if (written !== undefined) {
      surveyed.written += 1
      if (!accepts(written, scope)) {
        surveyed.unaccepted.push(JSON.stringify(written))
        continue
      }
    }

    const exact = spelled.departures.every(
      (one) => one.direction !== 'wider' || one.said.startsWith(LIST_DEPARTURE)
    )
    surveyed.exact += exact && written !== undefined ? 1 : 0

    for (const value of [...VALUES, ...valuesNear(described.term, described.definitions)]) {
      if (!isMessage(value, scope)) {
        continue
      }
      let taken: boolean
      try {
        taken = subject.accepts(value)
      } catch {
        continue
      }
      surveyed.verdicts += 1

      const delivered = written === undefined || deliveredIn(scope, written, value)
      const named = `${JSON.stringify(value)} against ${JSON.stringify(written)}`
      if (taken && !delivered) {
        surveyed.narrower.push(named)
      } else if (exact && !taken && delivered && !holdsList(value)) {
        surveyed.inexact.push(named)
      }
    }
  }

  return surveyed
}

const FRONTENDS = [
  ['zod', (scope: Scope) => survey(zodGrammar, zodSource, scope)],
  ['arktype', (scope: Scope) => survey(arkGrammar, arktypeSource, scope)],
  ['valibot', (scope: Scope) => survey(valibotGrammar, valibotSource, scope)],
  ['effect', (scope: Scope) => survey(effectGrammar, effectSource, scope)]
] as const

describe('a policy delivers every message its schema takes, and AWS takes the policy', () => {
  for (const [what, surveyOf] of FRONTENDS) {
    for (const scope of SCOPES) {
      it(`holds for ${what} in ${scope}, over ${RUN.rounds} schemas from seed ${RUN.seed}`, () => {
        const surveyed = surveyOf(scope)
        console.log(
          `${what} ${scope}: ${surveyed.written} written, ${surveyed.exact} exact, ${surveyed.verdicts} verdicts`
        )

        expect(surveyed.unaccepted).toEqual([])
        expect(surveyed.narrower.slice(0, 3)).toEqual([])
        expect(surveyed.inexact.slice(0, 3)).toEqual([])
      })
    }
  }
})
