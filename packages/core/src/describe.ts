import type { Described, DescribedProperty, DescribedRest } from './described.js'
import type { Node, Rest, Source } from './node.js'
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

/**
 * A schema described, and everything it referred to by name.
 *
 * The definitions are flat and keyed by name, which is the shape both targets want: ATD resolves a
 * `ref` against an app definition's `definitions`, and JSON Schema resolves a `$ref` against `$defs`.
 */
export interface Description {
  readonly term: Described
  readonly definitions: ReadonlyMap<string, Described>
}

/** A description, or the reason there is none. */
export type Describing = Description | UndescribableSchema

interface Naming<S> {
  readonly definitions: Map<string, Described>
  /** Names bound and not yet described. A schema meeting its own name is a cycle, and that is the point. */
  readonly binding: Set<string>
  /**
   * A schema being described that turned out to have a name, and the name to file it under.
   *
   * A validator may name the thunk rather than the schema, so the name is found on the way down and
   * points back at something already being described. arktype does this: a recursive type is reached
   * through an alias carrying the name, and the alias resolves to the schema the walk began at.
   */
  readonly pending: Map<S, string>
}

/**
 * A source library's schema, described.
 *
 * **This owns its walk rather than folding through `foldSource`.** Naming, the definitions table and
 * what to do about a cycle are one decision, and the generic walk knows about none of them: its
 * cases receive a node and cannot tell which schema produced one, so a name could not be bound where
 * it has to be bound.
 */
export function describe<S>(schema: S, source: Source<S>): Describing {
  const naming: Naming<S> = { definitions: new Map(), binding: new Set(), pending: new Map() }
  const term = at(schema, source, naming, new Set())

  return isError(term) ? term : { term, definitions: naming.definitions }
}

/**
 * One schema, described, with its name bound before its body is walked.
 *
 * Binding first is the whole mechanism. A schema that holds itself meets its own name on the way
 * down and yields a reference, so the knot ties itself and no sentinel is needed. The same step
 * describes a schema used in several places once and points at it thereafter.
 */
function at<S>(
  schema: S,
  source: Source<S>,
  naming: Naming<S>,
  ancestors: ReadonlySet<S>
): Described | UndescribableSchema {
  const name = source.nameOf(schema)

  if (name === undefined) {
    return body(schema, source, naming, ancestors)
  }

  if (naming.definitions.has(name) || naming.binding.has(name)) {
    return { kind: 'ref', name, admitsNull: false }
  }

  // The name points back at something already being described, so the name belongs to that and the
  // walk has simply met it from below. It is filed under this name when it finishes.
  const target = resolved(schema, source)
  if (target !== undefined && ancestors.has(target)) {
    naming.pending.set(target, name)
    return { kind: 'ref', name, admitsNull: false }
  }

  naming.binding.add(name)
  const described = body(schema, source, naming, ancestors)
  naming.binding.delete(name)

  if (isError(described)) {
    return described
  }

  naming.definitions.set(name, described)
  return { kind: 'ref', name, admitsNull: false }
}

/** What a chain of thunks stands for, or nothing where the chain does not end. */
function resolved<S>(schema: S, source: Source<S>): S | undefined {
  let current = schema
  const seen = new Set<S>()

  while (!seen.has(current)) {
    seen.add(current)
    const read = source.read(current)
    if (isError(read) || read.kind !== 'deferred') {
      return current
    }
    current = read.resolve()
  }

  return undefined
}

function body<S>(
  schema: S,
  source: Source<S>,
  naming: Naming<S>,
  ancestors: ReadonlySet<S>
): Described | UndescribableSchema {
  const entered = schema
  let current = schema
  let path = ancestors

  // A thunk is followed here rather than through `at`, because resolving one is not descending into
  // something else: it is the same thing, reached lazily. Following it through `at` would ask what
  // the resolved schema is named, and a validator that names the thunk rather than the schema would
  // lose the binding on the way through. arktype does exactly that, and the first version of this
  // reported a named recursive type as an unnamed cycle.
  for (;;) {
    if (path.has(current)) {
      return new UndescribableSchema(
        current,
        'this schema holds itself and nothing names it. Give it a name, so a document can refer to it'
      )
    }

    const read = source.read(current)
    if (isError(read)) {
      return new UndescribableSchema(current, `the schema could not be read: ${read.message}`)
    }

    path = new Set(path).add(current)

    if (read.kind !== 'deferred') {
      const term = described(read, source, naming, path)
      if (isError(term)) {
        return term
      }

      // Something below named this while it was being described, so it is filed under that name and
      // what stands here is a reference to it.
      const name = naming.pending.get(entered) ?? naming.pending.get(current)
      if (name === undefined) {
        return term
      }

      naming.definitions.set(name, term)
      return { kind: 'ref', name, admitsNull: false }
    }

    current = read.resolve()
  }
}

function described<S>(
  node: Exclude<Node<S>, { kind: 'deferred' }>,
  source: Source<S>,
  naming: Naming<S>,
  path: ReadonlySet<S>
): Described | UndescribableSchema {
  const follow = (child: S): Described | UndescribableSchema => at(child, source, naming, path)

  switch (node.kind) {
    case 'scalar':
      return scalar(node)
    case 'values':
      return { kind: 'values', admitted: node.admitted, admitsNull: false }
    case 'wrapper':
      return wrapper(node, follow)
    case 'structural':
      return structural(node, follow)
    case 'combination':
      return combination(node, follow)
    case 'conversion':
      return conversion(node, follow)
    default:
      node satisfies never
      throw new Error('a reading produced a node of no group')
  }
}

function scalar<S>(node: Extract<Node<S>, { kind: 'scalar' }>): Described | UndescribableSchema {
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
  follow: (child: S) => Described | UndescribableSchema
): Described | UndescribableSchema {
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
  follow: (child: S) => Described | UndescribableSchema
): Described | UndescribableSchema {
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
  follow: (child: S) => Described | UndescribableSchema
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
  follow: (child: S) => Described | UndescribableSchema
): Described | UndescribableSchema {
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
  follow: (child: S) => Described | UndescribableSchema
): Described | UndescribableSchema {
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
