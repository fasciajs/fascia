import type { Described, StringFormat } from '@fasciajs/core'

/**
 * The values a term's own shape suggests, beside the fixed pool `VALUES` holds.
 *
 * A departure claims a document accepts more than the schema, and finding the value that shows it
 * needs the bound the schema stated. A value on each side of every bound is what is drawn here.
 */
export function valuesNear(
  term: Described,
  definitions: ReadonlyMap<string, Described>
): unknown[] {
  return drawn(term, definitions, 0)
}

/** One value each format admits and one it turns away, which tells a stated format from a dropped one. */
const FORMATTED: Readonly<Record<StringFormat, readonly string[]>> = {
  email: ['a@b.com', 'a@b@c.com'],
  uri: ['https://a.example/b', 'not a uri'],
  uuid: ['123e4567-e89b-12d3-a456-426614174000', '123e4567-e89b-12d3-a456-42661417400'],
  hostname: ['a.example', 'not a hostname'],
  ipv4: ['192.0.2.1', '192.0.2.256'],
  ipv6: ['2001:db8::1', '2001:db8::g'],
  date: ['2026-09-05', '2026-13-05'],
  time: ['12:30:00', '25:30:00'],
  'date-time': ['2026-09-05T12:30:00Z', '2026-09-05T25:30:00Z'],
  duration: ['P1D', 'P1X']
}

/** A term holds a cycle as a reference, so the bound is on the walk. */
const DEEPEST = 6

function drawn(
  term: Described,
  definitions: ReadonlyMap<string, Described>,
  depth: number
): unknown[] {
  if (depth > DEEPEST) {
    return []
  }

  const found: unknown[] = [null]

  switch (term.kind) {
    case 'typed':
      return [...found, ...fromTyped(term, definitions, depth)]
    case 'values': {
      for (const one of term.admitted) {
        found.push(one.of === 'null' ? null : one.value)
      }
      found.push('a value the term does not admit', -98765.5)
      return found
    }
    case 'some':
    case 'every':
    case 'exactlyOne': {
      for (const member of term.members) {
        found.push(...drawn(member, definitions, depth + 1))
      }
      return found
    }
    case 'set': {
      const one = first(term.items, definitions, depth)
      found.push([], [one], [one, one])
      return found
    }
    case 'tuple': {
      const filled = term.positions.map((position) => first(position, definitions, depth))
      found.push(filled, filled.slice(0, -1), [...filled, 'one position more'], [])
      return found
    }
    case 'ref': {
      const named = definitions.get(term.name)
      return named === undefined ? found : [...found, ...drawn(named, definitions, depth + 1)]
    }
    case 'untyped':
      return found
    default:
      term satisfies never
      throw new Error('a term carries a case this draw has no values for')
  }
}

function fromTyped(
  term: Extract<Described, { kind: 'typed' }>,
  definitions: ReadonlyMap<string, Described>,
  depth: number
): unknown[] {
  switch (term.name) {
    case 'string': {
      const { minLength, maxLength, format } = term.assertions
      const least = minLength ?? 0
      const most = maxLength ?? least + 1
      const lengths = [
        'a'.repeat(Math.max(0, least - 1)),
        'a'.repeat(least),
        'a'.repeat(most),
        'a'.repeat(most + 1)
      ]
      // No length reaches a format, and both sides refuse the whole pool without a value it admits.
      return format === undefined ? lengths : [...lengths, ...FORMATTED[format]]
    }
    case 'number': {
      const { minimum, maximum, multipleOf } = term.assertions
      const found: unknown[] = [0, 1, 1.5, -1.5, 2.5]
      for (const bound of [minimum, maximum]) {
        if (bound !== undefined) {
          found.push(
            bound.value,
            bound.value - 1,
            bound.value + 1,
            bound.value - 0.5,
            bound.value + 0.5
          )
        }
      }
      if (multipleOf !== undefined) {
        found.push(multipleOf, multipleOf * 2, multipleOf * 1.5, multipleOf + 0.25)
      }
      return found
    }
    case 'boolean':
      return [true, false]
    case 'object': {
      const built: Record<string, unknown> = {}
      for (const [name, property] of term.assertions.properties) {
        built[name] = first(property.term, definitions, depth)
      }
      const found: unknown[] = [
        { ...built },
        { ...built, unnamed: 'a key the object does not name' }
      ]
      for (const name of Object.keys(built)) {
        const without = { ...built }
        delete without[name]
        found.push(without)
      }
      return found
    }
    case 'array': {
      const { minItems, maxItems } = term.assertions
      const one = first(term.assertions.items, definitions, depth)
      const least = minItems ?? 0
      const most = maxItems ?? least + 1
      return [
        [],
        [one],
        [one, one],
        Array.from({ length: Math.max(0, least - 1) }, () => one),
        Array.from({ length: most + 1 }, () => one)
      ]
    }
    default:
      term satisfies never
      throw new Error('a typed term carries a name this draw has no values for')
  }
}

/**
 * One value to fill a place with, preferring one that carries something.
 *
 * The empty list stands first among a list's values, so a place filled with it never nested and a
 * schema that holds itself drew the same values as its first unrolling.
 */
function first(
  term: Described,
  definitions: ReadonlyMap<string, Described>,
  depth: number
): unknown {
  const values = drawn(term, definitions, depth + 1)
  const held = (one: unknown): boolean => one !== null && !(Array.isArray(one) && one.length === 0)

  return values.find(held) ?? values.find((one) => one !== null) ?? 'a'
}
