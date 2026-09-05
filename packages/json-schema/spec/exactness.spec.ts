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
 * **What a departure claims, asked of the document rather than of the prose.**
 *
 * A spelling returns what it wrote and what it gave up, and until this nothing read the second. A
 * list of losses nobody checks is a list that can be wrong in two ways, and only one of them is
 * visible: a loss named where nothing was lost is noise a reader learns to skip, and a loss that
 * happened and was never named is a client turned away by a document nobody was warned about.
 *
 * Two laws, and the second is the one with teeth.
 *
 * **(E) A spelling that gave up nothing accepts exactly what the term accepts.** Both directions,
 * which no other check here asserts: the standing agreement runs assert one direction and print the
 * other, because a widening is a decision. Where the spelling reports no departure there is no
 * decision to protect, so the two must agree exactly or the report is wrong.
 *
 * **(A) A widening the departures do not name is a widening nobody can act on.** `refusing` lets a
 * caller stop a build on a `wider` departure, and a caller who does that is asking never to publish
 * a document that takes what their schema turns away. That promise is worth what this law says it
 * is worth. It found the reading of `Schema.Int` dropping `{ type: 'integer' }`, where the document
 * took `1.5`, effect refused it, and the departures said nothing.
 *
 * The reference is the validator, not the term. A departure states what the document does against
 * the schema, and a target never sees the schema, so the claim can only be checked from here.
 */

const RUN = { seed: 1, rounds: 300, depth: 2 }

interface Surveyed {
  /** (E). A value a faithful spelling and the term disagree about. */
  readonly inexact: readonly string[]
  /** (A). A value the document takes, the schema refuses, and no departure names. */
  readonly quietlyWider: readonly string[]
  /** (A). A value the schema takes, the document refuses, and no departure names. */
  readonly quietlyNarrower: readonly string[]
  readonly faithfulRounds: number
  readonly verdicts: number
}

function survey<S>(source: Source<S>, grammar: Grammar<S>): Surveyed {
  // Formats are added, or a `format` keyword is ignored and a measurement of nothing looks like
  // agreement.
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

    // The whole description, definitions and all. A document holding a reference to nothing
    // compiles as nothing, and every document beneath one would be skipped.
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

    // The fixed pool, and the values this term's own bounds suggest. A departure claims a document
    // takes more than the schema, and the value that shows it is one the bound named.
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

      // A validator that throws states no verdict, so there is nothing to check a claim against.
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

      // A run of nothing but lossy subjects would report the law held over no subject at all.
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
