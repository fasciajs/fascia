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
import { spellAtdAll } from '@fasciajs/atd'
import type { Source } from '@fasciajs/core'
import { describe as description, isError } from '@fasciajs/core'
import { effectSource } from '@fasciajs/effect'
import { valibotSource } from '@fasciajs/valibot'
import { zodSource } from '@fasciajs/zod'
import { Ajv2020 } from 'ajv/dist/2020.js'
import { default as formats } from 'ajv-formats'
import { describe, expect, it } from 'vitest'
import { asJsonSchema } from './lib/measure.js'

/**
 * A departure names every value the document and the schema disagree about.
 *
 * ATD gives up more than any target here. `refusing` lets a caller stop a build on a `wider`
 * departure, and this is what says that promise is kept.
 */

const RUN = { seed: 1, rounds: 300, depth: 2 }

interface Surveyed {
  readonly quietlyWider: readonly string[]
  readonly quietlyNarrower: readonly string[]
  readonly named: number
}

function survey<S>(source: Source<S>, grammar: Grammar<S>): Surveyed {
  // Or Ajv prints `unknown format "uuid" ignored` and answers true.
  const ajv = new Ajv2020({ strict: false, allErrors: false })
  formats.default(ajv)
  const next = numbers(RUN.seed)
  const quietlyWider: string[] = []
  const quietlyNarrower: string[] = []
  let named = 0

  for (let round = 0; round < RUN.rounds; round += 1) {
    const subject = grammar(next, RUN.depth)

    const described = description(subject.schema, source, 'input')
    if (isError(described)) {
      continue
    }

    const spelled = spellAtdAll(described)
    if (isError(spelled)) {
      continue
    }

    let validate: ReturnType<typeof ajv.compile>
    try {
      validate = ajv.compile(asJsonSchema(spelled.written))
    } catch {
      continue
    }

    const written = JSON.stringify(spelled.written.root)
    const saysWider = spelled.departures.some((one) => one.direction === 'wider')
    const saysNarrower = spelled.departures.some((one) => one.direction === 'narrower')

    for (const value of [...VALUES, ...valuesNear(described.term, described.definitions)]) {
      let bySchema: boolean
      try {
        bySchema = subject.accepts(value)
      } catch {
        continue
      }

      const byDocument = validate(value) === true
      if (bySchema === byDocument) {
        continue
      }

      if (!bySchema && byDocument) {
        if (saysWider) {
          named += 1
        } else {
          quietlyWider.push(`${JSON.stringify(value)} is taken by ${written}`)
        }
      }
      if (bySchema && !byDocument) {
        if (saysNarrower) {
          named += 1
        } else {
          quietlyNarrower.push(`${JSON.stringify(value)} is refused by ${written}`)
        }
      }
    }
  }

  return { quietlyWider, quietlyNarrower, named }
}

const surveys: ReadonlyMap<string, Surveyed> = new Map([
  ['zod', survey(zodSource, zodGrammar)],
  ['arktype', survey(arktypeSource, arkGrammar)],
  ['effect', survey(effectSource, effectGrammar)],
  ['valibot', survey(valibotSource, valibotGrammar)]
])

describe('a departure names every value the document and the schema disagree about', () => {
  for (const [what, surveyed] of surveys) {
    it(`names every widening over ${RUN.rounds} schemas from ${what}`, () => {
      expect(surveyed.quietlyWider).toEqual([])

      expect(surveyed.named).toBeGreaterThan(0)
    })

    it(`names every narrowing over ${RUN.rounds} schemas from ${what}`, () => {
      expect(surveyed.quietlyNarrower).toEqual([])
    })
  }
})
