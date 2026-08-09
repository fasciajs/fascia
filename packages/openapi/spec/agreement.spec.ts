import { arkGrammar, effectGrammar, valibotGrammar, zodGrammar } from '@fascia-internal/grammar'
import { arktypeSource } from '@fasciajs/arktype'
import { effectSource } from '@fasciajs/effect'
import { valibotSource } from '@fasciajs/valibot'
import { zodSource } from '@fasciajs/zod'
import { describe, expect, it } from 'vitest'
import { counts, firstNarrowing, measure } from './lib/measure.js'

/**
 * **Do the two dialects of one target accept the same values?**
 *
 * 3.1 is measured against schemas directly, because a 3.1 schema is a 2020-12 schema and Ajv reads
 * one. 3.0 cannot be handed to a validator at all: `nullable` is not a word JSON Schema has. So the
 * claim measured here is the one the two dialects make about each other, and the answers come from
 * the validator that already measures 3.1.
 *
 * What is wider is what the translation reported: a positional form has no 3.0 keyword, so every
 * tuple widens. What must not happen is narrower, and one such defect was found by reading before
 * this ran: `nullable` beside a reference is ignored by 3.0, which loses the null.
 */

const SEED = Number(process.env['AGREEMENT_SEED'] ?? 1)
const ROUNDS = Number(process.env['AGREEMENT_ROUNDS'] ?? 300)
const DEPTH = Number(process.env['AGREEMENT_DEPTH'] ?? 2)

const run = { seed: SEED, rounds: ROUNDS, depth: DEPTH }

describe('3.0 accepts what 3.1 accepts', () => {
  const cases = [
    ['zod', () => measure(zodSource, zodGrammar, run)],
    ['arktype', () => measure(arktypeSource, arkGrammar, run)],
    ['effect', () => measure(effectSource, effectGrammar, run)],
    ['valibot', () => measure(valibotSource, valibotGrammar, run)]
  ] as const

  for (const [what, measured] of cases) {
    it(`agrees over ${ROUNDS} schemas from ${what} at depth ${DEPTH}`, () => {
      const found = measured()

      console.log(counts(what, found))

      expect(found.narrower.length, firstNarrowing(found)).toBe(0)
      expect(found.uncompilable).toBe(0)
      expect(found.agreed).toBeGreaterThan(0)
    })
  }
})
