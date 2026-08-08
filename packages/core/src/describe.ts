import type { Described, DescribedProperty, DescribedRest } from './described.js'
import type { Node, ObjectProperty, Rest, Source } from './node.js'
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

/**
 * Which side of a schema a description is about.
 *
 * **A schema does not have a direction, a position does.** A request body is what a caller sends and
 * a response body is what a caller receives, and the same schema stands in both places. So the side
 * is stated by whoever asks for the description and never read off the schema.
 *
 * Stated rather than defaulted, at every call. A default is how the two sides disagree in silence:
 * one traversal is told and another takes the default, and the document that comes out is wrong in a
 * way nothing reports.
 */
export type Io = 'input' | 'output'

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
  /**
   * Which schema claimed each name.
   *
   * Without it, the second schema to claim a name is silently described as the first: both become a
   * reference to one definition, and the document states one shape where the schema states two.
   * Nothing else reports that, because a reference to a name that exists is a well formed document.
   */
  readonly claimedBy: Map<string, S>
}

/**
 * What the walk carries the whole way down.
 *
 * The three travel together at every step, so they travel as one thing. `io` joined them and made
 * that plain: a fifth parameter threaded through six functions is the same state with more places to
 * forget it.
 */
interface Walk<S> {
  readonly source: Source<S>
  readonly io: Io
  readonly naming: Naming<S>
}

/** Several schemas described together, sharing one set of names. */
export interface Descriptions {
  readonly terms: readonly Described[]
  readonly definitions: ReadonlyMap<string, Described>
}

/**
 * Several schemas described under one set of names.
 *
 * **A name is scoped to this call, and that is the whole of the scoping rule.** Two schemas
 * described together may not disagree about a name, and two described apart never meet, so the same
 * schema may be called one thing in one document and another in the next.
 *
 * The scope cannot live with the reading. A reading answers what the source library calls a schema,
 * and a source library's answer is one answer: zod keeps names in a registry that outlives every
 * document, so two documents sharing a reading could never disagree about a name. Whether two things
 * may share one is a fact about a document.
 */
export function describeAll<S>(
  schemas: readonly S[],
  source: Source<S>,
  io: Io
): Descriptions | UndescribableSchema {
  const walk: Walk<S> = {
    source,
    io,
    naming: {
      definitions: new Map(),
      binding: new Set(),
      pending: new Map(),
      claimedBy: new Map()
    }
  }

  const terms: Described[] = []
  for (const schema of schemas) {
    const term = at(schema, walk, new Set())
    if (isError(term)) {
      return term
    }
    terms.push(term)
  }

  return { terms, definitions: walk.naming.definitions }
}

/**
 * One schema, described.
 *
 * **This owns its walk rather than folding through `foldSource`.** Naming, the definitions table and
 * what to do about a cycle are one decision, and the generic walk knows about none of them: its
 * cases receive a node and cannot tell which schema produced one, so a name could not be bound where
 * it has to be bound.
 */
export function describe<S>(schema: S, source: Source<S>, io: Io): Describing {
  const described = describeAll([schema], source, io)
  if (isError(described)) {
    return described
  }

  const [term] = described.terms
  return term === undefined
    ? new UndescribableSchema(schema, 'nothing was described')
    : { term, definitions: described.definitions }
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
  walk: Walk<S>,
  ancestors: ReadonlySet<S>
): Described | UndescribableSchema {
  const { source, naming } = walk
  const name = source.nameOf(schema)

  if (name === undefined) {
    return body(schema, walk, ancestors)
  }

  const claimed = naming.claimedBy.get(name)
  if (claimed !== undefined) {
    return isSameSchema(claimed, schema, source)
      ? { kind: 'ref', name, admitsNull: false }
      : sameThing(name, schema, walk, ancestors)
  }

  // The name points back at something already being described, so the name belongs to that and the
  // walk has simply met it from below. It is filed under this name when it finishes.
  const target = resolved(schema, source)
  if (target !== undefined && ancestors.has(target)) {
    naming.pending.set(target, name)
    return { kind: 'ref', name, admitsNull: false }
  }

  naming.binding.add(name)
  naming.claimedBy.set(name, schema)
  const described = body(schema, walk, ancestors)
  naming.binding.delete(name)

  if (isError(described)) {
    return described
  }

  naming.definitions.set(name, described)
  return { kind: 'ref', name, admitsNull: false }
}

/**
 * Whether two schemas are the same one, reached two ways.
 *
 * Identity alone is not enough, and neither is identity after resolving. effect keeps a name on the
 * thunk, so the thunk and what it resolves to are two objects standing for one schema. zod builds a
 * fresh schema every time a thunk is called, so what one resolves to is a different object each
 * time. Asking both questions answers for both.
 */
function isSameSchema<S>(left: S, right: S, source: Source<S>): boolean {
  if (left === right) {
    return true
  }

  const to = resolved(right, source)
  return to !== undefined && (to === left || to === resolved(left, source))
}

/**
 * Whether a second schema claiming a name describes the same thing as the first.
 *
 * Two schemas may be one thing written twice, which is common and harmless, or two things sharing a
 * name, which makes a document state one shape where the schema states two. The two cannot be told
 * apart by identity, so the second is described and the two are compared.
 */
function sameThing<S>(
  name: string,
  schema: S,
  walk: Walk<S>,
  ancestors: ReadonlySet<S>
): Described | UndescribableSchema {
  const already = walk.naming.definitions.get(name)

  if (already === undefined) {
    // The first is still being described, so there is nothing to compare against. A different schema
    // reaching a name mid-definition is a claim on a name that is already spoken for.
    return new UndescribableSchema(
      schema,
      `two schemas are named ${name}, and the first is still being described. A name states one shape, so give one of them another name`
    )
  }

  const second = body(schema, walk, ancestors)
  if (isError(second)) {
    return second
  }

  if (canonical(already) === canonical(second)) {
    return { kind: 'ref', name, admitsNull: false }
  }

  return new UndescribableSchema(
    schema,
    `two different schemas are named ${name}. A document states one shape under a name, so the second would be written as the first. Give one of them another name`
  )
}

/**
 * A string two terms share exactly when they describe the same thing.
 *
 * Keys are sorted, so a property order a validator chose is not a difference. Equality is string
 * equality, which is what makes the comparison above cheap enough to run on every second claim.
 */
function canonical(term: unknown): string {
  if (typeof term === 'bigint') {
    return `${term}n`
  }
  if (term instanceof Map) {
    return canonical(Object.fromEntries([...term.entries()]))
  }
  if (Array.isArray(term)) {
    return `[${term.map(canonical).join(',')}]`
  }
  if (typeof term === 'object' && term !== null) {
    const entries = Object.entries(term)
      .filter(([, value]) => value !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : 1))

    return `{${entries.map(([key, value]) => `${key}:${canonical(value)}`).join(',')}}`
  }
  return JSON.stringify(term) ?? 'undefined'
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
  walk: Walk<S>,
  ancestors: ReadonlySet<S>
): Described | UndescribableSchema {
  const { source, naming } = walk
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
      const term = described(read, walk, path)
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
  walk: Walk<S>,
  path: ReadonlySet<S>
): Described | UndescribableSchema {
  const follow = (child: S): Described | UndescribableSchema => at(child, walk, path)

  switch (node.kind) {
    case 'scalar':
      return scalar(node)
    case 'values':
      return { kind: 'values', admitted: node.admitted, admitsNull: false }
    case 'wrapper':
      return wrapper(node, follow)
    case 'structural':
      return structural(node, follow, walk.io)
    case 'combination':
      return combination(node, follow)
    case 'conversion':
      return conversion(node, follow, walk.io)
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
  follow: (child: S) => Described | UndescribableSchema,
  io: Io
): Described | UndescribableSchema {
  switch (node.of) {
    case 'object': {
      const properties = new Map<string, DescribedProperty>()
      for (const [key, property] of node.properties) {
        const term = follow(property.schema)
        if (isError(term)) {
          return term
        }
        properties.set(key, {
          term,
          required: isRequired(property, io),
          default: property.default
        })
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

/**
 * Whether a key is present, which is not the same question on the two sides.
 *
 * A key with a default may be left out of what a caller sends and is always in what comes back, so
 * one edge states two things. zod and arktype both state a default here and both need the answer;
 * effect states it as a conversion instead, giving one shape for each side, so this changes nothing
 * for effect and the sides still differ.
 */
function isRequired<S>(property: ObjectProperty<S>, io: Io): boolean {
  return property.required || (io === 'output' && property.default !== undefined)
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
 * A conversion, described by the side that was asked for.
 *
 * This is the case the side exists for. A conversion is the one construct whose two ends are two
 * different schemas, and every validator here writes one: zod as a pipe, arktype as a morph, effect
 * as a transformation that always carries both.
 *
 * An end that no schema states is a refusal rather than a departure, and which end that is depends
 * on the side. A conversion standing last leaves nothing to describe on the output; one standing
 * first leaves nothing on the input. Both are the same fact met from two directions.
 */
function conversion<S>(
  node: Extract<Node<S>, { kind: 'conversion' }>,
  follow: (child: S) => Described | UndescribableSchema,
  io: Io
): Described | UndescribableSchema {
  switch (node.how) {
    case 'checks':
    case 'transforms':
      return follow(io === 'input' ? node.sent : node.produced)

    // A codec runs both ways, and the wire form is what a caller sends when the conversion decodes.
    // The value is what comes out, and a document describes it wherever that value has a JSON form.
    case 'codec':
      return follow(io === 'input' ? node.wire : node.value)

    case 'unstatedOutput':
      return io === 'input'
        ? follow(node.sent)
        : new UndescribableSchema(
            node,
            'a conversion runs last and no schema states what comes out of it'
          )

    case 'unstatedInput':
      return io === 'output'
        ? follow(node.produced)
        : new UndescribableSchema(
            node,
            'a conversion runs before this, so no schema states what a caller may send'
          )

    default:
      node satisfies never
      throw new Error('a reading produced a conversion of no kind')
  }
}
