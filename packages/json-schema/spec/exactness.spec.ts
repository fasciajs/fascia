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
import { admits, describe as description, isError } from '@fasciajs/core'
import { effectSource } from '@fasciajs/effect'
import { spellJsonSchemaAll } from '@fasciajs/json-schema'
import { valibotSource } from '@fasciajs/valibot'
import { zodSource } from '@fasciajs/zod'
import { Ajv2020 } from 'ajv/dist/2020.js'
import { default as formats } from 'ajv-formats'
import { describe, expect, it } from 'vitest'

/**
 * What a departure claims, asked of the document rather than of the prose.
 *
 * (E) a spelling that gave up nothing accepts exactly what the term accepts, both directions.
 * (A) a departure names every value the document and the schema disagree about. The reference is the
 * validator, because a departure states what the document does against the schema and a target
 * never sees one.
 */

const RUN = { seed: 1, rounds: 300, depth: 2 }

interface Surveyed {
  readonly inexact: readonly string[]
  readonly quietlyWider: readonly string[]
  readonly quietlyNarrower: readonly string[]
  readonly faithfulRounds: number
  readonly verdicts: number
}

function survey<S>(source: Source<S>, grammar: Grammar<S>): Surveyed {
  const ajv = new Ajv2020({ strict: false, allErrors: false })
  formats.default(ajv)

  const next = numbers(RUN.seed)
  const inexact: string[] = []
  const quietlyWider: string[] = []
  const quietlyNarrower: string[] = []
  let faithfulRounds = 0
  let verdicts = 0

  for (let round = 0; round < RUN.rounds; round += 1) {
    const subject = grammar(next, RUN.depth)

    const described = description(subject.schema, source, 'input')
    if (isError(described)) {
      continue
    }

    // The whole description, or a document holding a reference to nothing compiles as nothing.
    const spelled = spellJsonSchemaAll(described)
    if (isError(spelled)) {
      continue
    }

    let validate: ReturnType<typeof ajv.compile>
    try {
      validate = ajv.compile(spelled.written as object)
    } catch {
      continue
    }

    const written = JSON.stringify(spelled.written)
    const faithful = spelled.departures.length === 0
    const saysWider = spelled.departures.some((one) => one.direction === 'wider')
    const saysNarrower = spelled.departures.some((one) => one.direction === 'narrower')
    if (faithful) {
      faithfulRounds += 1
    }

    for (const value of [...VALUES, ...valuesNear(described.term, described.definitions)]) {
      const byDocument = validate(value) === true

      if (faithful) {
        const byTerm = admits(described, value)
        if (!isError(byTerm)) {
          verdicts += 1
          if (byTerm !== byDocument) {
            inexact.push(
              `${JSON.stringify(value)} is ${byTerm ? 'taken' : 'refused'} by a term whose document gave up nothing: ${written}`
            )
          }
        }
      }

      let bySchema: boolean
      try {
        bySchema = subject.accepts(value)
      } catch {
        continue
      }

      if (bySchema && !byDocument && !saysNarrower) {
        quietlyNarrower.push(`${JSON.stringify(value)} is refused by ${written}`)
      }
      if (!bySchema && byDocument && !saysWider) {
        quietlyWider.push(`${JSON.stringify(value)} is taken by ${written}`)
      }
    }
  }

  return { inexact, quietlyWider, quietlyNarrower, faithfulRounds, verdicts }
}

const surveys: ReadonlyMap<string, Surveyed> = new Map([
  ['zod', survey(zodSource, zodGrammar)],
  ['arktype', survey(arktypeSource, arkGrammar)],
  ['effect', survey(effectSource, effectGrammar)],
  ['valibot', survey(valibotSource, valibotGrammar)]
])

describe('(E) a spelling that gave up nothing accepts exactly what the term accepts', () => {
  for (const [what, surveyed] of surveys) {
    it(`writes ${what} exactly, wherever it reports no departure`, () => {
      expect(surveyed.inexact).toEqual([])

      expect(surveyed.faithfulRounds).toBeGreaterThan(RUN.rounds / 2)
      expect(surveyed.verdicts).toBeGreaterThan(RUN.rounds)
    })
  }
})

describe('(A) a departure names every value the document and the schema disagree about', () => {
  for (const [what, surveyed] of surveys) {
    it(`names every widening over ${RUN.rounds} schemas from ${what}`, () => {
      expect(surveyed.quietlyWider).toEqual([])
    })

    it(`names every narrowing over ${RUN.rounds} schemas from ${what}`, () => {
      expect(surveyed.quietlyNarrower).toEqual([])
    })
  }
})
