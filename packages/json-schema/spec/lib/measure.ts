import type { Grammar } from '@fascia-internal/grammar'
import { numbers, VALUES } from '@fascia-internal/grammar'
import type { Source } from '@fasciajs/core'
import { describe as description, isError } from '@fasciajs/core'
import { spellJsonSchemaAll } from '@fasciajs/json-schema'
import { Ajv2020 } from 'ajv/dist/2020.js'
import { default as formats } from 'ajv-formats'

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

/**
 * How often a document written from a grammar's schemas refuses a value the schema takes.
 *
 * The frontend is a parameter, so the reader under test changes and the target does not. A finding
 * here names the reader almost always: the speller is one and the same, and it is measured already
 * by whichever frontend ran first.
 */
export function measure<S>(source: Source<S>, grammar: Grammar<S>, run: Run): Measured {
  // Formats are added, or a `format` keyword is ignored and a measurement of nothing looks like
  // agreement.
  const ajv = new Ajv2020({ strict: false, allErrors: false })
  formats.default(ajv)

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

    // The whole description, definitions and all. A frontend that names a schema of its own makes a
    // reference, and a document holding a reference to nothing compiles as nothing: effect names
    // `Int`, and every document beneath one was skipped while the run reported agreement.
    const spelled = spellJsonSchemaAll(described)
    if (isError(spelled)) {
      measured.refused += 1
      continue
    }

    let validate: ReturnType<typeof ajv.compile>
    try {
      validate = ajv.compile(spelled.written as object)
    } catch {
      measured.uncompilable += 1
      continue
    }

    for (const value of VALUES) {
      // A validator that throws states no verdict, so there is nothing to compare against. arktype
      // does, and the spec beside this file names the shape. Counted rather than swallowed: a
      // throw read as a refusal would report a widening that the schema never stated.
      let bySchema: boolean
      try {
        bySchema = subject.accepts(value)
      } catch {
        measured.threw += 1
        continue
      }

      const byDocument = validate(value) === true

      if (bySchema && !byDocument) {
        measured.narrower.push({ value, document: JSON.stringify(spelled.written) })
      } else if (!bySchema && byDocument) {
        measured.wider += 1
      } else {
        measured.agreed += 1
      }
    }
  }

  return measured
}

/**
 * What the run found, in one line.
 *
 * Two of these numbers are watched for movement rather than asserted, so they are printed. A skipped
 * subject is invisible in a count of findings, so both skips are printed beside them.
 */
export function counts(what: string, measured: Measured): string {
  return (
    `${what}: ${measured.narrower.length} narrower, ${measured.wider} wider, ` +
    `${measured.agreed} agreed, ${measured.refused} refused, ${measured.uncompilable} uncompilable, ` +
    `${measured.threw} threw`
  )
}

/** The first narrowing, named by the value and the document that refused it. */
export function firstNarrowing(measured: Measured): string {
  const [first] = measured.narrower
  return first === undefined
    ? ''
    : `the document refused a value the schema takes: ${JSON.stringify(first.value)} against ${first.document}`
}
