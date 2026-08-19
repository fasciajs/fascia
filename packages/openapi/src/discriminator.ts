import type { Described, Spelled } from '@fasciajs/core'
import type { V31 } from './openapi.js'

/**
 * A disjunction, with the property a reader chooses the member by.
 *
 * **The one thing this target states that 2020-12 has no word for.** Everywhere else an OpenAPI
 * schema is the 2020-12 schema, and the 2020-12 target reports the discriminant as a departure
 * because that dialect cannot hold it. OpenAPI holds it in both 3.0 and 3.1, so a document that
 * dropped it would lose a fact the dialect has a keyword for. A generator reads `discriminator` and
 * emits a sealed hierarchy, and reads a bare `oneOf` and emits an untagged union.
 *
 * **The mapping is written, never left to the reader.** OpenAPI resolves a value to a component
 * whose name is that value where no mapping stands. A schema called `CatDetails` holding
 * `kind: 'cat'` resolves to nothing under that rule, so a bare `propertyName` states a hierarchy no
 * reader can walk.
 *
 * **Written at the root of a component or a position, and nowhere below one.** Below the root the
 * written schema is the 2020-12 target's layout, and finding the place a term landed inside it would
 * restate a decision this package does not own. Every named disjunction is a component, so it is a
 * root. An unnamed one nested in another schema keeps the departure.
 */
export function discriminating(
  spelled: Spelled<V31.SchemaObject>,
  term: Described,
  definitions: ReadonlyMap<string, Described>,
  prefix: string
): Spelled<V31.SchemaObject> {
  const discriminator = discriminatorOf(term, definitions, prefix)
  if (discriminator === undefined) {
    return spelled
  }

  return {
    written: { ...spelled.written, discriminator },
    // The 2020-12 target gave up the discriminant and said so. This document states it, so the
    // report no longer holds and a caller refusing a loss must not stop on one that did not happen.
    // Matched by place and cause: at the root of a disjunction the 2020-12 target reports nothing
    // else of this cause, and matching the words would break on a rewording.
    departures: spelled.departures.filter(
      (one) => !(one.at.length === 0 && one.cause === 'noWordForIt')
    )
  }
}

/**
 * The discriminator a term states, where OpenAPI can state the same thing.
 *
 * Every condition below is a case where a written discriminator would send a reader somewhere the
 * term did not. Each one gives up the keyword and leaves the departure the 2020-12 target reported.
 */
function discriminatorOf(
  term: Described,
  definitions: ReadonlyMap<string, Described>,
  prefix: string
): V31.DiscriminatorObject | undefined {
  // Only a disjunction whose members exclude each other has one member to name. A term admitting
  // null carries a null branch beside the members, and null stands at no component, so the mapping
  // would have no entry for a value the term accepts.
  if (term.kind !== 'exactlyOne' || term.discriminant === undefined || term.admitsNull) {
    return undefined
  }

  const propertyName = term.discriminant
  const mapping: Record<string, string> = {}

  for (const member of term.members) {
    // A mapping holds a reference, so a member written in place has no name to hold.
    if (member.kind !== 'ref') {
      return undefined
    }

    const body = definitions.get(member.name)
    if (body === undefined) {
      return undefined
    }

    const value = valueAt(body, propertyName)
    if (value === undefined) {
      return undefined
    }

    // Two members stating one value would send a reader to one of them and refuse the other, and
    // nothing states which. The disjunction beside it still accepts both.
    if (mapping[value] !== undefined) {
      return undefined
    }

    mapping[value] = `${prefix}${member.name}`
  }

  return { propertyName, mapping }
}

/**
 * The one value a member states at the discriminating key, where a reader can rely on it.
 *
 * Required as well as stated. A reader reads the key on every value the disjunction accepts, and a
 * key a member may leave out gives it nothing to choose by. A member admitting null is written as a
 * branch beside a null branch, and the key stands on neither.
 */
function valueAt(term: Described, discriminant: string): string | undefined {
  if (term.kind !== 'typed' || term.name !== 'object' || term.admitsNull) {
    return undefined
  }

  const property = term.assertions.properties.get(discriminant)
  if (property === undefined || !property.required || property.term.kind !== 'values') {
    return undefined
  }

  // One value and a string. A member admitting two values at the key stands at two entries of the
  // mapping, and OpenAPI keys the mapping by a string.
  const [only, ...rest] = property.term.admitted
  return rest.length === 0 && only.of === 'string' ? only.value : undefined
}
