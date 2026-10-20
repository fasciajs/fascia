import type { Departure, Described, DescribedOf, Meta, Spelled, Spelling } from '@fasciajs/core'
import { faithful, isError, UnsayableTerm, under } from '@fasciajs/core'
import type { Condition, Conditions, FilterPolicy, Numeric, Scope } from './policy.js'

/**
 * A term, written as the filter policy that delivers the messages the term admits.
 *
 * A policy is a predicate over a message, so it states which values arrive and nothing about how
 * to write one. It holds a value to a list of conditions at each key, and it reads an object by
 * its keys alone. So a policy says less than a schema in three ways, and each one is reported:
 *
 * - A policy matches a list by any one member, so a list where the term states a value arrives.
 * - A policy ignores a key it does not name, so an object closed to other keys is open here.
 * - Most assertions have no condition. A length, a format and a whole number each arrive wider.
 *
 * **Nothing here is ever narrower.** A message the term admits is delivered. Where a policy cannot
 * state a part of the term exactly, the part is stated wider or not at all, and a departure names it.
 *
 * Where the term states nothing a policy can match, `written` is undefined: a subscription with no
 * policy, which delivers every message. AWS refuses an empty policy on SQS, so none is written.
 *
 * Each condition written here has deliveries recorded against SNS and Lambda, which the spec beside
 * this package holds the writer to. An SNS attribute holding `"` or `\` is matched only where the
 * publisher escapes it as JSON would, so that is what a publisher does.
 */
export function spellFilterPolicy(
  term: Described,
  scope: Scope
): Spelling<FilterPolicy | undefined> {
  const grammar = GRAMMARS[scope]
  const spelled = policyFor(term, grammar)
  if (isError(spelled)) {
    return spelled
  }

  const { written } = spelled
  const departures = [...spelled.departures, ...annotated(term.meta)]
  if (written === undefined) {
    return { written, departures }
  }

  const refused = refusal(written, grammar)
  return refused ?? { written, departures: [BY_ANY_MEMBER, ...departures] }
}

type Carried = 'string' | 'number' | 'boolean' | 'null'

interface Grammar {
  /** Whether a key holds a policy for the object under the key. */
  readonly nested: boolean
  readonly or: boolean
  /** The types a message carries in this scope. An SNS attribute is a string or a number. */
  readonly carries: readonly Carried[]
  /** Whether SNS counts the keys and combinations of a policy. Lambda counts neither. */
  readonly bounded: boolean
  /** The pattern Lambda holds to its length, as the event source mapping wraps the policy. */
  readonly wrapped: ((policy: FilterPolicy) => unknown) | undefined
}

const GRAMMARS: Readonly<Record<Scope, Grammar>> = {
  'sns:attributes': {
    nested: false,
    or: true,
    carries: ['string', 'number'],
    bounded: true,
    wrapped: undefined
  },
  'sns:body': {
    nested: true,
    or: true,
    carries: ['string', 'number', 'boolean', 'null'],
    bounded: true,
    wrapped: undefined
  },
  'sqs:body': {
    nested: true,
    or: true,
    carries: ['string', 'number', 'boolean', 'null'],
    bounded: false,
    wrapped: (policy) => ({ body: policy })
  },
  'sqs:attributes': {
    nested: false,
    or: false,
    carries: ['string'],
    bounded: false,
    wrapped: (policy) => ({
      messageAttributes: Object.fromEntries(
        Object.entries(policy).map(([key, held]) => [key, { stringValue: held }])
      )
    })
  }
}

/** The most SNS takes, as its verdicts show. */
const MOST_KEYS = 5
const MOST_COMBINATIONS = 150

/** The longest pattern Lambda takes, in characters of the wrapped pattern. */
const LONGEST = 2048

/** The widest number a numeric condition holds to, and its decimals, as SNS documents both. */
const WIDEST = 1e9
const DECIMALS = 5

const BY_ANY_MEMBER: Departure = {
  at: [],
  direction: 'wider',
  cause: 'noShapeForIt',
  said: 'a policy matches a list by any one of its members, so a message holding a list where this states a value or an object is delivered too'
}

/** What a policy gives up where it states nothing about a part of the term. */
function nothing(said: string): Spelled<undefined> {
  return {
    written: undefined,
    departures: [
      {
        at: [],
        direction: 'wider',
        cause: 'noShapeForIt',
        said: `${said}, so the policy states nothing here and delivers what stands here whatever it is`
      }
    ]
  }
}

/** An assertion a condition has no word for. */
function dropped(said: string): Departure {
  return { at: [], direction: 'wider', cause: 'noWordForIt', said }
}

function referred(term: DescribedOf<'ref'>): UnsayableTerm {
  return new UnsayableTerm(
    [],
    `this refers to ${term.name}, and a policy has no reference form. A schema that holds itself cannot be written as a policy`
  )
}

/** What a caller said about the schema, which reaches no condition. */
function annotated(meta: Meta): readonly Departure[] {
  const stated = (['title', 'description', 'examples', 'deprecated'] as const).filter(
    (name) => meta[name] !== undefined
  )

  return stated.length === 0
    ? []
    : [
        {
          at: [],
          direction: 'neither',
          cause: 'noWordForIt',
          said: `this states ${stated.join(', ')}, and a policy holds no word about a value. What is delivered is unchanged`
        }
      ]
}

/** A policy for the object at a place, or nothing where the term states no object there. */
function policyFor(term: Described, grammar: Grammar): Spelling<FilterPolicy | undefined> {
  if (term.kind === 'untyped') {
    return faithful(undefined)
  }
  if (term.kind === 'ref') {
    return referred(term)
  }
  // A policy matches by keys, and null has none. Read as an object, the policy holds null back.
  if (term.admitsNull) {
    return nothing('this admits null where a policy matches an object by its keys')
  }

  switch (term.kind) {
    case 'typed':
      return term.name === 'object'
        ? object(term, grammar)
        : nothing(
            `this is ${term.name === 'array' ? 'a list' : `a ${term.name}`}, and a policy matches an object by its keys`
          )
    case 'some':
    case 'exactlyOne':
      return branches(term, grammar)
    case 'every':
      return conjoined(term.members, grammar)
    case 'values':
    case 'set':
    case 'tuple':
      return nothing('this is no object, and a policy matches an object by its keys')
    default:
      term satisfies never
      throw new Error('a term reached this target with a case it states no answer for')
  }
}

type TypedObject = Extract<DescribedOf<'typed'>, { readonly name: 'object' }>

function object(term: TypedObject, grammar: Grammar): Spelling<FilterPolicy | undefined> {
  const policy: Record<string, Conditions | FilterPolicy> = {}
  const departures: Departure[] = []
  let demanded = false

  for (const [key, property] of term.assertions.properties) {
    if (key === '$or') {
      departures.push(
        ...under(key, nothing('a policy reads $or as a disjunction, never as a key').departures)
      )
      continue
    }

    const held = heldAt(property.term, grammar)
    if (isError(held)) {
      return held
    }
    departures.push(...under(key, held.departures))

    const { written } = held
    if (written === undefined) {
      if (property.required && held.departures.length === 0) {
        departures.push(
          ...under(key, [
            dropped(
              'this key is required, and no condition holds every value, so a message without the key is delivered too'
            )
          ])
        )
      }
    } else if (isConditions(written)) {
      // `exists: false` matches an absent key and nothing else, so an optional key stays exact.
      policy[key] = property.required ? written : [...written, { exists: false }]
      demanded ||= property.required
    } else if (property.required) {
      policy[key] = written
      demanded = true
    } else {
      departures.push(
        ...under(
          key,
          nothing('this object may be absent, and a policy has no condition for an absent object')
            .departures
        )
      )
    }
  }

  if (term.assertions.rest.allows !== 'anything') {
    departures.push(
      dropped('this closes the object to other keys, and a policy ignores a key it does not name')
    )
  }
  if (Object.keys(policy).length === 0) {
    return { written: undefined, departures }
  }
  if (!demanded) {
    departures.push(
      dropped(
        'every key here may be absent, so a message where this is absent or is no object is delivered too'
      )
    )
  }

  return { written: policy, departures }
}

/** Any one of several objects, as `$or`. */
function branches(
  term: DescribedOf<'some'> | DescribedOf<'exactlyOne'>,
  grammar: Grammar
): Spelling<FilterPolicy | undefined> {
  if (!grammar.or) {
    return nothing('this is one of several shapes, and a policy in this scope has no $or')
  }

  const spelled: Spelled<FilterPolicy | undefined>[] = []
  for (const member of term.members) {
    const one = policyFor(member, grammar)
    if (isError(one)) {
      return one
    }
    spelled.push(one)
  }

  const departures = spelled.flatMap((one, index) => under(String(index), one.departures))
  const [first, second, ...rest] = spelled.map((one) => one.written)
  if (first === undefined || second === undefined || rest.some((one) => one === undefined)) {
    // A member delivers everything, so the disjunction does too.
    return { written: undefined, departures }
  }

  const others = rest.filter((one) => one !== undefined)
  if (term.kind === 'exactlyOne' && term.discriminant === undefined) {
    departures.push(
      dropped(
        'this admits exactly one member, and $or delivers a value that more than one member admits'
      )
    )
  }
  return { written: { $or: [first, second, ...others] }, departures }
}

/** Several objects at once, as one policy holding the keys of each. */
function conjoined(
  members: readonly Described[],
  grammar: Grammar
): Spelling<FilterPolicy | undefined> {
  const policy: Record<string, FilterPolicy[string]> = {}
  const departures: Departure[] = []

  for (const [index, member] of members.entries()) {
    const one = policyFor(member, grammar)
    if (isError(one)) {
      return one
    }
    departures.push(...under(String(index), one.departures))

    for (const [key, held] of Object.entries(one.written ?? {})) {
      if (Object.hasOwn(policy, key)) {
        departures.push(
          ...under(String(index), [
            dropped(
              `${key} is stated by two members at once, and a policy states a key once, so the first is kept`
            )
          ])
        )
      } else {
        policy[key] = held
      }
    }
  }

  return { written: Object.keys(policy).length === 0 ? undefined : policy, departures }
}

/** What a key holds: conditions, a policy for the object under the key, or nothing. */
function heldAt(
  term: Described,
  grammar: Grammar
): Spelling<Conditions | FilterPolicy | undefined> {
  switch (term.kind) {
    case 'untyped':
      return faithful(undefined)
    case 'ref':
      return referred(term)
    case 'typed':
      if (term.name === 'object') {
        return grammar.nested
          ? policyFor(term, grammar)
          : nothing('this is an object, and a key in this scope holds a value')
      }
      return listed(scalar(term, grammar), term.admitsNull, grammar)
    case 'values':
      return listed(valued(term, grammar), term.admitsNull, grammar)
    case 'some':
    case 'exactlyOne':
      return anyMember(term, grammar)
    case 'every':
      return nothing('this states several shapes at once, and a key holds one list of conditions')
    case 'set':
    case 'tuple':
      return nothing('this is a list, and a policy matches a list by any one member')
    default:
      term satisfies never
      throw new Error('a term reached this target with a case it states no answer for')
  }
}

/** Conditions, with null among them where the term admits null and a message can carry one. */
function listed(
  spelled: Spelled<readonly Condition[] | undefined>,
  admitsNull: boolean,
  grammar: Grammar
): Spelled<Conditions | undefined> {
  const { written, departures } = spelled
  if (written === undefined) {
    return { written, departures }
  }

  // `exists: true` matches null already.
  const asked =
    admitsNull && grammar.carries.includes('null') && !written.some((one) => isExists(one, true))
  const [first, ...rest] = asked ? [...written, null] : written
  return first === undefined
    ? { written: undefined, departures }
    : { written: [first, ...rest], departures }
}

/** Any one of several values at a key, as the conditions of each. */
function anyMember(
  term: DescribedOf<'some'> | DescribedOf<'exactlyOne'>,
  grammar: Grammar
): Spelling<Conditions | undefined> {
  const conditions: Condition[] = []
  const departures: Departure[] = []

  for (const [index, member] of term.members.entries()) {
    const one = heldAt(member, grammar)
    if (isError(one)) {
      return one
    }
    departures.push(...under(String(index), one.departures))

    const { written } = one
    if (written === undefined) {
      // A member delivers everything here, so the disjunction does too.
      return { written: undefined, departures }
    }
    if (!isConditions(written)) {
      return {
        written: undefined,
        departures: [
          ...departures,
          ...nothing(
            'this is one of several shapes and one is an object, and a key holds one list of conditions'
          ).departures
        ]
      }
    }
    for (const condition of written) {
      if (!conditions.some((held) => JSON.stringify(held) === JSON.stringify(condition))) {
        conditions.push(condition)
      }
    }
  }

  if (term.kind === 'exactlyOne' && term.discriminant === undefined) {
    departures.push(
      dropped(
        'this admits exactly one member, and a list of conditions delivers a value that more than one member admits'
      )
    )
  }
  return listed({ written: conditions, departures }, term.admitsNull, grammar)
}

type TypedScalar = Exclude<DescribedOf<'typed'>, TypedObject>

/** The conditions that hold a value to one type. */
function scalar(term: TypedScalar, grammar: Grammar): Spelled<readonly Condition[] | undefined> {
  switch (term.name) {
    case 'boolean':
      return grammar.carries.includes('boolean')
        ? faithful([true, false])
        : nothing('this is a boolean, and a message in this scope carries none')
    case 'string':
      return text(term.assertions, grammar)
    case 'number':
      return grammar.carries.includes('number')
        ? number(term.assertions, grammar)
        : nothing('this is a number, and a message in this scope carries a number as a string')
    case 'array':
      return nothing('this is a list, and a policy matches a list by any one member')
    default:
      term satisfies never
      throw new Error('a term named a type this target was not asked about')
  }
}

/** A present value, where no condition holds a value to its type. */
function present(type: Carried, grammar: Grammar): Spelled<readonly Condition[]> {
  return {
    written: [{ exists: true }],
    departures: grammar.carries.every((one) => one === type)
      ? []
      : [
          dropped(
            `this is a ${type}, and no condition holds a value to a type, so any value present here is delivered`
          )
        ]
  }
}

type StringAssertions = Extract<TypedScalar, { readonly name: 'string' }>['assertions']

function text(assertions: StringAssertions, grammar: Grammar): Spelled<readonly Condition[]> {
  const { minLength, maxLength, patterns = [], format } = assertions
  const unstated = [
    ...(minLength === undefined ? [] : ['minLength']),
    ...(maxLength === undefined ? [] : ['maxLength']),
    ...(format === undefined ? [] : ['format'])
  ]

  const anchoredOnes = patterns.map(anchored)
  const [kept] = anchoredOnes.filter((one) => one !== undefined)
  const left = patterns.filter(
    (_, index) => anchoredOnes[index] === undefined || anchoredOnes[index] !== kept
  )
  const said = [...unstated, ...left.map((pattern) => `the pattern ${pattern}`)]
  const departures =
    said.length === 0
      ? []
      : [dropped(`this states ${said.join(', ')}, and a policy has no condition for that`)]

  if (kept === undefined) {
    const anyText = present('string', grammar)
    return { written: anyText.written, departures: [...anyText.departures, ...departures] }
  }
  return { written: [kept], departures }
}

/**
 * The condition a pattern states, where the pattern is a literal held to one end or to both.
 *
 * `^abc` is a prefix, `abc$` a suffix, and `^abc$` the string itself. Any other pattern is stated
 * by no condition: a wildcard matches across lines where `.` does not.
 */
function anchored(pattern: string): Condition | undefined {
  const start = pattern.startsWith('^')
  const end = /(^|[^\\])\$$/.test(pattern)
  const body = pattern.slice(start ? 1 : 0, end ? -1 : undefined)
  if (!/^(?:[^\\.*+?^$|()[\]{}]|\\[\\.*+?^$|()[\]{}/-])*$/.test(body)) {
    return undefined
  }

  const literal = body.replace(/\\(.)/g, '$1')
  if (start && end) {
    return literal
  }
  if (literal === '') {
    return undefined
  }
  return start ? { prefix: literal } : end ? { suffix: literal } : undefined
}

type NumberAssertions = Extract<TypedScalar, { readonly name: 'number' }>['assertions']

/** Whether a numeric condition holds a number as it is, inside the width and decimals SNS keeps. */
function keeps(value: number): boolean {
  return Math.abs(value) <= WIDEST && Number(value.toFixed(DECIMALS)) === value
}

function number(
  assertions: NumberAssertions,
  grammar: Grammar
): Spelled<readonly Condition[] | undefined> {
  const { minimum, maximum, multipleOf, integer } = assertions
  const departures: Departure[] = []
  if (integer === true || multipleOf !== undefined) {
    departures.push(
      dropped(
        `this states ${integer === true ? 'a whole number' : `a multiple of ${multipleOf}`}, and a numeric condition holds a range alone`
      )
    )
  }

  const lower = minimum !== undefined && keeps(minimum.value) ? minimum : undefined
  const upper = maximum !== undefined && keeps(maximum.value) ? maximum : undefined
  if (
    (minimum !== undefined && lower === undefined) ||
    (maximum !== undefined && upper === undefined)
  ) {
    departures.push(
      dropped(
        `this states a bound past ${WIDEST} or finer than ${DECIMALS} decimals, which a numeric condition does not hold`
      )
    )
  }

  const from = lower === undefined ? undefined : lower.exclusive ? '>' : '>='
  const to = upper === undefined ? undefined : upper.exclusive ? '<' : '<='

  if (lower === undefined || from === undefined || upper === undefined || to === undefined) {
    const one: Numeric | undefined =
      lower !== undefined && from !== undefined
        ? [from, lower.value]
        : upper !== undefined && to !== undefined
          ? [to, upper.value]
          : undefined
    if (one === undefined) {
      const anyNumber = present('number', grammar)
      return { written: anyNumber.written, departures: [...anyNumber.departures, ...departures] }
    }
    return { written: [{ numeric: one }], departures }
  }

  // AWS refuses a range whose bottom is not below its top, even where both ends are inclusive.
  if (lower.value < upper.value) {
    return { written: [{ numeric: [from, lower.value, to, upper.value] }], departures }
  }
  if (lower.value === upper.value && !lower.exclusive && !upper.exclusive) {
    return { written: [{ numeric: ['=', lower.value] }], departures }
  }
  return nothing('this states a range no number meets')
}

/** A list of values, each as itself. */
function valued(
  term: DescribedOf<'values'>,
  grammar: Grammar
): Spelled<readonly Condition[] | undefined> {
  const conditions: Condition[] = []
  for (const admitted of term.admitted) {
    switch (admitted.of) {
      case 'string':
        conditions.push(admitted.value)
        break
      case 'number':
        if (!grammar.carries.includes('number') || !keeps(admitted.value)) {
          return nothing(
            `this admits ${admitted.value}, which a condition in this scope does not hold as a number`
          )
        }
        conditions.push(admitted.value)
        break
      case 'boolean':
        if (!grammar.carries.includes('boolean')) {
          return nothing('this admits a boolean, and a message in this scope carries none')
        }
        conditions.push(admitted.value)
        break
      case 'null':
        // A message that carries no null cannot carry this value, so there is nothing to deliver.
        if (grammar.carries.includes('null')) {
          conditions.push(null)
        }
        break
      case 'bigint':
        return nothing('this admits a bigint, which no message carries')
      default:
        admitted satisfies never
        throw new Error('a value reached this target with a type it states no answer for')
    }
  }

  return faithful(conditions)
}

function isConditions(held: Conditions | FilterPolicy): held is Conditions {
  return Array.isArray(held)
}

function isExists(condition: Condition, exists: boolean): boolean {
  return typeof condition === 'object' && condition !== null && 'exists' in condition
    ? condition.exists === exists
    : false
}

/** The bound a policy passes, where SNS or Lambda would refuse it. */
function refusal(policy: FilterPolicy, grammar: Grammar): UnsayableTerm | undefined {
  if (grammar.bounded) {
    const { keys, combinations } = counted(policy, '', 1)
    if (keys.size > MOST_KEYS) {
      return new UnsayableTerm([], `this states ${keys.size} keys, past the ${MOST_KEYS} SNS takes`)
    }
    if (combinations > MOST_COMBINATIONS) {
      return new UnsayableTerm(
        [],
        `this states ${combinations} combinations, past the ${MOST_COMBINATIONS} SNS takes`
      )
    }
  }

  const length = grammar.wrapped === undefined ? 0 : JSON.stringify(grammar.wrapped(policy)).length
  return length > LONGEST
    ? new UnsayableTerm(
        [],
        `this is a pattern of ${length} characters, past the ${LONGEST} Lambda takes`
      )
    : undefined
}

interface Counted {
  readonly keys: Set<string>
  readonly combinations: number
}

/**
 * The keys and combinations SNS counts, as its verdicts show.
 *
 * A key is a distinct path and list of values, and `$or` is no step of a path. Combinations
 * multiply across keys, times the depth of each key, and add across the branches of `$or`.
 */
function counted(policy: FilterPolicy, path: string, depth: number): Counted {
  const keys = new Set<string>()
  let combinations = 1

  for (const [key, held] of Object.entries(policy)) {
    if (key === '$or' && Array.isArray(held)) {
      const each = held.filter(isPolicy).map((branch) => counted(branch, path, depth))
      for (const one of each) {
        for (const pair of one.keys) {
          keys.add(pair)
        }
      }
      combinations *= each.reduce((sum, one) => sum + one.combinations, 0)
    } else if (Array.isArray(held)) {
      keys.add(`${path}${key}=${JSON.stringify(held)}`)
      combinations *= held.length * depth
    } else if (isPolicy(held)) {
      const one = counted(held, `${path}${key}.`, depth + 1)
      for (const pair of one.keys) {
        keys.add(pair)
      }
      combinations *= one.combinations
    }
  }

  return { keys, combinations }
}

function isPolicy(held: unknown): held is FilterPolicy {
  return typeof held === 'object' && held !== null && !Array.isArray(held)
}
