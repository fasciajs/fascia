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
 * What a reading and a term owe, over drawn schemas.
 *
 * (T) a reading answers or names its failure, because `read` returns `Node | UnreadableSchema`.
 * (N) a term is never narrower than the schema, which no departure records.
 * (C) the run states every case, or the first two hold vacuously and a count of findings cannot
 * tell that apart from a case that holds.
 */

const RUN = { seed: 1, rounds: 300, depth: 2 }

/** What the run never states, and why. A name arriving here is a case the laws went quiet about. */
const UNCOVERED: ReadonlyMap<string, string> = new Map([
  [
    'set',
    'no reading produces one. Every validator here states a set as a value that is not a list, and reading one is a conversion rather than a description: `zod-types.ts` says so where zod refuses it. The DynamoDB target writes one exactly, and the spec beside that target states the term directly'
  ]
])

/** Every case and assertion a term can state. */
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

interface Surveyed {
  readonly threw: readonly string[]
  readonly narrower: readonly string[]
  readonly stated: ReadonlySet<string>
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
      // A validator that throws is the validator's business, not a reading's.
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

/** What a term states, in the names the coverage law is written in. */
function state(
  term: Described,
  definitions: ReadonlyMap<string, Described>,
  into: Set<string>,
  depth: number
): void {
  if (depth > 8) {
    return
  }
  if (term.admitsNull) {
    into.add('admitsNull')
  }

  switch (term.kind) {
    case 'typed': {
      into.add(`typed/${term.name}`)
      // A structure's children sit in the same bag, and the walk names them where it descends.
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
    // A case added to `Described` and not to `STATED` would be stated and never asked about.
    const stated = new Set<string>()
    for (const [, surveyed] of surveys) {
      for (const name of surveyed.stated) {
        stated.add(name)
      }
    }

    expect([...stated].filter((name) => !STATED.includes(name)).sort()).toEqual([])
  })
})
