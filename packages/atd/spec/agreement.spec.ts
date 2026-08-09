import { compile, nullable, schemaToJsonSchema, stringEnum } from '@arrirpc/schema'
import { arkGrammar, effectGrammar, zodGrammar } from '@fascia-internal/grammar'
import { arktypeSource } from '@fasciajs/arktype'
import { effectSource } from '@fasciajs/effect'
import { zodSource } from '@fasciajs/zod'
import { Ajv2020 } from 'ajv/dist/2020.js'
import { describe, expect, it } from 'vitest'
import { counts, firstNarrowing, measure } from './lib/measure.js'

/**
 * **Does an ATD document accept a value exactly when its schema does?**
 *
 * Every other check in this package asks whether a document is well formed, and the codegen spec
 * asks whether arri can use one. Neither asks whether it is **true**. A client generated from a
 * wrong document is a wrong client that compiles.
 *
 * ATD gives up more than any other target here: it refuses a disjunction that is not chosen by a
 * tag, refuses an intersection, widens every tuple, drops every assertion a string carries, and
 * picks an integer width. So a great deal is wider on purpose. What must not happen is narrower,
 * and until this ran nothing had measured it.
 *
 * The schemas are the ones the JSON Schema check draws, so the two targets are measured over one
 * grammar and the numbers are comparable. A grammar tuned to ATD would report what ATD is good at.
 */

const SEED = Number(process.env['AGREEMENT_SEED'] ?? 1)
const ROUNDS = Number(process.env['AGREEMENT_ROUNDS'] ?? 300)
const DEPTH = Number(process.env['AGREEMENT_DEPTH'] ?? 2)

const run = { seed: SEED, rounds: ROUNDS, depth: DEPTH }

describe('an ATD document never rejects what its schema accepts', () => {
  const cases = [
    ['zod', () => measure(zodSource, zodGrammar, run)],
    ['arktype', () => measure(arktypeSource, arkGrammar, run)],
    ['effect', () => measure(effectSource, effectGrammar, run)]
  ] as const

  for (const [what, measured] of cases) {
    it(`agrees with ${what} over ${ROUNDS} schemas from seed ${SEED} at depth ${DEPTH}`, () => {
      const found = measured()

      console.log(counts(what, found))

      expect(found.narrower.length, firstNarrowing(found)).toBe(0)

      // A subject that reached no verdict proves nothing. ATD refuses a great deal outright, which
      // is counted rather than asserted, and a document nothing could parse is counted apart.
      expect(found.uncompilable).toBe(0)
      expect(found.agreed).toBeGreaterThan(0)
    })
  }
})

describe('what the oracle gets wrong, and what this check does about it', () => {
  it("converts a nullable enum to a schema that refuses the null arri's runtime takes", () => {
    // A fault in the instrument rather than in what it measures, found by the check above on its
    // first run. arri's runtime accepts null for this document, and arri's own conversion of it to
    // JSON Schema does not: `enum` admits the values listed and no others, whatever `type` says.
    //
    // Pinned here so the correction in the harness is visible and so a run reports it if arri
    // changes the conversion. The ATD document this library writes is the one arri's runtime reads.
    const document = { enum: ['a'], isNullable: true }

    expect(schemaToJsonSchema(document)).toEqual({ type: ['string', 'null'], enum: ['a'] })
    expect(new Ajv2020({ strict: false }).compile(schemaToJsonSchema(document))(null)).toBe(false)

    // What arri itself does with the same document.
    expect(compile(nullable(stringEnum(['a']))).validate(null)).toBe(true)
  })
})
