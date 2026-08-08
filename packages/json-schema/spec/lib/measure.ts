import type { Source } from '@fasciajs/core'
import { describe as description, isError } from '@fasciajs/core'
import { spellJsonSchemaAll } from '@fasciajs/json-schema'
import { Ajv2020 } from 'ajv/dist/2020.js'
import { default as formats } from 'ajv-formats'

/**
 * One schema drawn from a grammar, and the validator's own answer about a value.
 *
 * The answer is asked of the validator rather than of a reading of it. A reading asked twice agrees
 * with itself whatever it says, which measures nothing.
 */
export interface Subject<S> {
  readonly schema: S
  readonly accepts: (value: unknown) => boolean
}

/** A grammar: a schema of a validator, drawn from a source of numbers. */
export type Grammar<S> = (next: () => number, depth: number) => Subject<S>

export interface Measured {
  readonly narrower: { readonly value: unknown; readonly document: string }[]
  wider: number
  agreed: number
  refused: number
  uncompilable: number
  threw: number
}

/** A deterministic source of numbers. An unreproducible failure is a rumour rather than a report. */
export function numbers(seed: number): () => number {
  let state = seed >>> 0

  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let drawn = Math.imul(state ^ (state >>> 15), 1 | state)
    drawn = (drawn + Math.imul(drawn ^ (drawn >>> 7), 61 | drawn)) ^ drawn
    return ((drawn ^ (drawn >>> 14)) >>> 0) / 4294967296
  }
}

export function pick<T>(next: () => number, choices: readonly T[]): T {
  const chosen = choices[Math.floor(next() * choices.length)]
  if (chosen === undefined) {
    throw new Error('the grammar drew from nothing')
  }
  return chosen
}

/**
 * The values every subject is asked about.
 *
 * Fixed rather than derived from the schema in hand, because the values that tell two readings apart
 * are the ones a schema's own shape would not suggest: the empty array against a tuple's bounds,
 * `null` against everything, a fractional number against a whole one.
 */
export const VALUES: readonly unknown[] = [
  null,
  true,
  false,
  0,
  1,
  -1,
  1.5,
  2,
  9,
  10,
  '',
  'a',
  'abc',
  'abcdefgh',
  [],
  [1],
  ['a'],
  ['a', 1],
  ['a', 1, 'extra'],
  {},
  { a: 'a' },
  { a: 1 },
  { a: 'a', b: 1 },
  { a: 'a', extra: true },
  { kind: 'a' },
  { kind: 'b', b: 1 }
]

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

    const described = description(subject.schema, source)
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
