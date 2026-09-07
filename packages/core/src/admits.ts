import type { Description } from './describe.js'
import type { Described, DescribedOf, DescribedRest } from './described.js'
import type { AdmittedValue } from './node.js'
import { FasciaError, isError } from './result.js'

/**
 * Whether a term admits a value, asked of the term rather than of a validator.
 *
 * A validator against this measures the frontend, and this against a document measures the target.
 * It is not a validator: a `format` gets no verdict, because deciding one means writing one.
 */

/** Whether a term admits a value, or the reason there is no answer. */
export type Admission = boolean | UndecidedAdmission

/** A term that states something this function does not decide, so the value has no verdict. */
export class UndecidedAdmission extends FasciaError<{ at: readonly string[] }> {
  constructor(at: readonly string[], reason: string) {
    super(`whether this term admits the value is undecided: ${reason}`, { at })
  }
}

/** `seen` empties on the way into a child value, so only a cycle consuming none is refused. */
interface Walk {
  readonly definitions: ReadonlyMap<string, Described>
  readonly at: readonly string[]
  readonly seen: ReadonlySet<string>
}

/** One step further in, where a value is consumed. */
function into(walk: Walk, step: string): Walk {
  return { definitions: walk.definitions, at: [...walk.at, step], seen: new Set() }
}

/** One step further in, where the same value is asked about again. */
function beside(walk: Walk, step: string): Walk {
  return { definitions: walk.definitions, at: [...walk.at, step], seen: walk.seen }
}

export function admits(description: Description, value: unknown): Admission {
  return decide(description.term, value, {
    definitions: description.definitions,
    at: [],
    seen: new Set()
  })
}

function decide(term: Described, value: unknown, walk: Walk): Admission {
  if (value === null && term.admitsNull) {
    return true
  }

  switch (term.kind) {
    case 'typed':
      return decideTyped(term, value, walk)
    case 'set':
      return decideSet(term, value, walk)
    case 'values':
      return term.admitted.some((one) => isAdmitted(one, value))
    case 'some':
      return anyOf(term.members, value, walk)
    case 'every':
      return allOf(term.members, value, walk)
    case 'exactlyOne':
      return oneOf(term.members, value, walk)
    case 'tuple':
      return decideTuple(term.positions, term.minPositions, term.rest, value, walk)
    case 'ref':
      return decideRef(term.name, value, walk)
    case 'untyped':
      return true
    default:
      term satisfies never
      throw new Error('a term carries a case this function has no answer for')
  }
}

function decideTyped(
  term: Extract<Described, { kind: 'typed' }>,
  value: unknown,
  walk: Walk
): Admission {
  switch (term.name) {
    case 'string': {
      if (typeof value !== 'string') {
        return false
      }
      const assertions = term.assertions
      // Code points, which is what a reader of a document counts.
      const length = [...value].length
      if (assertions.minLength !== undefined && length < assertions.minLength) {
        return false
      }
      if (assertions.maxLength !== undefined && length > assertions.maxLength) {
        return false
      }
      for (const pattern of assertions.patterns ?? []) {
        let held: boolean
        try {
          held = new RegExp(pattern).test(value)
        } catch {
          return new UndecidedAdmission(
            walk.at,
            'a pattern is not a regular expression this runtime compiles'
          )
        }
        if (!held) {
          return false
        }
      }
      // Last, so a value the term already refuses is refused rather than undecided.
      if (assertions.format !== undefined) {
        return new UndecidedAdmission(
          walk.at,
          `deciding the format ${assertions.format} is a validator's work`
        )
      }
      return true
    }
    case 'number': {
      if (typeof value !== 'number') {
        return false
      }
      const assertions = term.assertions
      if (assertions.integer === true && !Number.isInteger(value)) {
        return false
      }
      const minimum = assertions.minimum
      if (
        minimum !== undefined &&
        !(minimum.exclusive ? value > minimum.value : value >= minimum.value)
      ) {
        return false
      }
      const maximum = assertions.maximum
      if (
        maximum !== undefined &&
        !(maximum.exclusive ? value < maximum.value : value <= maximum.value)
      ) {
        return false
      }
      // The division, which is how a reader of a document states it.
      if (assertions.multipleOf !== undefined && !Number.isInteger(value / assertions.multipleOf)) {
        return false
      }
      return true
    }
    case 'boolean':
      return typeof value === 'boolean'
    case 'object': {
      if (!isRecord(value)) {
        return false
      }
      const { properties, rest } = term.assertions
      for (const [name, property] of properties) {
        const held = Object.hasOwn(value, name)
        if (!held) {
          if (property.required) {
            return false
          }
          continue
        }
        const answer = decide(property.term, value[name], into(walk, name))
        if (answer !== true) {
          return answer
        }
      }
      for (const name of Object.keys(value)) {
        if (properties.has(name)) {
          continue
        }
        const answer = decideRest(rest, value[name], into(walk, name))
        if (answer !== true) {
          return answer
        }
      }
      return true
    }
    case 'array': {
      if (!isList(value)) {
        return false
      }
      const assertions = term.assertions
      if (assertions.minItems !== undefined && value.length < assertions.minItems) {
        return false
      }
      if (assertions.maxItems !== undefined && value.length > assertions.maxItems) {
        return false
      }
      for (const [index, item] of value.entries()) {
        const answer = decide(assertions.items, item, into(walk, String(index)))
        if (answer !== true) {
          return answer
        }
      }
      return true
    }
    default:
      term satisfies never
      throw new Error('a typed term carries a name this function has no answer for')
  }
}

/** A set arrives as a list. That a position is not part of the value is not a value's to answer. */
function decideSet(term: DescribedOf<'set'>, value: unknown, walk: Walk): Admission {
  if (!isList(value)) {
    return false
  }
  if (term.minItems !== undefined && value.length < term.minItems) {
    return false
  }
  if (term.maxItems !== undefined && value.length > term.maxItems) {
    return false
  }
  if (!distinct(value)) {
    return false
  }
  for (const [index, item] of value.entries()) {
    const answer = decide(term.items, item, into(walk, String(index)))
    if (answer !== true) {
      return answer
    }
  }
  return true
}

function decideTuple(
  positions: readonly Described[],
  minPositions: number,
  rest: DescribedRest,
  value: unknown,
  walk: Walk
): Admission {
  if (!isList(value)) {
    return false
  }
  if (value.length < minPositions) {
    return false
  }

  for (const [index, position] of positions.entries()) {
    if (index >= value.length) {
      break
    }
    const answer = decide(position, value[index], into(walk, String(index)))
    if (answer !== true) {
      return answer
    }
  }
  for (let index = positions.length; index < value.length; index += 1) {
    const answer = decideRest(rest, value[index], into(walk, String(index)))
    if (answer !== true) {
      return answer
    }
  }
  return true
}

/** What a structure says about a value it does not name a place for. */
function decideRest(rest: DescribedRest, value: unknown, walk: Walk): Admission {
  switch (rest.allows) {
    case 'anything':
      return true
    case 'nothing':
      return false
    case 'term':
      return decide(rest.term, value, walk)
    default:
      rest satisfies never
      throw new Error('a rest policy carries a case this function has no answer for')
  }
}

function decideRef(name: string, value: unknown, walk: Walk): Admission {
  if (walk.seen.has(name)) {
    return new UndecidedAdmission(
      walk.at,
      `the name ${name} stands for a term that reaches the name again with no value between`
    )
  }
  const named = walk.definitions.get(name)
  if (named === undefined) {
    return new UndecidedAdmission(walk.at, `nothing is defined under the name ${name}`)
  }
  return decide(named, value, {
    definitions: walk.definitions,
    at: walk.at,
    seen: new Set([...walk.seen, name])
  })
}

/** A member that admits the value answers the question, whatever an undecided one would say. */
function anyOf(members: readonly Described[], value: unknown, walk: Walk): Admission {
  const answers = members.map((member, index) => decide(member, value, beside(walk, String(index))))
  if (answers.includes(true)) {
    return true
  }
  return answers.find(isError) ?? false
}

/** All of these at once. A member that refuses the value answers the question. */
function allOf(members: readonly Described[], value: unknown, walk: Walk): Admission {
  const answers = members.map((member, index) => decide(member, value, beside(walk, String(index))))
  if (answers.includes(false)) {
    return false
  }
  return answers.find(isError) ?? true
}

/** Exactly one of these. Two that admit the value settle it, whatever the rest say. */
function oneOf(members: readonly Described[], value: unknown, walk: Walk): Admission {
  const answers = members.map((member, index) => decide(member, value, beside(walk, String(index))))
  const admitting = answers.filter((answer) => answer === true).length
  if (admitting > 1) {
    return false
  }
  const undecided = answers.find(isError)
  if (undecided !== undefined) {
    return undecided
  }
  return admitting === 1
}

/** Whether one of the values a term admits is this value. */
function isAdmitted(one: AdmittedValue, value: unknown): boolean {
  switch (one.of) {
    case 'string':
    case 'number':
    case 'boolean':
      return value === one.value
    case 'bigint':
      return typeof value === 'bigint' && value === one.value
    case 'null':
      return value === null
    default:
      one satisfies never
      throw new Error('an admitted value carries a type this function has no answer for')
  }
}

/** Whether no two items are the same value. */
function distinct(items: readonly unknown[]): boolean {
  return items.every((item, index) => items.findIndex((other) => same(item, other)) === index)
}

/** Structural, and key order is not part of the value. */
function same(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true
  }
  if (isList(left) && isList(right)) {
    return left.length === right.length && left.every((item, index) => same(item, right[index]))
  }
  if (isRecord(left) && isRecord(right)) {
    const names = Object.keys(left)
    return (
      names.length === Object.keys(right).length &&
      names.every((name) => Object.hasOwn(right, name) && same(left[name], right[name]))
    )
  }
  return false
}

/** Unknown data, parsed here so nothing downstream reads an `any`. */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Unknown data, parsed here so nothing downstream reads an `any`. */
function isList(value: unknown): value is readonly unknown[] {
  return Array.isArray(value)
}
