import type { Described, DescribedOf, DescribedProperty, DescribedRest } from './described.js'
import { beyond, type Meta, noMeta, outermost } from './meta.js'
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

/** Both sides, in a fixed order, so nothing downstream depends on which was described first. */
const SIDES: readonly Io[] = ['input', 'output']

/** A schema to describe, and the side of it this position is about. */
export interface Ask<S> {
  readonly schema: S
  readonly io: Io
}

/** One thing per side. */
type PerSide<T> = Record<Io, T>

/**
 * What a name is called on each side, where the two sides could not share one.
 *
 * **Stated by the caller, with nothing supplied here.** `Input` and `Output` are one generator's
 * convention, and this library holds no target's vocabulary anywhere else. A caller wanting
 * `NewUser` and `User`, or a prefix, or a dot, states it and nothing here has an opinion.
 *
 * One function per side rather than one taking the side. A caller cannot answer for a side it forgot
 * to think about, and two sides given one name is refused rather than written.
 */
export type SideNames = PerSide<(name: string) => string>

/**
 * What the schemas in a description are called.
 *
 * **A caller names a schema without touching it.** `nameOf` asks the validator, and a validator only
 * knows what somebody wrote into it: `.meta({ id })` on zod, `v.metadata({ id })` on valibot, a scope
 * in arktype. A caller describing schemas they did not write, or one who would rather keep a
 * document's vocabulary out of their domain code, has nowhere to put a name. Here is that place, and
 * what a caller states wins over what the validator says.
 */
export interface Naming<S> {
  readonly sides: SideNames
  readonly named?: ReadonlyMap<S, string>
}

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

interface Table<S> {
  /**
   * What each name stands for, on each side.
   *
   * Two sides of one schema are two bodies, because a conversion and a default each say different
   * things about what is sent and what comes back. They are kept apart while the walk runs and are
   * given their final names once, when every body is known.
   */
  readonly definitions: PerSide<Map<string, Described>>
  /** Names bound and not yet described. A schema meeting its own name is a cycle, and that is the point. */
  readonly binding: PerSide<Set<string>>
  /**
   * Which schema claimed each name.
   *
   * Keyed by the name alone rather than by the name and the side, because a name states one thing
   * whichever side asks for it. Two sides of one schema share a claim; two schemas do not, and that
   * is still the error it always was.
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
 * These travel together at every step, so they travel as one thing. `io` joined them and made that
 * plain: a fifth parameter threaded through six functions is the same state with more places to
 * forget it.
 */
interface Walk<S> {
  readonly source: Source<S>
  readonly io: Io
  readonly naming: Table<S>
  /**
   * A schema being described that turned out to have a name, and the name to file it under.
   *
   * A validator may name the thunk rather than the schema, so the name is found on the way down and
   * points back at something already being described. arktype does this: a recursive type is reached
   * through an alias carrying the name, and the alias resolves to the schema the walk began at.
   *
   * Per walk rather than shared, because it holds where the walk currently is. Shared, an entry left
   * by one side would file the next side's body under a name it never met.
   */
  readonly pending: Map<S, string>
  /** What a caller called each schema, which wins over what the validator says. */
  readonly named: ReadonlyMap<S, string> | undefined
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
  asks: readonly Ask<S>[],
  source: Source<S>,
  naming: Naming<S>
): Descriptions | UndescribableSchema {
  const table: Table<S> = {
    definitions: { input: new Map(), output: new Map() },
    binding: { input: new Set(), output: new Set() },
    claimedBy: new Map()
  }

  const described: { term: Described; io: Io }[] = []
  for (const ask of asks) {
    const walk: Walk<S> = {
      source,
      io: ask.io,
      naming: table,
      named: naming.named,
      pending: new Map()
    }

    const term = at(ask.schema, walk, new Set())
    if (isError(term)) {
      return term
    }
    described.push({ term, io: ask.io })
  }

  return settle(table, described, naming.sides)
}

/**
 * A name unchanged on either side.
 *
 * For one schema on one side, where no name can hold two bodies and nothing can be renamed. A split
 * needs a name described on both sides, and one ask populates one side.
 */
const oneSide: SideNames = { input: (name) => name, output: (name) => name }

/**
 * One schema, described.
 *
 * **This owns its walk rather than folding through `foldSource`.** Naming, the definitions table and
 * what to do about a cycle are one decision, and the generic walk knows about none of them: its
 * cases receive a node and cannot tell which schema produced one, so a name could not be bound where
 * it has to be bound.
 */
export function describe<S>(schema: S, source: Source<S>, io: Io): Describing {
  const described = describeAll([{ schema, io }], source, { sides: oneSide })
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
  const { source, naming, io } = walk
  const name = walk.named?.get(schema) ?? source.nameOf(schema)

  if (name === undefined) {
    return body(schema, walk, ancestors)
  }

  const claimed = naming.claimedBy.get(name)
  if (claimed !== undefined) {
    if (!isSameSchema(claimed, schema, source)) {
      return sameThing(name, schema, walk, ancestors)
    }

    // The same schema, met again on a side that already holds it or is describing it now.
    if (naming.definitions[io].has(name) || naming.binding[io].has(name)) {
      return { kind: 'ref', name, admitsNull: false, meta: noMeta }
    }

    // The same schema, met for the first time on this side. Its other side is described and this one
    // is not, so this one is described too and the two are compared when the names are settled.
  }

  // The name points back at something already being described, so the name belongs to that and the
  // walk has simply met it from below. It is filed under this name when it finishes.
  const target = resolved(schema, source)
  if (target !== undefined && ancestors.has(target)) {
    walk.pending.set(target, name)
    return { kind: 'ref', name, admitsNull: false, meta: noMeta }
  }

  naming.binding[io].add(name)
  naming.claimedBy.set(name, schema)
  const described = body(schema, walk, ancestors)
  naming.binding[io].delete(name)

  if (isError(described)) {
    return described
  }

  naming.definitions[io].set(name, described)
  return { kind: 'ref', name, admitsNull: false, meta: noMeta }
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
  // Whichever side already holds it. A schema written twice may be met from either.
  const already =
    walk.naming.definitions[walk.io].get(name) ?? walk.naming.definitions[other(walk.io)].get(name)

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

  // Compared without what each says about itself, because a description is not a shape. A caller
  // naming one schema twice and describing one of the two uses states one shape and two sentences,
  // and refusing that would leave them no way to describe a use of a shared type at all.
  if (canonical(bare(already)) === canonical(bare(second))) {
    return { kind: 'ref', name, admitsNull: false, meta: beyond(second.meta, already.meta) }
  }

  return new UndescribableSchema(
    schema,
    `two different schemas are named ${name}. A document states one shape under a name, so the second would be written as the first. Give one of them another name`
  )
}

/** A term with what it says about itself set aside, so two shapes can be compared as shapes. */
function bare(term: Described): Described {
  return { ...term, meta: noMeta }
}

/** The other side. */
function other(io: Io): Io {
  return io === 'input' ? 'output' : 'input'
}

/**
 * The names, once every body is known.
 *
 * **A name is one name where both sides say the same thing, and two where they do not.** A schema
 * with no conversion and no default under it describes identically on both sides, which is the
 * common case, and a document naming that shape twice would say the same thing twice.
 *
 * Settled here rather than as the walk runs, because whether the sides differ is not known until
 * both are described. Nothing depends on which side was asked for first.
 */
function settle<S>(
  naming: Table<S>,
  described: readonly { readonly term: Described; readonly io: Io }[],
  names: SideNames
): Descriptions | UndescribableSchema {
  const stated = new Set([...naming.definitions.input.keys(), ...naming.definitions.output.keys()])
  const split = splitting(naming.definitions, stated)

  const named = (name: string, io: Io): string => (split.has(name) ? names[io](name) : name)

  const definitions = new Map<string, Described>()
  for (const io of SIDES) {
    for (const [name, term] of naming.definitions[io]) {
      const final = named(name, io)
      const written = mapRefs(term, (to) => named(to, io))

      // One check for every way two definitions land on one name: a name a caller gave to both
      // sides, a name two schemas derived to, and a derived name a third schema already had. A name
      // that did not split writes one body twice, which is the case this must not refuse.
      const already = definitions.get(final)
      if (already !== undefined && canonical(already) !== canonical(written)) {
        return new UndescribableSchema(
          name,
          `two definitions are both called ${final}, and a name states one shape. Give the sides of ${name} names that differ, or rename the schema already called ${final}`
        )
      }

      definitions.set(final, written)
    }
  }

  return {
    terms: described.map(({ term, io }) => mapRefs(term, (to) => named(to, io))),
    definitions
  }
}

/**
 * The names whose two sides cannot be one definition.
 *
 * Two reasons, and the second is why this is a closure rather than a comparison. A name splits where
 * its bodies differ. A name also splits where its bodies agree and both refer to a name that split:
 * the two are alike only until the reference is written, and then one says `AddressInput` and the
 * other `AddressOutput`.
 *
 * Only a name described on both sides can split. One described on a single side has one body, and
 * its references are written for the side it was described on.
 */
function splitting(
  definitions: PerSide<Map<string, Described>>,
  names: ReadonlySet<string>
): ReadonlySet<string> {
  const bothSides = [...names].filter(
    (name) => definitions.input.has(name) && definitions.output.has(name)
  )
  const split = new Set<string>()

  for (const name of bothSides) {
    const input = definitions.input.get(name)
    const output = definitions.output.get(name)
    if (input !== undefined && output !== undefined && canonical(input) !== canonical(output)) {
      split.add(name)
    }
  }

  for (let growing = true; growing; ) {
    growing = false
    for (const name of bothSides) {
      const body = definitions.input.get(name)
      if (split.has(name) || body === undefined) {
        continue
      }
      if ([...refsIn(body)].some((to) => split.has(to))) {
        split.add(name)
        growing = true
      }
    }
  }

  return split
}

/** Every name a term refers to. */
export function refsIn(term: Described): ReadonlySet<string> {
  const seen = new Set<string>()
  mapRefs(term, (name) => {
    seen.add(name)
    return name
  })
  return seen
}

/**
 * A term with every name it refers to rewritten.
 *
 * One total function over the term, so a case added to the term is a compile error here. A name is
 * settled after the body that carries it was described, and nothing else in this file rewrites a
 * term, so this is the whole of what a rename touches.
 */
function mapRefs(term: Described, rename: (name: string) => string): Described {
  switch (term.kind) {
    case 'ref':
      return { ...term, name: rename(term.name) }
    case 'typed':
      return typedRefs(term, rename)
    case 'some':
    case 'exactlyOne':
    case 'every':
      return { ...term, members: memberRefs(term.members, rename) }
    case 'tuple':
      return {
        ...term,
        positions: term.positions.map((position) => mapRefs(position, rename)),
        rest: restRefs(term.rest, rename)
      }
    case 'values':
    case 'untyped':
      return term
    default:
      term satisfies never
      throw new Error('a term of no case reached the naming')
  }
}

function typedRefs(term: DescribedOf<'typed'>, rename: (name: string) => string): Described {
  if (term.name === 'object') {
    const properties = new Map<string, DescribedProperty>()
    for (const [key, property] of term.assertions.properties) {
      properties.set(key, { ...property, term: mapRefs(property.term, rename) })
    }

    return {
      ...term,
      assertions: { properties, rest: restRefs(term.assertions.rest, rename) }
    }
  }

  if (term.name === 'array') {
    return {
      ...term,
      assertions: { ...term.assertions, items: mapRefs(term.assertions.items, rename) }
    }
  }

  return term
}

function memberRefs(
  members: readonly [Described, Described, ...Described[]],
  rename: (name: string) => string
): readonly [Described, Described, ...Described[]] {
  const [first, second, ...rest] = members
  return [
    mapRefs(first, rename),
    mapRefs(second, rename),
    ...rest.map((member) => mapRefs(member, rename))
  ]
}

function restRefs(rest: DescribedRest, rename: (name: string) => string): DescribedRest {
  return rest.allows === 'term' ? { allows: 'term', term: mapRefs(rest.term, rename) } : rest
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

  // What the schema says about itself, gathered along the way rather than read at the end.
  //
  // A wrapper is a schema of its own and carries its own words, and the term beneath it is what the
  // wrapper describes: `z.string().optional().describe('D')` states `D` about the string. So the
  // statement has to be taken where it was written, before the case that drops the wrapper runs.
  // The outer one wins, because it is the later word about the same value.
  let stated: Meta = noMeta

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
    stated = outermost(stated, source.metaOf(current))

    if (read.kind !== 'deferred') {
      const described_ = described(read, walk, path)
      if (isError(described_)) {
        return described_
      }

      const term: Described = { ...described_, meta: outermost(stated, described_.meta) }

      // Something below named this while it was being described, so it is filed under that name and
      // what stands here is a reference to it.
      const name = walk.pending.get(entered) ?? walk.pending.get(current)
      if (name === undefined) {
        return term
      }

      naming.definitions[walk.io].set(name, term)
      return { kind: 'ref', name, admitsNull: false, meta: noMeta }
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
      return { kind: 'values', admitted: node.admitted, admitsNull: false, meta: noMeta }
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
      return {
        kind: 'typed',
        name: 'string',
        assertions: node.assertions,
        admitsNull: false,
        meta: noMeta
      }
    case 'number':
      return {
        kind: 'typed',
        name: 'number',
        assertions: node.assertions,
        admitsNull: false,
        meta: noMeta
      }
    case 'boolean':
      return { kind: 'typed', name: 'boolean', assertions: {}, admitsNull: false, meta: noMeta }
    case 'unknown':
      return { kind: 'untyped', admitsNull: false, meta: noMeta }

    // Null is a value rather than a type, so a schema admitting only null admits one value.
    case 'null':
      return { kind: 'values', admitted: [{ of: 'null' }], admitsNull: true, meta: noMeta }

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
            admitsNull: false,
            meta: noMeta
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
              ...(node.assertions.maxItems !== undefined && { maxItems: node.assertions.maxItems }),
              ...(node.assertions.unique !== undefined && { unique: node.assertions.unique })
            },
            admitsNull: false,
            meta: noMeta
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
      return isError(rest)
        ? rest
        : { kind: 'tuple', positions, rest, admitsNull: false, meta: noMeta }
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
            admitsNull: false,
            meta: noMeta
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
    return { kind: 'values', admitted: [{ of: 'null' }], admitsNull: true, meta: noMeta }
  }

  // One member is left after the null members were taken out, so there is nothing to choose between.
  if (second === undefined) {
    return { ...first, admitsNull }
  }

  const members: readonly [Described, Described, ...Described[]] = [first, second, ...rest]

  switch (node.law) {
    case 'any':
      return { kind: 'some', members, admitsNull, meta: noMeta }
    case 'exactlyOne':
      return {
        kind: 'exactlyOne',
        members,
        discriminant: node.discriminant,
        admitsNull,
        meta: noMeta
      }
    case 'all':
      return { kind: 'every', members, admitsNull, meta: noMeta }
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

    // A codec is the one conversion whose side the direction does not choose, and this is forced
    // rather than preferred. A codec encodes back to its wire form on the way out, so the wire form
    // is what travels in both directions and the value is an in-memory type that never does. A
    // document describes what is on the wire, so `value` reaches no document at all.
    case 'codec':
      return follow(node.wire)

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
