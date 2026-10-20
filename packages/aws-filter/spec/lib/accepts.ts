import { isIPv4, isIPv6 } from 'node:net'
import type { Scope } from '@fasciajs/aws-filter'
import { Unheld } from './exact.js'

/**
 * Whether AWS takes a policy in a scope, as the recorded verdicts show.
 *
 * The rules and the counts are lambada's, which measured them, and the spec beside this file holds
 * this function to every verdict before it judges a policy the writer wrote.
 */
export function accepts(policy: unknown, scope: Scope): boolean {
  const rules = RULES[scope]
  if (!isRecord(policy)) {
    return false
  }
  if (Object.keys(policy).length === 0) {
    return rules.empty
  }

  const walked = walk(policy, '', 1, rules)
  if (walked === undefined) {
    return false
  }
  if (rules.longest !== undefined && JSON.stringify(rules.longest(policy)).length > LONGEST) {
    return false
  }
  return (
    !rules.bounded ||
    (walked.pairs.size <= 5 &&
      walked.combinations <= 150 &&
      walked.complexity <= 100 &&
      walked.stars <= 3)
  )
}

interface Rules {
  readonly nested: boolean
  readonly or: boolean
  readonly bounded: boolean
  readonly empty: boolean
  readonly longest: ((policy: Readonly<Record<string, unknown>>) => unknown) | undefined
  /** Whether a numeric bound with a fraction no double holds is read rounded. Measured on an SNS body. */
  readonly rounds: boolean
}

const LONGEST = 2048

const RULES: Readonly<Record<Scope, Rules>> = {
  'sns:attributes': {
    nested: false,
    or: true,
    bounded: true,
    empty: true,
    longest: undefined,
    rounds: false
  },
  'sns:body': {
    nested: true,
    or: true,
    bounded: true,
    empty: true,
    longest: undefined,
    rounds: true
  },
  'sqs:body': {
    nested: true,
    or: true,
    bounded: false,
    empty: false,
    longest: (policy) => ({ body: policy }),
    rounds: false
  },
  'sqs:attributes': {
    nested: true,
    or: false,
    bounded: false,
    empty: false,
    longest: (policy) => ({
      messageAttributes: Object.fromEntries(
        Object.entries(policy).map(([key, held]) => [key, { stringValue: held }])
      )
    }),
    rounds: false
  }
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Unheld)

/** A number no double holds is a value both services take, though neither takes it as a bound. */
const isScalar = (value: unknown): boolean =>
  value === null ||
  value instanceof Unheld ||
  typeof value === 'string' ||
  typeof value === 'boolean' ||
  (typeof value === 'number' && Number.isFinite(value))

interface Walked {
  readonly pairs: Set<string>
  combinations: number
  complexity: number
  stars: number
}

function walk(
  policy: Readonly<Record<string, unknown>>,
  keys: string,
  depth: number,
  rules: Rules
): Walked | undefined {
  if (Object.keys(policy).length === 0) {
    return undefined
  }

  const walked: Walked = { pairs: new Set(), combinations: 1, complexity: 0, stars: 0 }
  const take = (inner: Walked): void => {
    for (const pair of inner.pairs) {
      walked.pairs.add(pair)
    }
    walked.complexity += inner.complexity
    walked.stars = Math.max(walked.stars, inner.stars)
  }

  for (const [key, held] of Object.entries(policy)) {
    if (key === '$or') {
      if (!rules.or || !Array.isArray(held) || held.length < 2 || !held.every(isRecord)) {
        return undefined
      }
      const branches = held.map((branch) => walk(branch, keys, depth, rules))
      let sum = 0
      for (const branch of branches) {
        if (branch === undefined) {
          return undefined
        }
        take(branch)
        sum += branch.combinations
      }
      walked.combinations *= sum
    } else if (Array.isArray(held)) {
      if (held.length === 0 || !held.every((one) => isCondition(one, rules))) {
        return undefined
      }
      const counts = held.flatMap((one) => {
        const patterns = wildcardsIn(one)
        return patterns.length > 0 ? patterns.map(starsIn) : [0]
      })
      walked.pairs.add(`${keys}${key}=${JSON.stringify(held)}`)
      walked.combinations *= held.length * depth
      walked.complexity +=
        counts.reduce((sum, stars) => sum + (stars > 1 ? 3 * stars : stars), 0) * counts.length
      walked.stars = Math.max(walked.stars, ...counts)
    } else if (rules.nested && isRecord(held)) {
      const inner = walk(held, `${keys}${key}.`, depth + 1, rules)
      if (inner === undefined) {
        return undefined
      }
      take(inner)
      walked.combinations *= inner.combinations
    } else {
      return undefined
    }
  }

  return walked
}

function isCondition(condition: unknown, rules: Rules): boolean {
  if (!isRecord(condition)) {
    return isScalar(condition)
  }
  const [only, ...more] = Object.entries(condition)
  if (only === undefined || more.length > 0) {
    return false
  }
  const [operator, argument] = only
  switch (operator) {
    case 'prefix':
    case 'suffix':
      return typeof argument === 'string' || isIgnoringCase(argument)
    case 'equals-ignore-case':
      return typeof argument === 'string'
    case 'wildcard':
      return isPattern(argument)
    case 'exists':
      return typeof argument === 'boolean'
    case 'cidr':
      return isCidr(argument)
    case 'numeric':
      return isNumeric(argument, rules)
    case 'anything-but':
      return isExclusion(argument)
    default:
      return false
  }
}

const isIgnoringCase = (value: unknown): boolean =>
  isRecord(value) &&
  Object.keys(value).length === 1 &&
  typeof value['equals-ignore-case'] === 'string'

/** `\*` and `\\` are a star and a backslash, and two stars that meet are refused. */
const isPattern = (value: unknown): value is string =>
  typeof value === 'string' && !value.replace(/\\[\\*]/g, '_').includes('**')

function isCidr(value: unknown): boolean {
  const [address, prefix, ...rest] = typeof value === 'string' ? value.split('/') : []
  const width = isIPv4(address ?? '') ? 32 : isIPv6(address ?? '') ? 128 : 0
  return rest.length === 0 && width > 0 && /^\d{1,3}$/.test(prefix ?? '') && Number(prefix) < width
}

function isNumeric(value: unknown, rules: Rules): boolean {
  if (!Array.isArray(value)) {
    return false
  }
  const lower = (one: unknown): boolean => one === '>' || one === '>='
  const upper = (one: unknown): boolean => one === '<' || one === '<='
  const number = (one: unknown): one is number => typeof one === 'number' && Number.isFinite(one)
  const [first, second, third, fourth] = value
  if (value.length === 2) {
    const rounded = rules.rounds && second instanceof Unheld && second.fraction
    return (first === '=' || lower(first) || upper(first)) && (number(second) || rounded)
  }
  return (
    value.length === 4 &&
    lower(first) &&
    number(second) &&
    upper(third) &&
    number(fourth) &&
    second < fourth
  )
}

function isExclusion(value: unknown): boolean {
  const every = (list: readonly unknown[], test: (one: unknown) => boolean): boolean =>
    list.length > 0 && list.every(test)
  const isString = (one: unknown): boolean => typeof one === 'string'
  const isNumber = (one: unknown): boolean => typeof one === 'number' && Number.isFinite(one)

  if (isString(value) || isNumber(value)) {
    return true
  }
  if (Array.isArray(value)) {
    return every(value, isString) || every(value, isNumber)
  }
  if (!isRecord(value)) {
    return false
  }
  const [only, ...more] = Object.entries(value)
  if (only === undefined || more.length > 0) {
    return false
  }
  const [operator, argument] = only
  const test = operator === 'wildcard' ? isPattern : isString
  const known = ['prefix', 'suffix', 'wildcard', 'equals-ignore-case'].includes(operator)
  return known && (test(argument) || (Array.isArray(argument) && every(argument, test)))
}

function wildcardsIn(condition: unknown): readonly string[] {
  if (!isRecord(condition)) {
    return []
  }
  const but = condition['anything-but']
  const pattern = condition['wildcard'] ?? (isRecord(but) ? but['wildcard'] : undefined)
  if (typeof pattern === 'string') {
    return [pattern]
  }
  return Array.isArray(pattern)
    ? pattern.filter((one): one is string => typeof one === 'string')
    : []
}

/** SNS counts an escaped star too. */
const starsIn = (pattern: string): number => pattern.split('*').length - 1
