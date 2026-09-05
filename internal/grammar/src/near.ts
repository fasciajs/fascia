import type { Described, StringFormat } from '@fasciajs/core'

/**
 * The values a term's own shape suggests, beside the values it would not.
 *
 * `VALUES` is fixed, and the reason is written where it is defined: the values that tell two
 * readings apart are the ones a schema's own shape would not suggest. That argument holds for what
 * it was written for, and it leaves a question nothing asks. A departure claims a document accepts
 * more than the schema. Finding the value that shows it needs the bound the schema stated, and a
 * fixed pool does not know the bound.
 *
 * So this is a second source rather than a replacement. Over a run of both, the values drawn here
 * found more disagreements than the fixed pool did, and every one was already named by a departure.
 *
 * **Each case gives a value on each side of what it states.** A string of one below the minimum
 * length and one at it, a number at a bound and half a unit either side of it, a list one shorter
 * than the minimum and one longer than the maximum, an object with a required key removed and one
 * with a key nobody named. What is here is what a bound admits and what it turns away, so a document
 * that states the bound loosely is asked the one value that shows it.
 */
export function valuesNear(
  term: Described,
  definitions: ReadonlyMap<string, Described>
): unknown[] {
  return drawn(term, definitions, 0)
}

/**
 * A value each format admits, and one it turns away.
 *
 * Written here rather than decided, because deciding a format is a validator's work and writing one
 * example of each is not. The near miss is what tells a document that states the format from one
 * that dropped it: both take the first and only one turns away the second.
 */
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

/** How deep the walk goes. A term holds a cycle as a reference, so the bound is on the walk. */
const DEEPEST = 3

function drawn(
  term: Described,
  definitions: ReadonlyMap<string, Described>,
  depth: number
): unknown[] {
  if (depth > DEEPEST) {
    return []
  }

  // Null is asked of every term, because whether a term admits it is a fact every case carries.
  const found: unknown[] = [null]

  switch (term.kind) {
    case 'typed':
      return [...found, ...fromTyped(term, definitions, depth)]
    case 'values': {
      for (const one of term.admitted) {
        found.push(one.of === 'null' ? null : one.value)
      }
      // A value no member admits, which is what says the document holds the set rather than the type.
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
      // A value held twice, which is the half of a set a document can turn away.
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
      // A format is the one assertion no length reaches. Without a value the format admits, a term
      // that states one refuses the whole pool, and a document that dropped the format agrees by
      // refusing it too.
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

/** One value to fill a place with. A place has to hold something for the shape to be asked about. */
function first(
  term: Described,
  definitions: ReadonlyMap<string, Described>,
  depth: number
): unknown {
  return drawn(term, definitions, depth + 1).find((one) => one !== null) ?? 'a'
}
