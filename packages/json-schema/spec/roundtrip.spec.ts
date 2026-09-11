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
import { valibotSource } from '@fasciajs/valibot'
import { zodSource } from '@fasciajs/zod'
import { Ajv2020 } from 'ajv/dist/2020.js'
import { default as formats } from 'ajv-formats'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'
import { describe, expect, it } from 'vitest'

/**
 * The first check here that reads a document back.
 *
 * (R) what this library writes, it writes the same after reading it: `spell` then `read` then
 * `spell` is where it started.
 * (D) a term read from a document admits what the document admits, asked of Ajv.
 */

const RUN = { seed: 1, rounds: 300, depth: 2 }

interface Surveyed {
  readonly differed: readonly string[]
  readonly apart: readonly string[]
  readonly written: number
  readonly verdicts: number
}

function survey<S>(source: Source<S>, grammar: Grammar<S>): Surveyed {
  const ajv = new Ajv2020({ strict: false, allErrors: false })
  formats.default(ajv)

  const next = numbers(RUN.seed)
  const differed: string[] = []
  const apart: string[] = []
  let written = 0
  let verdicts = 0

  for (let round = 0; round < RUN.rounds; round += 1) {
    const subject = grammar(next, RUN.depth)

    const described = description(subject.schema, source, 'input')
    if (isError(described)) {
      continue
    }
    const once = spellJsonSchemaAll(described)
    if (isError(once)) {
      continue
    }

    const back = description(jsonSchemaAt(once.written as JSONSchema), jsonSchemaSource, 'input')
    if (isError(back)) {
      differed.push(`this library wrote a document it cannot read: ${back.message}`)
      continue
    }
    const twice = spellJsonSchemaAll(back)
    if (isError(twice)) {
      differed.push(`a document read here cannot be written: ${twice.message}`)
      continue
    }

    written += 1
    if (JSON.stringify(once.written) !== JSON.stringify(twice.written)) {
      differed.push(
        `${JSON.stringify(once.written)} was written again as ${JSON.stringify(twice.written)}`
      )
    }

    let validate: ReturnType<typeof ajv.compile>
    try {
      validate = ajv.compile(once.written as object)
    } catch {
      continue
    }

    for (const value of [...VALUES, ...valuesNear(back.term, back.definitions)]) {
      const byTerm = admits(back, value)
      if (isError(byTerm)) {
        continue
      }
      verdicts += 1
      if (byTerm !== (validate(value) === true)) {
        apart.push(
          `${JSON.stringify(value)} is ${byTerm ? 'taken' : 'refused'} by a term read from ${JSON.stringify(once.written)}`
        )
      }
    }
  }

  return { differed, apart, written, verdicts }
}

const surveys: ReadonlyMap<string, Surveyed> = new Map([
  ['zod', survey(zodSource, zodGrammar)],
  ['arktype', survey(arktypeSource, arkGrammar)],
  ['effect', survey(effectSource, effectGrammar)],
  ['valibot', survey(valibotSource, valibotGrammar)]
])

describe('(R) a document this library writes, it writes the same after reading it', () => {
  for (const [what, surveyed] of surveys) {
    it(`holds over ${RUN.rounds} documents written from ${what}`, () => {
      expect(surveyed.differed).toEqual([])

      // A run that wrote nothing would report the law held over no document.
      expect(surveyed.written).toBeGreaterThan(RUN.rounds / 2)
    })
  }
})

describe('(D) a term read from a document admits what the document admits', () => {
  for (const [what, surveyed] of surveys) {
    it(`holds over the documents written from ${what}`, () => {
      expect(surveyed.apart).toEqual([])
      expect(surveyed.verdicts).toBeGreaterThan(RUN.rounds)
    })
  }
})
