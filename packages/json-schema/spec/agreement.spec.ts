import { describe as description, isError } from '@fasciajs/core'
import { spellJsonSchema } from '@fasciajs/json-schema'
import { zodSource } from '@fasciajs/zod'
import { Ajv2020 } from 'ajv/dist/2020.js'
import { default as formats } from 'ajv-formats'
import { describe, expect, it } from 'vitest'
import type * as z from 'zod'
import { numbers, schemaOf, VALUES } from './lib/grammar.js'

/**
 * **Does the document accept a value exactly when the schema does?**
 *
 * Nothing else in this repository can see this. Every other check asks whether something is well
 * formed or well typed, and this asks whether it is *true*. Types constrain shape, and what the
 * whole library is for is a statement about behaviour.
 *
 * One-directional, deliberately. It asserts the document never **rejects** what the schema accepts,
 * not that the two agree. This library widens on purpose in places, and asserting equality would
 * bury the one direction that breaks a client under failures that are all intended. Widening is
 * counted and printed instead, and a number moving is what a reader watches.
 *
 * A subject that reaches no verdict is counted too. A skip is indistinguishable from a pass in a
 * number that counts only findings, which is how a check of this shape passes over documents nobody
 * generated.
 */

const SEED = Number(process.env['AGREEMENT_SEED'] ?? 1)
const ROUNDS = Number(process.env['AGREEMENT_ROUNDS'] ?? 300)
const DEPTH = Number(process.env['AGREEMENT_DEPTH'] ?? 2)

interface Counted {
  narrower: { schema: string; value: unknown; document: unknown }[]
  wider: number
  agreed: number
  refused: number
  uncompilable: number
}

function accepts(schema: z.core.$ZodType, value: unknown): boolean {
  // Asked of the schema rather than of a reading of it. Whether zod takes a value is zod's answer.
  const parsed = (
    schema as unknown as { safeParse: (value: unknown) => { success: boolean } }
  ).safeParse(value)
  return parsed.success
}

describe('the document never rejects what the schema accepts', () => {
  it(`agrees over ${ROUNDS} schemas from seed ${SEED} at depth ${DEPTH}`, () => {
    // Formats are added, or a `format` keyword is ignored and a measurement of nothing looks like
    // agreement.
    const ajv = new Ajv2020({ strict: false, allErrors: false })
    formats.default(ajv)
    const next = numbers(SEED)
    const counted: Counted = { narrower: [], wider: 0, agreed: 0, refused: 0, uncompilable: 0 }

    for (let round = 0; round < ROUNDS; round += 1) {
      const schema = schemaOf(next, DEPTH)

      const described = description(schema, zodSource)
      if (isError(described)) {
        counted.refused += 1
        continue
      }

      const spelled = spellJsonSchema(described.term)
      if (isError(spelled)) {
        counted.refused += 1
        continue
      }

      let validate: ReturnType<typeof ajv.compile>
      try {
        validate = ajv.compile(spelled.written as object)
      } catch {
        counted.uncompilable += 1
        continue
      }

      for (const value of VALUES) {
        const bySchema = accepts(schema, value)
        const byDocument = validate(value) === true

        if (bySchema && !byDocument) {
          counted.narrower.push({
            schema: JSON.stringify(spelled.written),
            value,
            document: spelled.written
          })
        } else if (!bySchema && byDocument) {
          counted.wider += 1
        } else {
          counted.agreed += 1
        }
      }
    }

    // Printed, because two of these are watched for movement rather than asserted. A skipped
    // subject is invisible in a count of findings, so both skips are printed beside them.
    console.log(
      `agreement: ${counted.narrower.length} narrower, ${counted.wider} wider, ${counted.agreed} agreed, ` +
        `${counted.refused} refused, ${counted.uncompilable} uncompilable`
    )

    const [first] = counted.narrower
    expect(
      counted.narrower.length,
      first === undefined
        ? ''
        : `the document refused a value the schema takes: ${JSON.stringify(first.value)} against ${first.schema}`
    ).toBe(0)

    // A subject that reached no verdict proves nothing, and a run of nothing but skips would
    // otherwise report perfect agreement.
    expect(counted.uncompilable).toBe(0)
    expect(counted.agreed).toBeGreaterThan(0)
  })
})
