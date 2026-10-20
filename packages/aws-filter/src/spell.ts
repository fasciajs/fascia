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
  const spelled = abstracted(term, grammar, 'root')
  if (isError(spelled)) {
    return spelled
  }

  const { written } = spelled
  const departures = [...spelled.departures]
  if (written.kind === 'leaf') {
    departures.push(
      ...nothing('this is no object, and a policy matches an object by its keys').departures
    )
  }
  if (written.kind === 'none') {
    departures.push(
      ...nothing('this admits no message this scope carries, and no policy delivers none')
        .departures
    )
  }
  departures.push(...annotated(term.meta))
  if (written.kind === 'any' || written.kind === 'leaf' || written.kind === 'none') {
    return { written: undefined, departures }
  }

  const policy = policyOf(written)
  return (
    refusal(written, policy, grammar) ?? {
      written: policy,
      departures: [BY_ANY_MEMBER, ...departures]
    }
  )
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
  /** Whether `prefix: ""` is recorded to match every string and nothing else. */
  readonly anyString: boolean
  /** Whether `exists: false` is recorded to match an absent key. */
  readonly absent: boolean
}

const GRAMMARS: Readonly<Record<Scope, Grammar>> = {
  'sns:attributes': {
    nested: false,
    or: true,
    carries: ['string', 'number'],
    bounded: true,
    wrapped: undefined,
    anyString: false,
    absent: true
  },
  'sns:body': {
    nested: true,
    or: true,
    carries: ['string', 'number', 'boolean', 'null'],
    bounded: true,
    wrapped: undefined,
    anyString: true,
    absent: true
  },
  'sqs:body': {
    nested: true,
    or: true,
    carries: ['string', 'number', 'boolean', 'null'],
    bounded: false,
    wrapped: (policy) => ({ body: policy }),
    anyString: true,
    absent: true
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
    }),
    // Lambda wraps an attribute as `messageAttributes.<key>.stringValue`, and no row records what
    // `exists: false` does where the attribute, the parent of that path, is absent.
    anyString: false,
    absent: false
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

/**
 * What a policy states about the value at one place, as a lattice.
 *
 * `any` states nothing, and `none` admits no value a message carries. A leaf is a disjunction of conditions on a value. An object is a
 * conjunction of keys, and `or` is a disjunction of objects. A union of terms is the join, and an
 * intersection is the meet, so each construct of a term is one law here and not one case per
 * place it stands. A policy is written from this at the end.
 */
type Shape = { readonly kind: 'object'; readonly keys: ReadonlyMap<string, Pred> }

type Pred =
  | { readonly kind: 'any' }
  | { readonly kind: 'none' }
  | { readonly kind: 'leaf'; readonly conditions: Conditions }
  | Shape
  | { readonly kind: 'or'; readonly branches: readonly [Shape, Shape, ...Shape[]] }

const ANY: Pred = { kind: 'any' }
const NONE: Pred = { kind: 'none' }

/** Where a place stands: the message itself, or the value at a key. */
type Place = 'root' | 'key'

const BY_ANY_MEMBER: Departure = {
  at: [],
  direction: 'wider',
  cause: 'noShapeForIt',
  said: 'a policy matches a list by any one of its members, so a message holding a list where this states a value or an object is delivered too'
}

/** What a policy gives up where it states nothing about a part of the term. */
function nothing(said: string): Spelled<Pred> {
  return {
    written: ANY,
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

/**
 * The predicate for a term at a place.
 *
 * Null is a value, so a term admitting null is the join of the rest with `[null]`. A message that
 * carries no null cannot carry the value, so at a key in such a scope there is nothing to join. A
 * message itself that is null is no object, in every scope.
 */
function abstracted(term: Described, grammar: Grammar, place: Place): Spelling<Pred> {
  const shaped = shapedAt(term, grammar, place)
  if (
    isError(shaped) ||
    !term.admitsNull ||
    (place === 'key' && !grammar.carries.includes('null'))
  ) {
    return shaped
  }
  return joined(shaped, faithful(leafOf([null])), grammar)
}

function shapedAt(term: Described, grammar: Grammar, place: Place): Spelling<Pred> {
  switch (term.kind) {
    case 'untyped':
      return faithful(ANY)
    case 'ref':
      return referred(term)
    case 'typed':
      if (term.name === 'object') {
        return place === 'root' || grammar.nested
          ? object(term, grammar)
          : nothing('this is an object, and a key in this scope holds a value')
      }
      return scalar(term, grammar)
    case 'values':
      return valued(term, grammar)
    case 'some':
    case 'exactlyOne':
      return anyOf(term, grammar, place)
    case 'every':
      return allOf(term.members, grammar, place)
    case 'set':
    case 'tuple':
      return nothing('this is a list, and a policy matches a list by any one member')
    default:
      term satisfies never
      throw new Error('a term reached this target with a case it states no answer for')
  }
}

type TypedObject = Extract<DescribedOf<'typed'>, { readonly name: 'object' }>

function object(term: TypedObject, grammar: Grammar): Spelling<Pred> {
  const keys = new Map<string, Pred>()
  const departures: Departure[] = []
  let demanded = false

  for (const [key, property] of term.assertions.properties) {
    if (key === '$or') {
      departures.push(
        ...under(key, nothing('a policy reads $or as a disjunction, never as a key').departures)
      )
      continue
    }

    const held = abstracted(property.term, grammar, 'key')
    if (isError(held)) {
      return held
    }
    const here = [...held.departures]
    let pred = held.written

    if (!property.required) {
      // An absent key is the join with `exists: false`, which `exists: true` absorbs into any.
      const optional = joined(held, faithful(leafOf([{ exists: false }])), grammar)
      pred = optional.written
      here.push(...optional.departures.slice(held.departures.length))
      if (pred.kind === 'leaf' && !grammar.absent) {
        here.push(
          ...nothing(
            'this key may be absent, and no row records how this scope reads an absent key'
          ).departures
        )
        pred = ANY
      } else if (pred.kind === 'leaf' && grammar.nested) {
        here.push(
          dropped(
            'this key may be absent, and exists: false also matches a key holding an object, so a message holding an object here is delivered too'
          )
        )
      }
    } else if (pred.kind === 'any' && held.departures.length === 0) {
      here.push(
        dropped(
          'this key is required, and no condition holds every value, so a message without the key is delivered too'
        )
      )
    }

    departures.push(...under(key, here))
    if (pred.kind === 'none') {
      // A required key no message can carry leaves no object to deliver.
      return { written: NONE, departures }
    }
    if (pred.kind !== 'any') {
      keys.set(key, pred)
      demanded ||= property.required
    }
  }

  if (term.assertions.rest.allows !== 'anything') {
    departures.push(
      dropped('this closes the object to other keys, and a policy ignores a key it does not name')
    )
  }
  if (keys.size === 0) {
    return { written: ANY, departures }
  }
  if (!demanded) {
    departures.push(
      dropped(
        'every key here may be absent, so a message where this is absent or is no object is delivered too'
      )
    )
  }
  return { written: { kind: 'object', keys }, departures }
}

/** Any one of several terms, which is the join of each. */
function anyOf(
  term: DescribedOf<'some'> | DescribedOf<'exactlyOne'>,
  grammar: Grammar,
  place: Place
): Spelling<Pred> {
  let joinedSoFar: Spelled<Pred> | undefined
  for (const [index, member] of term.members.entries()) {
    const one = abstracted(member, grammar, place)
    if (isError(one)) {
      return one
    }
    const placed = { written: one.written, departures: under(String(index), one.departures) }
    joinedSoFar = joinedSoFar === undefined ? placed : joined(joinedSoFar, placed, grammar)
  }

  const spelled = joinedSoFar ?? faithful(ANY)
  if (
    term.kind === 'exactlyOne' &&
    term.discriminant === undefined &&
    spelled.written.kind !== 'any'
  ) {
    return {
      written: spelled.written,
      departures: [
        ...spelled.departures,
        dropped(
          'this admits exactly one member, and a policy delivers a value that more than one member admits'
        )
      ]
    }
  }
  return spelled
}

/** Several terms at once, which is the meet of each. */
function allOf(members: readonly Described[], grammar: Grammar, place: Place): Spelling<Pred> {
  let metSoFar: Spelled<Pred> = faithful(ANY)
  for (const [index, member] of members.entries()) {
    const one = abstracted(member, grammar, place)
    if (isError(one)) {
      return one
    }
    const met = meet(metSoFar.written, one.written)
    metSoFar = {
      written: met.written,
      departures: [
        ...metSoFar.departures,
        ...under(String(index), [...one.departures, ...met.departures])
      ]
    }
  }
  return metSoFar
}

/**
 * The join of two predicates, with what each already gave up.
 *
 * Two leaves join as one list of conditions, and two objects as `$or`. A leaf and an object at one
 * place have no form, because a list of conditions matches a value and `$or` matches keys.
 */
function joined(left: Spelled<Pred>, right: Spelled<Pred>, grammar: Grammar): Spelled<Pred> {
  const departures = [...left.departures, ...right.departures]
  const a = left.written
  const b = right.written
  if (a.kind === 'none' || b.kind === 'none') {
    return { written: a.kind === 'none' ? b : a, departures }
  }
  if (a.kind === 'any' || b.kind === 'any') {
    return { written: ANY, departures }
  }
  if (a.kind === 'leaf' && b.kind === 'leaf') {
    return { written: leafOf([...a.conditions, ...b.conditions]), departures }
  }
  if (a.kind === 'leaf' || b.kind === 'leaf') {
    return {
      written: ANY,
      departures: [
        ...departures,
        ...nothing(
          'this admits an object and a value at one place, and a policy has no form for both'
        ).departures
      ]
    }
  }
  if (!grammar.or) {
    return {
      written: ANY,
      departures: [
        ...departures,
        ...nothing('this is one of several objects, and a policy in this scope has no $or')
          .departures
      ]
    }
  }
  return { written: orOf([...shapesOf(a), ...shapesOf(b)]), departures }
}

/**
 * The meet of two predicates.
 *
 * Two objects meet key by key, and a meet distributes over `$or`. Two leaves have no meet a list of
 * conditions states, so the first is kept, which is wider.
 */
function meet(a: Pred, b: Pred): Spelled<Pred> {
  if (a.kind === 'none' || b.kind === 'none') {
    return faithful(NONE)
  }
  if (a.kind === 'any') {
    return faithful(b)
  }
  if (b.kind === 'any') {
    return faithful(a)
  }
  if (a.kind === 'leaf' || b.kind === 'leaf') {
    return {
      written: a,
      departures: [
        dropped(
          'two shapes hold here at once, and a policy states one of them, so the first is kept'
        )
      ]
    }
  }

  const departures: Departure[] = []
  const branches: Shape[] = []
  for (const one of shapesOf(a)) {
    for (const other of shapesOf(b)) {
      const keys = new Map(one.keys)
      for (const [key, pred] of other.keys) {
        const held = keys.get(key)
        if (held === undefined) {
          keys.set(key, pred)
        } else {
          const met = meet(held, pred)
          departures.push(...under(key, met.departures))
          keys.set(key, met.written)
        }
      }
      // A key both sides hold and no value meets leaves this branch no object to deliver.
      if (![...keys.values()].some((pred) => pred.kind === 'none')) {
        branches.push({ kind: 'object', keys })
      }
    }
  }
  return { written: orOf(branches), departures }
}

function shapesOf(pred: Shape | Extract<Pred, { readonly kind: 'or' }>): readonly Shape[] {
  return pred.kind === 'or' ? pred.branches : [pred]
}

function orOf(shapes: readonly Shape[]): Pred {
  const [first, second, ...rest] = shapes
  if (first === undefined) {
    return NONE
  }
  return second === undefined ? first : { kind: 'or', branches: [first, second, ...rest] }
}

/**
 * A disjunction of conditions, in its least form.
 *
 * `exists: true` matches every value present, so it absorbs every other condition on a value, and
 * with `exists: false` beside it the two match anything.
 */
function leafOf(conditions: readonly Condition[]): Pred {
  const unique = conditions.filter(
    (one, index) =>
      conditions.findIndex((other) => JSON.stringify(other) === JSON.stringify(one)) === index
  )
  const present = unique.some((one) => isExists(one, true))
  const absent = unique.some((one) => isExists(one, false))
  if (present && absent) {
    return ANY
  }

  const [first, ...rest] = present ? unique.filter((one) => isExists(one, true)) : unique
  return first === undefined ? NONE : { kind: 'leaf', conditions: [first, ...rest] }
}

function isExists(condition: Condition, exists: boolean): boolean {
  return typeof condition === 'object' && condition !== null && 'exists' in condition
    ? condition.exists === exists
    : false
}

type TypedScalar = Exclude<DescribedOf<'typed'>, TypedObject>

/** The conditions that hold a value to one type. */
function scalar(term: TypedScalar, grammar: Grammar): Spelled<Pred> {
  switch (term.name) {
    case 'boolean':
      return grammar.carries.includes('boolean')
        ? faithful(leafOf([true, false]))
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
function present(type: Carried, grammar: Grammar): Departure[] {
  return grammar.carries.every((one) => one === type)
    ? []
    : [
        dropped(
          `this is a ${type}, and no condition holds a value to a type, so any value present here is delivered`
        )
      ]
}

type StringAssertions = Extract<TypedScalar, { readonly name: 'string' }>['assertions']

function text(assertions: StringAssertions, grammar: Grammar): Spelled<Pred> {
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

  if (kept !== undefined) {
    return { written: leafOf([kept]), departures }
  }
  if (grammar.anyString) {
    return { written: leafOf([{ prefix: '' }]), departures }
  }
  return {
    written: leafOf([{ exists: true }]),
    departures: [...present('string', grammar), ...departures]
  }
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

function number(assertions: NumberAssertions, grammar: Grammar): Spelled<Pred> {
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
    return one === undefined
      ? {
          written: leafOf([{ exists: true }]),
          departures: [...present('number', grammar), ...departures]
        }
      : { written: leafOf([{ numeric: one }]), departures }
  }

  // AWS refuses a range whose bottom is not below its top, even where both ends are inclusive.
  if (lower.value < upper.value) {
    return { written: leafOf([{ numeric: [from, lower.value, to, upper.value] }]), departures }
  }
  if (lower.value === upper.value && !lower.exclusive && !upper.exclusive) {
    return { written: leafOf([{ numeric: ['=', lower.value] }]), departures }
  }
  return nothing('this states a range no number meets')
}

/** A list of values, each as itself. */
function valued(term: DescribedOf<'values'>, grammar: Grammar): Spelled<Pred> {
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

  return faithful(leafOf(conditions))
}

/** The policy an object or a disjunction of objects is written as. */
function policyOf(pred: Shape | Extract<Pred, { readonly kind: 'or' }>): FilterPolicy {
  if (pred.kind === 'or') {
    const [first, second, ...rest] = pred.branches
    return { $or: [policyOf(first), policyOf(second), ...rest.map(policyOf)] }
  }

  const policy: Record<string, FilterPolicy[string]> = {}
  for (const [key, held] of pred.keys) {
    switch (held.kind) {
      case 'leaf':
        policy[key] = held.conditions
        break
      case 'object':
      case 'or':
        policy[key] = policyOf(held)
        break
      case 'any':
        break
      case 'none':
        throw new Error('an object holding a key no value meets reached the policy')
      default:
        held satisfies never
        throw new Error('a predicate reached the policy with a kind it states no answer for')
    }
  }
  return policy
}

/** The bound a policy passes, where SNS or Lambda would refuse it. */
function refusal(
  pred: Shape | Extract<Pred, { readonly kind: 'or' }>,
  policy: FilterPolicy,
  grammar: Grammar
): UnsayableTerm | undefined {
  if (grammar.bounded) {
    const { keys, combinations } = counted(pred, '', 1)
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
function counted(pred: Pred, path: string, depth: number): Counted {
  switch (pred.kind) {
    case 'any':
    case 'none':
    case 'leaf':
      return { keys: new Set(), combinations: 1 }
    case 'or': {
      const each = pred.branches.map((branch) => counted(branch, path, depth))
      return {
        keys: new Set(each.flatMap((one) => [...one.keys])),
        combinations: each.reduce((sum, one) => sum + one.combinations, 0)
      }
    }
    case 'object': {
      const keys = new Set<string>()
      let combinations = 1
      for (const [key, held] of pred.keys) {
        if (held.kind === 'leaf') {
          keys.add(`${path}${key}=${JSON.stringify(held.conditions)}`)
          combinations *= held.conditions.length * depth
        } else {
          const inner = counted(held, `${path}${key}.`, depth + 1)
          for (const pair of inner.keys) {
            keys.add(pair)
          }
          combinations *= inner.combinations
        }
      }
      return { keys, combinations }
    }
    default:
      pred satisfies never
      throw new Error('a predicate reached the count with a kind it states no answer for')
  }
}
