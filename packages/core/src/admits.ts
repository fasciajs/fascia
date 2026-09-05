import type { Description } from './describe.js'
import type { Described, DescribedOf, DescribedRest } from './described.js'
import type { AdmittedValue } from './node.js'
import { FasciaError, isError } from './result.js'

/**
 * Whether a term admits a value, asked of the term rather than of a validator.
 *
 * **Why this exists.** Every check in this repository that asks whether a document is *true* asks a
 * validator and a reader of the document, and one number carries two questions: the frontend may
 * have misread the schema, and the target may have miswritten the term. A finding names neither.
 * This is the term's own answer, so the two questions separate: a validator against this measures
 * the frontend, and this against a document measures the target.
 *
 * The second measurement is the only verdict available to a target nothing reads back.
 *
 * **This is not a validator.** It decides what the term states, and it says so where the term states
 * something it does not decide. A `format` is the one such thing: deciding an email means writing
 * the validator this library refuses to be. A default of `true` there would report a target as
 * narrow for enforcing what the term asked for.
 */

/** Whether a term admits a value, or the reason there is no answer. */
export type Admission = boolean | UndecidedAdmission

/** A term that states something this function does not decide, so the value has no verdict. */
export class UndecidedAdmission extends FasciaError<{ at: readonly string[] }> {
  constructor(at: readonly string[], reason: string) {
    super(`whether this term admits the value is undecided: ${reason}`, { at })
  }
}

/**
 * Where the walk is, and which names it reached with no value consumed.
 *
 * `seen` is emptied on the way into a child value and carried across a combination and a reference,
 * which is the whole of the cycle rule: a schema that holds itself under a key is a description of a
 * nested value and terminates on one, and a union that names itself with nothing between describes
 * no value at all.
 */
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
  // Every case carries this, so it is asked once here rather than in each case that could carry a
  // null. A case may admit null on its own account, so a false answer here decides nothing.
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
      return decideTuple(term.positions, term.rest, value, walk)
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
      // Code points rather than code units, which is what every reader of a document counts.
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
      // Last, so a value the term already refuses is refused rather than left undecided.
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
      // The division, which is how every reader of a document states the same question. A binary
      // float divides exactly where the reader says it does, so the two agree or both are wrong.
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

/**
 * A set, asked of the value a document carries.
 *
 * A set arrives as a list, because no wire form here has another shape for one. What the term states
 * about the value is that no item is held twice; that a position is not part of the value is not
 * something a value can be asked. So the answer is the same one a list of items that do not repeat
 * would give, and the difference between the two lives in what a parse gives back.
 */
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
  rest: DescribedRest,
  value: unknown,
  walk: Walk
): Admission {
  if (!isList(value)) {
    return false
  }
  // A shorter list is admitted, because a term states the values at the positions and does not say
  // which of them must be present. The JSON Schema target reports the same silence as a departure.
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

/**
 * Any of these.
 *
 * A member with no verdict is reported only where no member admits the value. A member that admits
 * it answers the question whatever the undecided one would have said.
 */
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

/**
 * Whether two values are the same value.
 *
 * Structural, because `unique` is a statement about the values and two objects written the same way
 * are one value to whoever reads the document. Key order is not part of the value.
 */
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

/** A value with keys, and not a list. Unknown data, parsed here and read as a record after. */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A list. Unknown data, parsed here so nothing downstream reads an `any`. */
function isList(value: unknown): value is readonly unknown[] {
  return Array.isArray(value)
}
