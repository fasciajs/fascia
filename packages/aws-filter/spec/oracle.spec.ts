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
import type { Scope } from '@fasciajs/aws-filter'
import { spellFilterPolicy } from '@fasciajs/aws-filter'
import type { Source } from '@fasciajs/core'
import { describe as description, isError } from '@fasciajs/core'
import { effectSource } from '@fasciajs/effect'
import { valibotSource } from '@fasciajs/valibot'
import { zodSource } from '@fasciajs/zod'
import { describe, expect, it } from 'vitest'
import { accepts } from './lib/accepts.js'
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

const SCOPES: readonly Scope[] = ['sns:attributes', 'sns:body', 'sqs:body', 'sqs:attributes']

describe('the matching function delivers what AWS delivered', () => {
  it('agrees with every SNS delivery', () => {
    const apart = rows('snsDeliveries').filter((row) => {
      const message = Object.hasOwn(row, 'published') ? { value: row['published'] } : {}
      const escaped = row['scope'] === 'attributes'
      return delivers({ value: row['condition'] }, message, escaped) !== row['delivered']
    })

    expect(apart).toEqual([])
  })

  it('agrees with every Lambda delivery', () => {
    const apart = rows('lambdaDeliveries').filter((row) => {
      const pattern = typeof row['pattern'] === 'string' ? JSON.parse(row['pattern']) : undefined
      const message = isRecord(row['message']) ? row['message'] : {}
      const attributes = isRecord(message['attributes']) ? message['attributes'] : {}
      const event = {
        ...(Object.hasOwn(message, 'body') && { body: message['body'] }),
        messageAttributes: Object.fromEntries(
          Object.entries(attributes).map(([key, value]) => [key, { stringValue: value }])
        )
      }
      return delivers(pattern, event, false) !== row['delivered']
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

      const delivered = written === undefined || delivers(written, value, false)
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
