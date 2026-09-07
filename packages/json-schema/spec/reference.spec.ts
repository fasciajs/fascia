import type { Grammar } from '@fascia-internal/grammar'
import {
  arkGrammar,
  effectGrammar,
  numbers,
  VALUES,
  valuesNear,
  zodGrammar
} from '@fascia-internal/grammar'
import { arktypeSource } from '@fasciajs/arktype'
import type { Source } from '@fasciajs/core'
import { describe as description, isError } from '@fasciajs/core'
import { effectSource } from '@fasciajs/effect'
import { spellJsonSchemaAll } from '@fasciajs/json-schema'
import { zodSource } from '@fasciajs/zod'
import { default as Ajv } from 'ajv'
import { Ajv2020 } from 'ajv/dist/2020.js'
import { default as formats } from 'ajv-formats'
import { JSONSchema, Schema } from 'effect'
import { describe, expect, it } from 'vitest'
import * as z from 'zod'

/**
 * The same schema, written by somebody else.
 *
 * arktype, zod and effect each write JSON Schema from their own schemas, which is the pair of steps
 * this library performs with a frontend and a target. Compared by what the two documents accept,
 * because two correct writers disagree about shape. Whichever document differs from the validator is
 * the wrong one, so a finding against the reference is reported as the reference's.
 */

const RUN = { seed: 1, rounds: 300, depth: 2 }

interface Surveyed {
  readonly ours: readonly string[]
  readonly theirs: readonly string[]
  readonly agreed: number
  readonly compared: number
}

function survey<S>(
  source: Source<S>,
  grammar: Grammar<S>,
  writes: (schema: S) => unknown,
  /** effect writes draft-07 and the other two write 2020-12. */
  dialect: '2020-12' | 'draft-07' = '2020-12'
): Surveyed {
  const ajv = new Ajv2020({ strict: false, allErrors: false })
  formats.default(ajv)
  const reader =
    dialect === '2020-12'
      ? ajv
      : formats.default(new Ajv.default({ strict: false, allErrors: false }))

  const next = numbers(RUN.seed)
  const ours: string[] = []
  const theirs: string[] = []
  let agreed = 0
  let compared = 0

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

    let asWritten: ReturnType<typeof ajv.compile>
    let asReference: ReturnType<typeof ajv.compile>
    try {
      asReference = reader.compile(writes(subject.schema) as object)
    } catch {
      continue
    }
    try {
      asWritten = ajv.compile(spelled.written as object)
    } catch {
      continue
    }

    compared += 1
    const written = JSON.stringify(spelled.written)

    for (const value of [...VALUES, ...valuesNear(described.term, described.definitions)]) {
      const byWritten = asWritten(value) === true
      const byReference = asReference(value) === true
      if (byWritten === byReference) {
        agreed += 1
        continue
      }

      let bySchema: boolean
      try {
        bySchema = subject.accepts(value)
      } catch {
        continue
      }

      if (byWritten !== bySchema) {
        ours.push(
          `${JSON.stringify(value)} is ${byWritten ? 'taken' : 'refused'} by ${written}, and the validator says ${bySchema}`
        )
      }
      if (byReference !== bySchema) {
        theirs.push(
          `${JSON.stringify(value)} is ${byReference ? 'taken' : 'refused'} by ${JSON.stringify(writes(subject.schema))}, and the validator says ${bySchema}`
        )
      }
    }
  }

  return { ours, theirs, agreed, compared }
}

/**
 * Each reference, and how often its own document differs from its own verdict at this seed.
 *
 * zod's 45 are one tuple written with neither `minItems` nor `items`. effect's 63 are one struct
 * written `additionalProperties: false`, which effect itself strips rather than refuses. The number
 * moves when the reference changes, which is what a run against one has to notice.
 */
const surveys = [
  [
    'arktype',
    0,
    survey(arktypeSource, arkGrammar, (schema: { toJsonSchema: () => unknown }) =>
      schema.toJsonSchema()
    )
  ],
  [
    'zod',
    45,
    survey(zodSource, zodGrammar, (schema: z.core.$ZodType) =>
      z.toJSONSchema(schema, { io: 'input' })
    )
  ],
  [
    'effect',
    63,
    survey(
      effectSource,
      effectGrammar,
      // The grammar hands the AST, and effect writes from a schema.
      (ast: Parameters<typeof effectSource.read>[0]) => JSONSchema.make(Schema.make(ast)),
      'draft-07'
    )
  ]
] as const

describe('a document written here accepts what the validator own document accepts', () => {
  for (const [what, , surveyed] of surveys) {
    it(`agrees with ${what} over ${RUN.rounds} schemas from seed ${RUN.seed} at depth ${RUN.depth}`, () => {
      expect(surveyed.ours).toEqual([])

      expect(surveyed.compared).toBeGreaterThan(RUN.rounds / 2)
      expect(surveyed.agreed).toBeGreaterThan(RUN.rounds)
    })
  }

  for (const [what, known, surveyed] of surveys) {
    it(`counts what ${what} own document says that ${what} refuses`, () => {
      expect(surveyed.theirs.length, surveyed.theirs[0] ?? '').toBe(known)
    })
  }
})
