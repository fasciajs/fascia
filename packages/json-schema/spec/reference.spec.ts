import { arkGrammar, numbers, VALUES, valuesNear } from '@fascia-internal/grammar'
import { arktypeSource } from '@fasciajs/arktype'
import { describe as description, isError } from '@fasciajs/core'
import { spellJsonSchemaAll } from '@fasciajs/json-schema'
import { Ajv2020 } from 'ajv/dist/2020.js'
import { default as formats } from 'ajv-formats'
import { describe, expect, it } from 'vitest'

/**
 * **The same schema, written by somebody else.**
 *
 * Every other check here asks a validator whether a value is admitted, and a validator answers about
 * values. This asks a second implementation what the document should *be*: arktype writes 2020-12
 * from its own schemas through `toJsonSchema`, which is the pair of steps this library performs with
 * a frontend and a target, done by the library that owns the schema.
 *
 * So the reference is stronger than a validator in the way that matters. Ajv can only find a
 * disagreement a value in the pool reaches. A second writer disagrees about a keyword whether or not
 * any value shows it, and the value that separates the two documents names the keyword.
 *
 * **The two documents are compared by what they accept, not by their shape.** Two correct writers
 * disagree about shape all the time: `enum` against `const`, a type list against `anyOf`. What they
 * may not disagree about is which values pass.
 *
 * A disagreement is attributed by asking arktype itself. Whichever document differs from the
 * validator is the wrong one, and this is not a check that assumes the reference is right.
 *
 * It found one. arktype wrote `minItems` for a tuple and this library wrote none, so a document from
 * here accepted the empty list against a tuple of one position, 58 times over 300 schemas. 2020-12
 * had the keyword and the term had thrown away how many positions must be present.
 */

const RUN = { seed: 1, rounds: 300, depth: 2 }

/** arktype writes its own 2020-12 from the schema this library was handed. */
function ownWriting(schema: unknown): unknown {
  return (schema as { toJsonSchema: () => unknown }).toJsonSchema()
}

interface Surveyed {
  readonly ours: readonly string[]
  readonly theirs: readonly string[]
  readonly agreed: number
  readonly compared: number
}

function survey(): Surveyed {
  // Formats are added, or a `format` keyword is ignored and a measurement of nothing looks like
  // agreement.
  const ajv = new Ajv2020({ strict: false, allErrors: false })
  formats.default(ajv)

  const next = numbers(RUN.seed)
  const ours: string[] = []
  const theirs: string[] = []
  let agreed = 0
  let compared = 0

  for (let round = 0; round < RUN.rounds; round += 1) {
    const subject = arkGrammar(next, RUN.depth)

    const described = description(subject.schema, arktypeSource, 'input')
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
      // A construct arktype declines to write is arktype saying so, and not a finding here.
      asReference = ajv.compile(ownWriting(subject.schema) as object)
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

      // arktype settles which of the two documents is wrong. A validator that throws states no
      // verdict, and a disagreement nobody can attribute is not a finding either way.
      let bySchema: boolean
      try {
        bySchema = subject.accepts(value)
      } catch {
        continue
      }

      if (byWritten !== bySchema) {
        ours.push(
          `${JSON.stringify(value)} is ${byWritten ? 'taken' : 'refused'} by ${written}, and arktype says ${bySchema}`
        )
      }
      if (byReference !== bySchema) {
        theirs.push(
          `${JSON.stringify(value)} is ${byReference ? 'taken' : 'refused'} by ${JSON.stringify(ownWriting(subject.schema))}, and arktype says ${bySchema}`
        )
      }
    }
  }

  return { ours, theirs, agreed, compared }
}

const surveyed = survey()

describe('a document written here accepts what arktype own document accepts', () => {
  it(`agrees over ${RUN.rounds} schemas from seed ${RUN.seed} at depth ${RUN.depth}`, () => {
    expect(surveyed.ours).toEqual([])

    // A run that compiled nothing would report perfect agreement over no document at all.
    expect(surveyed.compared).toBeGreaterThan(RUN.rounds / 2)
    expect(surveyed.agreed).toBeGreaterThan(RUN.rounds)
  })

  it('names the reference where the reference is the one that differs', () => {
    // Not an assertion that arktype is right. A finding here is arktype's, and the run reports it
    // rather than counting it against this library.
    expect(surveyed.theirs).toEqual([])
  })
})
