import type { Grammar } from '@fascia-internal/grammar'
import {
  arkGrammar,
  effectGrammar,
  numbers,
  VALUES,
  valibotGrammar,
  zodGrammar
} from '@fascia-internal/grammar'
import { arktypeSource } from '@fasciajs/arktype'
import type { Described, Source } from '@fasciajs/core'
import { admits, describe as description, isError } from '@fasciajs/core'
import { effectSource } from '@fasciajs/effect'
import { valibotSource } from '@fasciajs/valibot'
import { zodSource } from '@fasciajs/zod'
import { describe, expect, it } from 'vitest'

/**
 * **The laws of the read layer and the describe layer, stated once and driven over drawn schemas.**
 *
 * Every other generative check here compares a validator against a document, and one number carries
 * two questions: whether the frontend read the schema, and whether the target wrote the term. This
 * file asks only about the half before a target: what a reading owes, and what a term owes the
 * schema it was read from.
 *
 * Three laws, and each is a statement a reader can check rather than a number to watch.
 *
 * **(T) A reading answers, or it names its failure.** `read` returns `Node | UnreadableSchema`, so a
 * throw from a frontend is a failure the signature does not declare. A validator may throw and that
 * is the validator's business; a reading of one may not.
 *
 * **(N) A term is never narrower than the schema it was read from.** A term wider than the schema is
 * a loss this library reports and a caller can live with. A term narrower than the schema turns a
 * working value away, and no departure records it, because a reading that dropped an assertion
 * cannot know it dropped one. This is the law the whole library rests on.
 *
 * **(C) The run states every case of the term.** A law proved over drawn schemas is proved over what
 * the schemas state and over nothing else. A case no grammar draws is a case where (T) and (N) hold
 * vacuously, and a count of findings cannot tell that apart from a case that holds. So what the run
 * never states is written down here with the reason, and a new one fails.
 */

const RUN = { seed: 1, rounds: 300, depth: 2 }

/**
 * What the run never states, and why.
 *
 * A name leaves this map when a grammar draws the case. A name arrives in it when a case stops being
 * drawn, and that is the failure: the two laws above went quiet about the case and said nothing
 * about it while reporting no findings.
 */
const UNCOVERED: ReadonlyMap<string, string> = new Map([
  [
    'set',
    'no reading produces one. Every validator here states a set as a value that is not a list, and reading one is a conversion rather than a description: `zod-types.ts` says so where zod refuses it. The DynamoDB target writes one exactly, and the spec beside that target states the term directly'
  ]
])

/** Every case and every assertion a term can state. A name here that no run reaches is a finding. */
const STATED: readonly string[] = [
  'admitsNull',
  'admitted/boolean',
  'admitted/bigint',
  'admitted/null',
  'admitted/number',
  'admitted/string',
  'assert/array/maxItems',
  'assert/array/minItems',
  'assert/number/integer',
  'assert/number/maximum',
  'assert/number/minimum',
  'assert/number/multipleOf',
  'assert/string/format',
  'assert/string/maxLength',
  'assert/string/minLength',
  'assert/string/patterns',
  'discriminant',
  'every',
  'exactlyOne',
  'property/default',
  'property/optional',
  'ref',
  'rest/anything',
  'set',
  'rest/nothing',
  'rest/term',
  'some',
  'tuple',
  'tupleRest/anything',
  'tupleRest/nothing',
  'tupleRest/term',
  'typed/array',
  'typed/boolean',
  'typed/number',
  'typed/object',
  'typed/string',
  'untyped',
  'values'
]

/** What one run of one grammar found. */
interface Surveyed {
  /** (T). A frontend that threw where the signature says it returns. */
  readonly threw: readonly string[]
  /** (N). A value the schema takes and the term turns away. */
  readonly narrower: readonly string[]
  /** (C). What the drawn schemas stated. */
  readonly stated: ReadonlySet<string>
  /** A verdict neither law can use, counted so a quiet run is visible. */
  readonly undecided: number
  readonly refused: number
  readonly verdicts: number
}

function survey<S>(source: Source<S>, grammar: Grammar<S>): Surveyed {
  const next = numbers(RUN.seed)
  const threw: string[] = []
  const narrower: string[] = []
  const stated = new Set<string>()
  let undecided = 0
  let refused = 0
  let verdicts = 0

  for (let round = 0; round < RUN.rounds; round += 1) {
    const subject = grammar(next, RUN.depth)

    let describing: ReturnType<typeof description>
    try {
      describing = description(subject.schema, source, 'input')
    } catch (thrown) {
      threw.push(
        thrown instanceof Error ? thrown.message : 'a frontend threw a value that is not an error'
      )
      continue
    }
    if (isError(describing)) {
      refused += 1
      continue
    }

    state(describing.term, describing.definitions, stated, 0)

    for (const value of VALUES) {
      // A validator that throws states no verdict. That is the validator's business and not a
      // reading's, so it is skipped rather than counted against (T).
      let bySchema: boolean
      try {
        bySchema = subject.accepts(value)
      } catch {
        continue
      }

      const byTerm = admits(describing, value)
      if (isError(byTerm)) {
        undecided += 1
        continue
      }
      verdicts += 1
      if (bySchema && !byTerm) {
        narrower.push(`${JSON.stringify(value)} against ${shape(describing.term)}`)
      }
    }
  }

  return { threw, narrower, stated, undecided, refused, verdicts }
}

/** What a term states, as the names the coverage law is written in. */
function state(
  term: Described,
  definitions: ReadonlyMap<string, Described>,
  into: Set<string>,
  depth: number
): void {
  // A cycle is written as a reference, so a bound stops the walk rather than the value.
  if (depth > 8) {
    return
  }
  if (term.admitsNull) {
    into.add('admitsNull')
  }

  switch (term.kind) {
    case 'typed': {
      into.add(`typed/${term.name}`)
      // The children of a structure sit in the same bag as its assertions, and the walk names them
      // where it descends: an object by its properties and its rest, a list by its items.
      const structural = new Set(['properties', 'rest', 'items'])
      for (const key of Object.keys(term.assertions)) {
        if (!structural.has(key)) {
          into.add(`assert/${term.name}/${key}`)
        }
      }
      if (term.name === 'object') {
        for (const [, property] of term.assertions.properties) {
          if (!property.required) {
            into.add('property/optional')
          }
          if (property.default !== undefined) {
            into.add('property/default')
          }
          state(property.term, definitions, into, depth + 1)
        }
        into.add(`rest/${term.assertions.rest.allows}`)
        if (term.assertions.rest.allows === 'term') {
          state(term.assertions.rest.term, definitions, into, depth + 1)
        }
      }
      if (term.name === 'array') {
        state(term.assertions.items, definitions, into, depth + 1)
      }
      return
    }
    case 'set':
      into.add('set')
      state(term.items, definitions, into, depth + 1)
      return
    case 'values':
      into.add('values')
      for (const one of term.admitted) {
        into.add(`admitted/${one.of}`)
      }
      return
    case 'some':
    case 'every':
      into.add(term.kind)
      for (const member of term.members) {
        state(member, definitions, into, depth + 1)
      }
      return
    case 'exactlyOne':
      into.add('exactlyOne')
      if (term.discriminant !== undefined) {
        into.add('discriminant')
      }
      for (const member of term.members) {
        state(member, definitions, into, depth + 1)
      }
      return
    case 'tuple': {
      into.add('tuple')
      into.add(`tupleRest/${term.rest.allows}`)
      for (const position of term.positions) {
        state(position, definitions, into, depth + 1)
      }
      if (term.rest.allows === 'term') {
        state(term.rest.term, definitions, into, depth + 1)
      }
      return
    }
    case 'ref': {
      into.add('ref')
      const named = definitions.get(term.name)
      if (named !== undefined) {
        state(named, definitions, into, depth + 1)
      }
      return
    }
    case 'untyped':
      into.add('untyped')
      return
    default:
      term satisfies never
      throw new Error('a term carries a case this walk has no name for')
  }
}

/** A term named by its case, which is what a finding needs to be found again. */
function shape(term: Described): string {
  return term.kind === 'typed' ? `${term.kind}/${term.name}` : term.kind
}

const surveys: ReadonlyMap<string, Surveyed> = new Map([
  ['zod', survey(zodSource, zodGrammar)],
  ['arktype', survey(arktypeSource, arkGrammar)],
  ['effect', survey(effectSource, effectGrammar)],
  ['valibot', survey(valibotSource, valibotGrammar)]
])

describe('(T) a reading answers, or it names its failure', () => {
  for (const [what, surveyed] of surveys) {
    it(`reads ${RUN.rounds} schemas from ${what} without throwing`, () => {
      expect(surveyed.threw).toEqual([])
    })
  }
})

describe('(N) a term is never narrower than the schema it was read from', () => {
  for (const [what, surveyed] of surveys) {
    it(`takes every value ${what} takes, over ${RUN.rounds} schemas from seed ${RUN.seed}`, () => {
      expect(surveyed.narrower).toEqual([])

      // A run of nothing but skips reports the law held. The count is what says it was asked.
      expect(surveyed.verdicts).toBeGreaterThan(RUN.rounds)
    })
  }
})

describe('(C) the run states every case of the term', () => {
  it('leaves nothing unstated but the cases written down here, with the reason for each', () => {
    const stated = new Set<string>()
    for (const [, surveyed] of surveys) {
      for (const name of surveyed.stated) {
        stated.add(name)
      }
    }

    expect(STATED.filter((name) => !stated.has(name))).toEqual([...UNCOVERED.keys()])
  })

  it('names every case the term can carry, so a case added to the term is a failure here', () => {
    // The walk writes a name for every case it descends through. A case added to `Described` and not
    // to `STATED` would be stated by the run and never asked about.
    const stated = new Set<string>()
    for (const [, surveyed] of surveys) {
      for (const name of surveyed.stated) {
        stated.add(name)
      }
    }

    expect([...stated].filter((name) => !STATED.includes(name)).sort()).toEqual([])
  })
})
