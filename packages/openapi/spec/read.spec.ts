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
import { jsonSchemaAt, jsonSchemaSource, spellJsonSchemaAll } from '@fasciajs/json-schema'
import { toV30 } from '@fasciajs/openapi'
import { valibotSource } from '@fasciajs/valibot'
import { zodSource } from '@fasciajs/zod'
import { default as AjvDraft04 } from 'ajv-draft-04'
import { default as formats } from 'ajv-formats'
import { describe, expect, it } from 'vitest'

/**
 * A 3.0 Schema Object this library writes, read back in the dialect it is written in.
 *
 * Ajv holds `nullable` as OpenAPI 3.0 states it: null joins the one type beside the flag, and a
 * flag with no type beside it does not compile. Ajv for draft-04 holds the boolean bounds 3.0 took
 * from it. So a 3.0 document is asked of a validator directly.
 *
 * (C) every 3.0 document this library writes compiles.
 * (D) a term read from it admits what Ajv says the document admits.
 */

const RUN = { seed: 1, rounds: 300, depth: 2 }

interface Surveyed {
  readonly uncompilable: readonly string[]
  readonly apart: readonly string[]
  readonly refused: readonly string[]
  readonly verdicts: number
}

function survey<S>(source: Source<S>, grammar: Grammar<S>): Surveyed {
  const ajv = new AjvDraft04.default({ strict: false, allErrors: false })
  formats.default(ajv)

  const next = numbers(RUN.seed)
  const uncompilable: string[] = []
  const apart: string[] = []
  const refused: string[] = []
  let verdicts = 0

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
    const document = toV30(spelled.written).written

    let validate: ReturnType<typeof ajv.compile>
    try {
      validate = ajv.compile(document as object)
    } catch (error) {
      uncompilable.push(`${String(error)}: ${JSON.stringify(document)}`)
      continue
    }

    const at = jsonSchemaAt(document, 'oas-3.0')
    const back = isError(at) ? at : description(at, jsonSchemaSource, 'input')
    if (isError(back)) {
      refused.push(`${back.message}: ${JSON.stringify(document)}`)
      continue
    }

    for (const value of [...VALUES, ...valuesNear(back.term, back.definitions)]) {
      const byTerm = admits(back, value)
      if (isError(byTerm)) {
        continue
      }
      verdicts += 1

      const byDocument = validate(value) === true
      if (byTerm !== byDocument) {
        apart.push(
          `${JSON.stringify(value)} is ${byDocument ? 'taken' : 'refused'} by ${JSON.stringify(document)}, and the term read from it says otherwise`
        )
      }
    }
  }

  return { uncompilable, apart, refused, verdicts }
}

const surveys = [
  ['zod', survey(zodSource, zodGrammar)],
  ['arktype', survey(arktypeSource, arkGrammar)],
  ['effect', survey(effectSource, effectGrammar)],
  ['valibot', survey(valibotSource, valibotGrammar)]
] as const

describe('a 3.0 document this library writes admits what its reading admits', () => {
  for (const [what, surveyed] of surveys) {
    it(`compiles and agrees over ${RUN.rounds} schemas from ${what}`, () => {
      expect(surveyed.uncompilable, surveyed.uncompilable[0] ?? '').toEqual([])
      expect(surveyed.apart, surveyed.apart[0] ?? '').toEqual([])
      expect(surveyed.refused, surveyed.refused[0] ?? '').toEqual([])
      expect(surveyed.verdicts).toBeGreaterThan(RUN.rounds)
    })
  }
})
