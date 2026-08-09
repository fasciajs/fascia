import { schemaToJsonSchema } from '@arrirpc/schema'
import type { Grammar } from '@fascia-internal/grammar'
import { numbers, VALUES } from '@fascia-internal/grammar'
import type { AtdSchema } from '@fasciajs/atd'
import { spellAtdAll } from '@fasciajs/atd'
import type { Source } from '@fasciajs/core'
import { describe as description, isError } from '@fasciajs/core'
import { Ajv2020 } from 'ajv/dist/2020.js'

/**
 * How often an ATD document refuses a value its schema takes.
 *
 * **arri says what its own document means, and Ajv answers about values.** `schemaToJsonSchema` is
 * arri's own reading of a plain ATD document, so the path is this library's spelling, then arri's
 * reading of it, then a validator that knows neither. A defect in the spelling shows up here; so
 * would one in arri's reading, and that is the same standing `isAppDefinition` has in the spec
 * beside this one.
 *
 * Two other paths were tried and are worth naming. `compile` wants arri's builder schema and, given
 * a plain document, returns a validator that accepts every value: a check written on it would have
 * reported perfect agreement over documents nothing read. `getCompiledParser` returns a raw function
 * that expects a validation context and emits a separate parser per definition, so a reference at
 * the root is not defined and a refusal arrives as a TypeError rather than as a verdict.
 *
 * One-directional, as the JSON Schema check is. ATD gives up more than any target here, so a great
 * deal is wider on purpose and asserting equality would bury the direction that breaks a client.
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

    const spelled = spellAtdAll(described)
    if (isError(spelled)) {
      measured.refused += 1
      continue
    }

    let validate: ReturnType<typeof ajv.compile>
    try {
      validate = ajv.compile(asJsonSchema(spelled.written))
    } catch {
      measured.uncompilable += 1
      continue
    }

    for (const value of VALUES) {
      let bySchema: boolean
      try {
        bySchema = subject.accepts(value)
      } catch {
        measured.threw += 1
        continue
      }

      const byDocument = validate(value) === true

      if (bySchema && !byDocument) {
        measured.narrower.push({ value, document: JSON.stringify(spelled.written.root) })
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
 * What arri says the document means, as a schema a validator can run.
 *
 * The definitions are converted one by one and put under `$defs`, because arri writes a reference as
 * `#/$defs/<name>` and converts one schema at a time.
 */
function asJsonSchema(written: {
  readonly root: AtdSchema
  readonly definitions: Readonly<Record<string, AtdSchema>>
}): object {
  const $defs: Record<string, unknown> = {}
  for (const [name, definition] of Object.entries(written.definitions)) {
    $defs[name] = corrected(schemaToJsonSchema(definition))
  }

  const root = corrected(schemaToJsonSchema(written.root))
  return Object.keys($defs).length === 0 ? root : { ...root, $defs }
}

/**
 * One fault in the instrument, corrected so the check measures what it is for.
 *
 * arri converts a nullable enum to `{ type: ['string', 'null'], enum: [...] }`, and JSON Schema's
 * `enum` admits the listed values and no others whatever `type` says, so the result refuses a null
 * that arri's own runtime accepts. The ATD document is right and the conversion is not.
 *
 * Corrected here rather than excluded, so the case stays measured, and pinned by a spec beside this
 * file so a run reports it if arri changes the conversion.
 */
function corrected(written: unknown): object {
  if (typeof written !== 'object' || written === null) {
    return {}
  }

  const stated = written as { type?: unknown; enum?: unknown }
  const admitsNull = Array.isArray(stated.type) && stated.type.includes('null')

  return admitsNull && Array.isArray(stated.enum)
    ? { ...stated, enum: [...stated.enum, null] }
    : stated
}

export function counts(what: string, measured: Measured): string {
  return (
    `${what}: ${measured.narrower.length} narrower, ${measured.wider} wider, ` +
    `${measured.agreed} agreed, ${measured.refused} refused, ${measured.uncompilable} uncompilable, ` +
    `${measured.threw} threw`
  )
}

export function firstNarrowing(measured: Measured): string {
  const [first] = measured.narrower
  return first === undefined
    ? ''
    : `the document refused a value the schema takes: ${JSON.stringify(first.value)} against ${first.document}`
}
