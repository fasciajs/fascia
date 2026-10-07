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
import { admits, describe as description, isError } from '@fasciajs/core'
import type { effectSource } from '@fasciajs/effect'
import { jsonSchemaAt, jsonSchemaSource } from '@fasciajs/json-schema'
import type { valibotSource } from '@fasciajs/valibot'
import { toJsonSchema } from '@valibot/to-json-schema'
import { default as Ajv } from 'ajv'
import { Ajv2020 } from 'ajv/dist/2020.js'
import { default as formats } from 'ajv-formats'
import { JSONSchema, Schema } from 'effect'
import type { JSONSchema as Document } from 'json-schema-typed/draft-2020-12'
import type * as v from 'valibot'
import { describe, expect, it } from 'vitest'
import * as z from 'zod'

/**
 * A document somebody else wrote, read here.
 *
 * The round trip reads what this library writes, and this library writes one family of keywords
 * per schema. A converter writes a type beside a disjunction, a reference beside an assertion and a
 * count past its positions, so its documents are the inputs the round trip never draws.
 *
 * (F) a term read from a converter's document admits what the document admits, asked of Ajv. A
 * document the reader refuses is counted, because a refusal says less and claims nothing.
 *
 * zod and arktype write 2020-12. effect and valibot write draft-07, which is translated where it
 * enters, so Ajv asks each document in the dialect it states.
 */

const RUN = { seed: 1, rounds: 300, depth: 2 }

interface Surveyed {
  readonly apart: readonly string[]
  readonly read: number
  readonly refused: number
  readonly verdicts: number
}

function survey<S>(
  grammar: Grammar<S>,
  writes: (schema: S) => unknown,
  dialect: '2020-12' | 'draft-07' = '2020-12'
): Surveyed {
  const ajv =
    dialect === '2020-12'
      ? new Ajv2020({ strict: false, allErrors: false })
      : new Ajv.default({ strict: false, allErrors: false })
  formats.default(ajv)

  const next = numbers(RUN.seed)
  const apart: string[] = []
  let read = 0
  let refused = 0
  let verdicts = 0

  for (let round = 0; round < RUN.rounds; round += 1) {
    const subject = grammar(next, RUN.depth)

    let document: unknown
    let validate: ReturnType<typeof ajv.compile>
    try {
      document = writes(subject.schema)
      validate = ajv.compile(document as object)
    } catch {
      // The converter wrote nothing, or wrote what Ajv cannot compile. Neither is a document.
      continue
    }

    const described = description(jsonSchemaAt(document as Document), jsonSchemaSource, 'input')
    if (isError(described)) {
      refused += 1
      continue
    }
    read += 1

    for (const value of [...VALUES, ...valuesNear(described.term, described.definitions)]) {
      // A format has no verdict from a term, because deciding one is a validator's work.
      const byTerm = admits(described, value)
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

  return { apart, read, refused, verdicts }
}

/**
 * How many documents each converter writes that the reader refuses, at this seed.
 *
 * zod's 3 are a schema holding itself at the root, written `$ref: "#"`. A root has no name, and a
 * term names whatever holds itself.
 */
const surveys = [
  [
    'arktype',
    0,
    survey(arkGrammar, (schema: { toJsonSchema: () => unknown }) => schema.toJsonSchema())
  ],
  [
    'zod',
    3,
    survey(zodGrammar, (schema: z.core.$ZodType) => z.toJSONSchema(schema, { io: 'input' }))
  ],
  [
    'effect',
    0,
    survey(
      effectGrammar,
      // The grammar hands the AST, and effect writes from a schema.
      (ast: Parameters<typeof effectSource.read>[0]) => JSONSchema.make(Schema.make(ast)),
      'draft-07'
    )
  ],
  [
    'valibot',
    0,
    survey(
      valibotGrammar, // valibot's grammar hands its own schema type, and its converter takes the generic one.
      (schema: Parameters<typeof valibotSource.read>[0]) =>
        toJsonSchema(schema as unknown as v.GenericSchema),
      'draft-07'
    )
  ]
] as const

describe('a term read from a document admits what the document admits, whoever wrote it', () => {
  for (const [what, refused, surveyed] of surveys) {
    it(`agrees with every document ${what} writes, over ${RUN.rounds} schemas from seed ${RUN.seed}`, () => {
      expect(surveyed.apart, surveyed.apart[0] ?? '').toEqual([])
      expect(surveyed.read).toBeGreaterThan(RUN.rounds / 2)
      expect(surveyed.verdicts).toBeGreaterThan(RUN.rounds)
      expect(surveyed.refused).toBe(refused)
    })
  }
})
