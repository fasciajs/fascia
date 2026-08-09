import type { BaseRoot } from '@ark/schema'
import { arktypeSource } from '@fasciajs/arktype'
import { describe as description, isError } from '@fasciajs/core'
import { effectSource } from '@fasciajs/effect'
import { arkGrammar, effectGrammar, zodGrammar } from '@fasciajs/grammar'
import { spellJsonSchemaAll } from '@fasciajs/json-schema'
import { zodSource } from '@fasciajs/zod'
import { Ajv2020 } from 'ajv/dist/2020.js'
import { type } from 'arktype'
import { describe, expect, it } from 'vitest'
import { counts, firstNarrowing, measure } from './lib/measure.js'

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
 *
 * **Run once per frontend, because the reader is what each run measures.** The target is one and the
 * same across the three, so a finding under arktype or effect names that reader: the speller was
 * already measured by the run before it. The three readers disagree about almost everything
 * structurally, and the one defect this shape has already found in a reader by hand was effect's,
 * which no zod run could have reached.
 */

const SEED = Number(process.env['AGREEMENT_SEED'] ?? 1)
const ROUNDS = Number(process.env['AGREEMENT_ROUNDS'] ?? 300)
const DEPTH = Number(process.env['AGREEMENT_DEPTH'] ?? 2)

const run = { seed: SEED, rounds: ROUNDS, depth: DEPTH }

describe('the document never rejects what the schema accepts', () => {
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

      // A subject that reached no verdict proves nothing, and a run of nothing but skips would
      // otherwise report perfect agreement.
      expect(found.uncompilable).toBe(0)
      expect(found.agreed).toBeGreaterThan(0)
    })
  }
})

describe('what the arktype grammar leaves out, and why', () => {
  it('refuses an array where arktype takes one, because an object admits one in JavaScript', () => {
    // The property found this on its first run and the grammar drops the construct, so the fact is
    // stated here rather than left to a comment nothing runs. arktype's `object` domain is the
    // JavaScript one and an array is an object in JavaScript. A document has no word for a domain
    // that holds both, so this is the one direction that breaks a client and no reading fixes it:
    // the term would have to say a thing JSON cannot name.
    const schema = type.raw({ '[string]': 'number' })
    expect(schema([]) instanceof type.errors).toBe(false)

    const described = description(schema as unknown as BaseRoot, arktypeSource, 'input')
    if (isError(described)) {
      throw new Error(described.message)
    }
    const spelled = spellJsonSchemaAll(described)
    if (isError(spelled)) {
      throw new Error(spelled.message)
    }

    const validate = new Ajv2020({ strict: false }).compile(spelled.written as object)
    expect(validate([])).toBe(false)
  })

  it('throws instead of stating a verdict, which is why a throw is counted rather than read', () => {
    // arktype's own defect, found by the grammar and reduced to this. The compiled union checks the
    // tuple branch's key on an element without asking its domain first, so `'a' in 1` runs. A throw
    // read as a refusal would report the document as wider than a schema that stated nothing.
    const schema = type.raw([{ a: 'string' }, { a: '1' }]).or('number[]')

    expect(() => schema(['a', 1])).toThrow("Cannot use 'in' operator")
  })
})
