import { isIPv4, isIPv6 } from 'node:net'
import { Unheld } from './exact.js'

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
 * attribute that holds a string as the content of a JSON string. A pattern below the root reads a
 * value that is no object as an object with no keys, and so does an absent key. SNS delivers no
 * body that is no object. A Lambda message is the event itself, `{ body, messageAttributes }`, as a
 * pattern names it, so its body is below the root.
 */
export type Reading = 'sns:attributes' | 'sns:body' | 'lambda'

export function delivers(policy: unknown, message: unknown, reading: Reading): boolean {
  return (
    isRecord(policy) &&
    matchesObject(policy, message, { escaped: reading === 'sns:attributes' }, true, [])
  )
}

interface How {
  readonly escaped: boolean
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Unheld)

function matchesObject(
  pattern: Readonly<Record<string, unknown>>,
  value: unknown,
  how: How,
  root: boolean,
  members: readonly Readonly<Record<string, unknown>>[]
): boolean {
  // A list of objects matches where one member matches the whole pattern, and a list inside a list
  // is one list. A member of any other type matches nothing, because no row records one beside an
  // object.
  const listed = Array.isArray(value) ? flattened(value) : undefined
  if (listed !== undefined && (listed.some(isRecord) || root)) {
    const objects = listed.filter(isRecord)
    return objects.some((one) => matchesObject(pattern, one, how, false, objects))
  }
  if (!isRecord(value)) {
    return !root && matchesObject(pattern, {}, how, false, [])
  }

  return Object.entries(pattern).every(([key, held]) => {
    if (key === '$or') {
      return (
        Array.isArray(held) &&
        held.some((one) => isRecord(one) && matchesObject(one, value, how, root, members))
      )
    }
    const present = Object.hasOwn(value, key)
    // A key that one member of a list lacks and another member holds is no absent key. Recorded for
    // `exists: false`, which the other member holds back.
    if (!present && members.some((one) => Object.hasOwn(one, key))) {
      return false
    }
    if (Array.isArray(held)) {
      return matchesKey(held, present, value[key], how.escaped)
    }
    return isRecord(held) && matchesObject(held, present ? value[key] : {}, how, false, [])
  })
}

const flattened = (list: readonly unknown[]): readonly unknown[] =>
  list.flatMap((one) => (Array.isArray(one) ? flattened(one) : [one]))

/** A number no double holds equals the same number written the same way, and no other value. */
const same = (condition: unknown, value: unknown): boolean =>
  condition instanceof Unheld && value instanceof Unheld
    ? condition.text === value.text
    : condition === value

function matchesKey(
  conditions: readonly unknown[],
  present: boolean,
  value: unknown,
  escaped: boolean
): boolean {
  // An empty list is an absent key.
  if (!present || (Array.isArray(value) && value.length === 0)) {
    return conditions.some((one) => isRecord(one) && one['exists'] === false)
  }
  // A list matches by any member.
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
    return same(condition, value)
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
    return !excluded.some((one) => same(one, value))
  }
  // An operator under anything-but holds back strings alone, and delivers a value of any other type.
  if (typeof value !== 'string') {
    return true
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

/** An address inside a range of its own family. The deliveries recorded no IPv6 address that embeds IPv4. */
function inRange(range: string, value: string): boolean {
  const [address = '', width] = range.split('/')
  const from = bitsOf(address)
  const at = bitsOf(value)
  if (from === undefined || at === undefined || width === undefined || from.size !== at.size) {
    return false
  }
  const kept = BigInt(from.size - Number(width))
  return from.bits >> kept === at.bits >> kept
}

function bitsOf(ip: string): { readonly bits: bigint; readonly size: number } | undefined {
  if (isIPv4(ip)) {
    return { bits: ip.split('.').reduce((sum, octet) => sum * 256n + BigInt(octet), 0n), size: 32 }
  }
  if (!isIPv6(ip) || ip.includes('.')) {
    return undefined
  }
  const groups = (part: string): readonly string[] => (part === '' ? [] : part.split(':'))
  const [head = '', tail] = ip.split('::')
  const named = [...groups(head), ...groups(tail ?? '')]
  const all =
    tail === undefined
      ? named
      : [...groups(head), ...Array<string>(8 - named.length).fill('0'), ...groups(tail)]
  return { bits: all.reduce((sum, group) => sum * 65536n + BigInt(`0x${group}`), 0n), size: 128 }
}
