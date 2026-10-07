import type { Grammar } from '@fascia-internal/grammar'
import { numbers, VALUES } from '@fascia-internal/grammar'
import type { Source } from '@fasciajs/core'
import { describe as description, isError } from '@fasciajs/core'
import { spellJsonSchemaAll } from '@fasciajs/json-schema'
import { toV30 } from '@fasciajs/openapi'
import { Ajv2020 } from 'ajv/dist/2020.js'
import { default as AjvDraft04 } from 'ajv-draft-04'
import { default as formats } from 'ajv-formats'

/**
 * Whether the two dialects of one target accept the same values.
 *
 * Each document is asked of the Ajv for its own dialect. Ajv for draft-04 holds the boolean bounds
 * 3.0 took from it, and holds `nullable` as OpenAPI 3.0 states it: null joins the one type beside
 * the flag, and a flag with no type beside it does not compile. So nothing written here stands
 * between the 3.0 document and the validator.
 *
 * A way back from 3.0 was written here before. It read `nullable` wherever the flag stood, which the
 * specification does not, and so it compiled a document Ajv refuses: a reference wrapped with the
 * flag beside it. The check passed over the defect it existed to find.
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
  // Formats are added, or a `format` keyword is ignored and a measurement of nothing looks like
  // agreement. Ajv says so out loud: it prints `unknown format "uuid" ignored` and answers true.
  const ajv = new Ajv2020({ strict: false, allErrors: false })
  formats.default(ajv)
  const ajv30 = new AjvDraft04.default({ strict: false, allErrors: false })
  formats.default(ajv30)
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
    let asRecovered: ReturnType<typeof ajv30.compile>
    try {
      asWritten = ajv.compile(spelled.written as object)
      asRecovered = ajv30.compile(toV30(spelled.written).written as object)
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
