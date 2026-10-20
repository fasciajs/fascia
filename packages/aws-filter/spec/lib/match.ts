import { isIPv4 } from 'node:net'

/**
 * Whether a policy delivers a message, as SNS and Lambda decided over the recorded deliveries.
 *
 * This file is the Ajv of this target: a third party answers about a value, and the writer is held
 * to the answer. AWS cannot be asked in a spec, so its recorded answers are, and this function is
 * held to every one of them first.
 *
 * Where no recorded delivery says what AWS does, this delivers nothing. A check that a policy never
 * holds back a value is then asked of the stricter reading, so it cannot pass on a guess.
 *
 * Each reading is one service in one place, because the two services disagree. SNS reads an
 * attribute that holds a string as the content of a JSON string. Lambda reads a body that is no
 * object as an object with no keys, and SNS delivers no such body. A Lambda message is the event
 * itself, `{ body, messageAttributes }`, as a pattern names it.
 */
export type Reading = 'sns:attributes' | 'sns:body' | 'lambda'

export function delivers(policy: unknown, message: unknown, reading: Reading): boolean {
  return (
    isRecord(policy) &&
    matchesObject(
      policy,
      message,
      { escaped: reading === 'sns:attributes', lambda: reading === 'lambda' },
      false,
      true
    )
  )
}

interface How {
  readonly escaped: boolean
  /** Whether the message is a Lambda event, whose `body` may be no object. */
  readonly lambda: boolean
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function matchesObject(
  pattern: Readonly<Record<string, unknown>>,
  value: unknown,
  how: How,
  keyless: boolean,
  root: boolean
): boolean {
  // A list of objects matches where one member matches the whole pattern.
  if (Array.isArray(value) && (value.some(isRecord) || !keyless)) {
    return value.some((one) => matchesObject(pattern, one, how, false, false))
  }
  if (!isRecord(value)) {
    return keyless && matchesObject(pattern, {}, how, false, false)
  }

  return Object.entries(pattern).every(([key, held]) => {
    if (key === '$or') {
      return (
        Array.isArray(held) &&
        held.some((one) => isRecord(one) && matchesObject(one, value, how, keyless, root))
      )
    }
    const present = Object.hasOwn(value, key)
    if (Array.isArray(held)) {
      return matchesKey(held, present, value[key], how.escaped)
    }
    // Lambda reads a body that is no object as one with no keys. Recorded for `body` alone.
    const bodyless = how.lambda && root && key === 'body'
    return isRecord(held) && present && matchesObject(held, value[key], how, bodyless, false)
  })
}

function matchesKey(
  conditions: readonly unknown[],
  present: boolean,
  value: unknown,
  escaped: boolean
): boolean {
  if (!present) {
    return conditions.some((one) => isRecord(one) && one['exists'] === false)
  }
  // A list matches by any member, and an empty list by none.
  if (Array.isArray(value)) {
    return value.some((one) => matchesKey(conditions, true, one, escaped))
  }
  // An object is no leaf, so `exists: false` matches it and nothing else does.
  if (isRecord(value)) {
    return conditions.some((one) => isRecord(one) && one['exists'] === false)
  }

  // SNS reads an attribute that holds a string as the content of a JSON string, and an attribute
  // that is no such content matches nothing at all.
  let read: unknown = value
  if (escaped && typeof value === 'string') {
    try {
      read = JSON.parse(`"${value}"`)
    } catch {
      return false
    }
  }
  return conditions.some((one) => matchesCondition(one, read))
}

function matchesCondition(condition: unknown, value: unknown): boolean {
  if (!isRecord(condition)) {
    return condition === value
  }

  const [only, ...more] = Object.entries(condition)
  if (only === undefined || more.length > 0) {
    return false
  }
  const [operator, argument] = only

  switch (operator) {
    case 'exists':
      return argument === true
    case 'prefix':
      return (
        typeof value === 'string' &&
        caseless(argument, value, (text, start) => text.startsWith(start))
      )
    case 'suffix':
      return (
        typeof value === 'string' && caseless(argument, value, (text, end) => text.endsWith(end))
      )
    case 'equals-ignore-case':
      return (
        typeof value === 'string' &&
        typeof argument === 'string' &&
        value.toLowerCase() === argument.toLowerCase()
      )
    case 'wildcard':
      return (
        typeof value === 'string' && typeof argument === 'string' && globbed(argument).test(value)
      )
    case 'cidr':
      return typeof value === 'string' && typeof argument === 'string' && inRange(argument, value)
    case 'numeric':
      return typeof value === 'number' && Array.isArray(argument) && ranged(argument, value)
    case 'anything-but':
      return butMatches(argument, value)
    default:
      return false
  }
}

/** A string, or the same string under `equals-ignore-case`, tested against a value. */
function caseless(
  argument: unknown,
  value: string,
  test: (text: string, part: string) => boolean
): boolean {
  if (typeof argument === 'string') {
    return test(value, argument)
  }
  const ignored = isRecord(argument) ? argument['equals-ignore-case'] : undefined
  return typeof ignored === 'string' && test(value.toLowerCase(), ignored.toLowerCase())
}

function butMatches(argument: unknown, value: unknown): boolean {
  if (!isRecord(argument)) {
    const excluded: readonly unknown[] = Array.isArray(argument) ? argument : [argument]
    return !excluded.includes(value)
  }
  // An operator under anything-but was recorded against strings alone.
  if (typeof value !== 'string') {
    return false
  }
  return Object.entries(argument).every(([operator, held]) => {
    const each: readonly unknown[] = Array.isArray(held) ? held : [held]
    return !each.some((one) => matchesCondition({ [operator]: one }, value))
  })
}

/** A wildcard, where `\*` is a star and `\\` a backslash. */
function globbed(pattern: string): RegExp {
  let source = ''
  for (let index = 0; index < pattern.length; index += 1) {
    const here = pattern[index]
    if (here === '\\' && index + 1 < pattern.length) {
      index += 1
      source += (pattern[index] ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    } else if (here === '*') {
      source += '[\\s\\S]*'
    } else {
      source += (here ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    }
  }
  return new RegExp(`^${source}$`)
}

function ranged(argument: readonly unknown[], value: number): boolean {
  const holds = (operator: unknown, bound: unknown): boolean => {
    if (typeof bound !== 'number') {
      return false
    }
    switch (operator) {
      case '=':
        return value === bound
      case '>':
        return value > bound
      case '>=':
        return value >= bound
      case '<':
        return value < bound
      case '<=':
        return value <= bound
      default:
        return false
    }
  }
  const [first, second, third, fourth] = argument
  return argument.length === 4 ? holds(first, second) && holds(third, fourth) : holds(first, second)
}

/** An IPv4 address inside a range. The deliveries recorded no IPv6 range. */
function inRange(range: string, value: string): boolean {
  const [address, width] = range.split('/')
  if (address === undefined || width === undefined || !isIPv4(address) || !isIPv4(value)) {
    return false
  }
  const bits = (ip: string): number =>
    ip.split('.').reduce((sum, octet) => sum * 256 + Number(octet), 0)
  const kept = 2 ** (32 - Number(width))
  return Math.floor(bits(address) / kept) === Math.floor(bits(value) / kept)
}
