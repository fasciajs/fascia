import { convertToAttr } from '@aws-sdk/util-dynamodb'
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
import type { Source } from '@fasciajs/core'
import { describe as description, isError } from '@fasciajs/core'
import type { AttributeName, AttributeShape } from '@fasciajs/dynamodb'
import { spellDynamo } from '@fasciajs/dynamodb'
import { effectSource } from '@fasciajs/effect'
import { valibotSource } from '@fasciajs/valibot'
import { zodSource } from '@fasciajs/zod'
import { describe, expect, it } from 'vitest'

/**
 * A value the schema takes marshals to an attribute this description admits.
 *
 * One-directional: a value the schema turns away says nothing, because this target widens on purpose
 * wherever DynamoDB has no word for an assertion.
 */

const RUN = { seed: 1, rounds: 300, depth: 2 }

const NAMES: readonly AttributeName[] = ['S', 'N', 'B', 'SS', 'NS', 'BS', 'M', 'L', 'BOOL', 'NULL']

/** A value is exactly one member. */
function memberOf(attribute: unknown): { name: AttributeName; carries: unknown } | undefined {
  if (typeof attribute !== 'object' || attribute === null) {
    return undefined
  }

  const [only, ...rest] = Object.entries(attribute)
  if (only === undefined || rest.length > 0) {
    return undefined
  }

  const [name, carries] = only
  return NAMES.includes(name as AttributeName)
    ? { name: name as AttributeName, carries }
    : undefined
}

/** Whether the members a schema admits hold this attribute. */
function admits(shape: AttributeShape, attribute: unknown): boolean {
  const member = memberOf(attribute)
  if (member === undefined) {
    return false
  }

  if (member.name === 'M') {
    const stated = shape.M
    return stated === undefined ? false : admitsMap(stated, member.carries)
  }

  if (member.name === 'L') {
    const stated = shape.L
    if (stated === undefined || !Array.isArray(member.carries)) {
      return false
    }
    return member.carries.every((item: unknown) => admits(stated.items, item))
  }

  return shape[member.name] !== undefined
}

function admitsMap(stated: NonNullable<AttributeShape['M']>, carries: unknown): boolean {
  if (typeof carries !== 'object' || carries === null) {
    return false
  }
  const held = new Map(Object.entries(carries))

  for (const [name, entry] of stated.attributes) {
    const at = held.get(name)
    if (at === undefined) {
      if (entry.required) {
        return false
      }
      continue
    }
    if (!admits(entry.shape, at)) {
      return false
    }
  }

  for (const [name, at] of held) {
    if (stated.attributes.has(name)) {
      continue
    }
    switch (stated.rest.allows) {
      case 'anything':
        break
      case 'nothing':
        return false
      case 'shape':
        if (!admits(stated.rest.shape, at)) {
          return false
        }
        break
      default:
        stated.rest satisfies never
        throw new Error('a rest policy of no case reached this check')
    }
  }

  return true
}

interface Surveyed {
  /** A row the schema admits and the description turns away. */
  readonly refused: readonly string[]
  readonly asked: number
  readonly written: number
}

function survey<S>(source: Source<S>, grammar: Grammar<S>): Surveyed {
  const next = numbers(RUN.seed)
  const refused: string[] = []
  let asked = 0
  let written = 0

  for (let round = 0; round < RUN.rounds; round += 1) {
    const subject = grammar(next, RUN.depth)

    const described = description(subject.schema, source, 'input')
    if (isError(described)) {
      continue
    }

    const spelled = spellDynamo(described.term)
    if (isError(spelled)) {
      continue
    }
    written += 1

    for (const value of [...VALUES, ...valuesNear(described.term, described.definitions)]) {
      let bySchema: boolean
      try {
        bySchema = subject.accepts(value)
      } catch {
        continue
      }
      if (!bySchema) {
        continue
      }

      // A value a table cannot hold is DynamoDB's answer rather than this target's.
      let attribute: unknown
      try {
        attribute = convertToAttr(value)
      } catch {
        continue
      }

      asked += 1
      if (!admits(spelled.written, attribute)) {
        refused.push(
          `${JSON.stringify(value)} marshals to ${JSON.stringify(attribute)} and the description states ${JSON.stringify(spelled.written)}`
        )
      }
    }
  }

  return { refused, asked, written }
}

const surveys: ReadonlyMap<string, Surveyed> = new Map([
  ['zod', survey(zodSource, zodGrammar)],
  ['arktype', survey(arktypeSource, arkGrammar)],
  ['effect', survey(effectSource, effectGrammar)],
  ['valibot', survey(valibotSource, valibotGrammar)]
])

describe('a value the schema takes marshals to an attribute this description admits', () => {
  for (const [what, surveyed] of surveys) {
    it(`holds over ${RUN.rounds} schemas from ${what} at seed ${RUN.seed}`, () => {
      expect(surveyed.refused).toEqual([])

      expect(surveyed.written).toBeGreaterThan(RUN.rounds / 2)
      expect(surveyed.asked).toBeGreaterThan(RUN.rounds)
    })
  }
})
