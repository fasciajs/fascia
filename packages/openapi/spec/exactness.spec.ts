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
import { effectSource } from '@fasciajs/effect'
import { spellJsonSchemaAll } from '@fasciajs/json-schema'
import { toV30 } from '@fasciajs/openapi'
import { valibotSource } from '@fasciajs/valibot'
import { zodSource } from '@fasciajs/zod'
import { Ajv2020 } from 'ajv/dist/2020.js'
import { default as formats } from 'ajv-formats'
import { describe, expect, it } from 'vitest'
import { fromV30 } from './lib/reverse.js'

/**
 * A departure names every value the document and the schema disagree about.
 *
 * Two spellings compose here, so the list a caller reads is both. The document is the 2020-12
 * recovered from 3.0, because Ajv has no word for `nullable`.
 */

const RUN = { seed: 1, rounds: 300, depth: 2 }

interface Surveyed {
  readonly quietlyWider: readonly string[]
  readonly quietlyNarrower: readonly string[]
  readonly named: number
}

function survey<S>(source: Source<S>, grammar: Grammar<S>): Surveyed {
  // Or a `format` keyword is ignored and a measurement of nothing looks like agreement.
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

    const spelled = spellJsonSchemaAll(described)
    if (isError(spelled)) {
      continue
    }
    const v30 = toV30(spelled.written)

    let validate: ReturnType<typeof ajv.compile>
    try {
      validate = ajv.compile(fromV30(v30.written) as object)
    } catch {
      continue
    }

    const written = JSON.stringify(v30.written)
    const departures = [...spelled.departures, ...v30.departures]
    const saysWider = departures.some((one) => one.direction === 'wider')
    const saysNarrower = departures.some((one) => one.direction === 'narrower')

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
