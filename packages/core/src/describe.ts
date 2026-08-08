import type { Described, DescribedProperty, DescribedRest } from './described.js'
import type { Node, NodeFold, Rest, Source } from './node.js'
import { foldSource } from './node.js'
import { FasciaError, isError } from './result.js'

/**
 * What a read schema is true of, as one algebra over the reading.
 *
 * One walk with one answer. Every disagreement a library of this shape has with itself comes from
 * one question about a schema answered in two places, so nullability, optionality and what a
 * conversion states are each decided here and nowhere else.
 *
 * Generic in the source library. This file names no validator, which is what a second frontend
 * inherits rather than re-earns.
 */

/** A schema that cannot be described, because nothing true of it can be written down. */
export class UndescribableSchema extends FasciaError<{ schema: unknown }> {
  constructor(schema: unknown, reason: string) {
    super(`this schema cannot be described: ${reason}`, { schema })
  }
}

/** A term, or the reason there is none. */
export type Description = Described | UndescribableSchema

/**
 * The algebra.
 *
 * A case answers with a term or with a failure, and a case that folds a child gets the child's
 * answer the same way. Nothing here throws: a schema this library cannot describe is a value a
 * caller reads, so a caller can describe the rest of a document and be told which part is missing.
 */
function describing<S>(): NodeFold<S, Description> {
  return {
    scalar: (node) => scalar(node),

    values: (node) => ({ kind: 'values', admitted: node.admitted, admitsNull: false }),

    wrapper: (node, follow) => wrapper(node, follow),

    structural: (node, follow) => structural(node, follow),

    combination: (node, follow) => combination(node, follow),

    conversion: (node, follow) => conversion(node, follow),

    deferred: (node, follow) => follow(node.resolve()),

    unreadable: ({ error }) =>
      new UndescribableSchema(error, `the schema could not be read: ${error.message}`),

    revisited: (schema) =>
      new UndescribableSchema(
        schema,
        'this schema holds itself, and a term has no way to name a schema yet'
      )
  }
}

/** The one entry point. A source library's schema, described. */
export function describe<S>(schema: S, source: Source<S>): Description {
  return foldSource(schema, source, describing<S>())
}

function scalar<S>(node: Extract<Node<S>, { kind: 'scalar' }>): Description {
  switch (node.name) {
    case 'string':
      return { kind: 'typed', name: 'string', assertions: node.assertions, admitsNull: false }
    case 'number':
      return { kind: 'typed', name: 'number', assertions: node.assertions, admitsNull: false }
    case 'boolean':
      return { kind: 'typed', name: 'boolean', assertions: {}, admitsNull: false }
    case 'unknown':
      return { kind: 'untyped', admitsNull: false }

    // Null is a value rather than a type, so a schema admitting only null admits one value.
    case 'null':
      return { kind: 'values', admitted: [{ of: 'null' }], admitsNull: true }

    // A bigint and a date are values JSON has no form for. A document naming a string or a number
    // for either would be describing a value the schema rejects every instance of.
    case 'bigint':
      return new UndescribableSchema(
        node,
        'a bigint has no JSON form, so nothing states how one is written on the wire'
      )
    case 'date':
      return new UndescribableSchema(
        node,
        'a date has no JSON form, so nothing states how one is written on the wire'
      )
    default:
      node satisfies never
      throw new Error('a reading produced a scalar of no name')
  }
}

/**
 * A wrapper, which changes what the schema it holds admits without changing what it is.
 *
 * Nullability is decided here and only here. A term is built from the inside out, so a wrapper takes
 * the term beneath it and states one more thing about the same value rather than nesting a case.
 */
function wrapper<S>(
  node: Extract<Node<S>, { kind: 'wrapper' }>,
  follow: (child: S) => Description
): Description {
  const inner = follow(node.inner)
  if (isError(inner)) {
    return inner
  }

  switch (node.how) {
    case 'nullable':
      return { ...inner, admitsNull: true }

    // Whether a key may be absent is a fact about the key, which an object states on its edge. Met
    // anywhere else it says nothing a document can carry, so the term beneath is the answer.
    case 'optional':
    case 'nonoptional':
    case 'default':
      return inner

    // Freezing what a parse returns, and replacing a failed parse, both leave what a caller may
    // send exactly as the inner schema states it.
    case 'readonly':
    case 'catch':
      return inner

    default:
      node satisfies never
      throw new Error('a reading produced a wrapper of no kind')
  }
}

function structural<S>(
  node: Extract<Node<S>, { kind: 'structural' }>,
  follow: (child: S) => Description
): Description {
  switch (node.of) {
    case 'object': {
      const properties = new Map<string, DescribedProperty>()
      for (const [key, property] of node.properties) {
        const term = follow(property.schema)
        if (isError(term)) {
          return term
        }
        properties.set(key, { term, required: property.required, default: property.default })
      }

      const rest = restOf(node.rest, follow)
      return isError(rest)
        ? rest
        : {
            kind: 'typed',
            name: 'object',
            assertions: { properties, rest },
            admitsNull: false
          }
    }

    case 'list': {
      const items = follow(node.items)
      return isError(items)
        ? items
        : {
            kind: 'typed',
            name: 'array',
            assertions: {
              items,
              ...(node.assertions.minItems !== undefined && { minItems: node.assertions.minItems }),
              ...(node.assertions.maxItems !== undefined && { maxItems: node.assertions.maxItems })
            },
            admitsNull: false
          }
    }

    case 'tuple': {
      const positions: Described[] = []
      for (const position of node.positions) {
        const term = follow(position)
        if (isError(term)) {
          return term
        }
        positions.push(term)
      }

      const rest = restOf(node.rest, follow)
      return isError(rest) ? rest : { kind: 'tuple', positions, rest, admitsNull: false }
    }

    // A document names a key with a string. What a key must satisfy beyond being a string is a
    // statement about the key rather than about the value at it, and no target here has a word for
    // one, so the key schema is dropped and the values are what the term states.
    case 'dictionary': {
      const values = follow(node.values)
      return isError(values)
        ? values
        : {
            kind: 'typed',
            name: 'object',
            assertions: { properties: new Map(), rest: { allows: 'term', term: values } },
            admitsNull: false
          }
    }

    default:
      node satisfies never
      throw new Error('a reading produced a structure of no shape')
  }
}

function restOf<S>(
  rest: Rest<S>,
  follow: (child: S) => Description
): DescribedRest | UndescribableSchema {
  switch (rest.allows) {
    case 'anything':
      return { allows: 'anything' }
    case 'nothing':
      return { allows: 'nothing' }
    case 'schema': {
      const term = follow(rest.schema)
      return isError(term) ? term : { allows: 'term', term }
    }
    default:
      rest satisfies never
      throw new Error('a reading produced a rest of no kind')
  }
}

/**
 * A combination, and the one member that is not a member.
 *
 * A member admitting only null is not a member of a disjunction, it is the disjunction admitting
 * null. Left as a member it would reach a target that has to decide the same thing again, and the
 * two answers would be free to disagree.
 */
function combination<S>(
  node: Extract<Node<S>, { kind: 'combination' }>,
  follow: (child: S) => Description
): Description {
  const terms: Described[] = []
  let admitsNull = false

  for (const member of node.members) {
    const term = follow(member)
    if (isError(term)) {
      return term
    }
    if (isOnlyNull(term)) {
      admitsNull = true
      continue
    }
    admitsNull = admitsNull || term.admitsNull
    terms.push(term)
  }

  const [first, second, ...rest] = terms

  // Every member admitted only null, so the whole disjunction is the null value.
  if (first === undefined) {
    return { kind: 'values', admitted: [{ of: 'null' }], admitsNull: true }
  }

  // One member is left after the null members were taken out, so there is nothing to choose between.
  if (second === undefined) {
    return { ...first, admitsNull }
  }

  const members: readonly [Described, Described, ...Described[]] = [first, second, ...rest]

  switch (node.law) {
    case 'any':
      return { kind: 'some', members, admitsNull }
    case 'exactlyOne':
      return { kind: 'exactlyOne', members, discriminant: node.discriminant, admitsNull }
    case 'all':
      return { kind: 'every', members, admitsNull }
    default:
      node.law satisfies never
      throw new Error('a reading produced a combination of no law')
  }
}

function isOnlyNull(term: Described): boolean {
  return term.kind === 'values' && term.admitted.length === 1 && term.admitted[0]?.of === 'null'
}

/**
 * A conversion, described by what a caller sends.
 *
 * A codec's wire form is its input side whichever way the conversion runs, so the other side is an
 * in-memory type no document describes. A conversion that states no input describes nothing a caller
 * could be told to send.
 */
function conversion<S>(
  node: Extract<Node<S>, { kind: 'conversion' }>,
  follow: (child: S) => Description
): Description {
  switch (node.how) {
    case 'checks':
    case 'transforms':
      return follow(node.sent)
    case 'codec':
      return follow(node.wire)
    case 'unstatedOutput':
      return follow(node.sent)
    case 'unstatedInput':
      return new UndescribableSchema(
        node,
        'a conversion runs before this, so no schema states what a caller may send'
      )
    default:
      node satisfies never
      throw new Error('a reading produced a conversion of no kind')
  }
}
