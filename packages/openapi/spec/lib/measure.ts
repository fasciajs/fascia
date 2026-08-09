import type { Grammar } from '@fascia-internal/grammar'
import { numbers, VALUES } from '@fascia-internal/grammar'
import type { Source } from '@fasciajs/core'
import { describe as description, isError } from '@fasciajs/core'
import { spellJsonSchemaAll } from '@fasciajs/json-schema'
import { toV30 } from '@fasciajs/openapi'
import { Ajv2020 } from 'ajv/dist/2020.js'
import { fromV30 } from './reverse.js'

/**
 * Whether the two dialects of one target accept the same values.
 *
 * **A differential rather than a new instrument.** Ajv reads JSON Schema and `nullable` is not one
 * of its words, so a 3.0 document cannot be handed to it. What can is the 2020-12 recovered from
 * one, and the claim then reads plainly: a schema and its round trip through 3.0 accept the same
 * values. The only thing under test is the translation, and the answers come from the validator that
 * already measures 3.1.
 *
 * So this is weaker than the 3.1 check in one way and stronger in another. Weaker, because the way
 * back was written here and a fault shared by both directions would cancel; the round trip spec is
 * what holds that down, by reading the recovered schema against what 2020-12 wrote. Stronger,
 * because it measures the claim two dialects make about each other rather than about a document.
 */

export interface Measured {
  readonly narrower: { readonly value: unknown; readonly document: string }[]
  wider: number
  agreed: number
  refused: number
  uncompilable: number
  threw: number
}

export interface Run {
  readonly seed: number
  readonly rounds: number
  readonly depth: number
}

export function measure<S>(source: Source<S>, grammar: Grammar<S>, run: Run): Measured {
  const ajv = new Ajv2020({ strict: false, allErrors: false })
  const next = numbers(run.seed)
  const measured: Measured = {
    narrower: [],
    wider: 0,
    agreed: 0,
    refused: 0,
    uncompilable: 0,
    threw: 0
  }

  for (let round = 0; round < run.rounds; round += 1) {
    const subject = grammar(next, run.depth)

    const described = description(subject.schema, source, 'input')
    if (isError(described)) {
      measured.refused += 1
      continue
    }

    const spelled = spellJsonSchemaAll(described)
    if (isError(spelled)) {
      measured.refused += 1
      continue
    }

    let asWritten: ReturnType<typeof ajv.compile>
    let asRecovered: ReturnType<typeof ajv.compile>
    try {
      asWritten = ajv.compile(spelled.written as object)
      asRecovered = ajv.compile(fromV30(toV30(spelled.written).written) as object)
    } catch {
      measured.uncompilable += 1
      continue
    }

    for (const value of VALUES) {
      const byWritten = asWritten(value) === true
      const byRecovered = asRecovered(value) === true

      if (byWritten && !byRecovered) {
        measured.narrower.push({
          value,
          document: JSON.stringify(toV30(spelled.written).written)
        })
      } else if (!byWritten && byRecovered) {
        measured.wider += 1
      } else {
        measured.agreed += 1
      }
    }
  }

  return measured
}

export function counts(what: string, measured: Measured): string {
  return (
    `${what}: ${measured.narrower.length} narrower, ${measured.wider} wider, ` +
    `${measured.agreed} agreed, ${measured.refused} refused, ${measured.uncompilable} uncompilable`
  )
}

export function firstNarrowing(measured: Measured): string {
  const [first] = measured.narrower
  return first === undefined
    ? ''
    : `3.0 refused a value 3.1 takes: ${JSON.stringify(first.value)} against ${first.document}`
}
