import type { JsonValue } from './json.js'
import { FasciaError, isError } from './result.js'

/**
 * What any validator's schema is, once read.
 *
 * A frontend supplies a total function from its own schema into this sum. Everything downstream is
 * an algebra over the sum, so a second source library is a reading rather than a second describer.
 *
 * A case holds its children as `S`, the vendor's own schema type, and no case recurses. The walk
 * stays with whoever folds, which is what lets one reading serve a caller that descends and a caller
 * that reads a single node.
 */

/** The primitives a validator can assert about, before any assertion is read. */
export type ScalarName = 'string' | 'number' | 'boolean' | 'bigint' | 'date' | 'null' | 'unknown'

/**
 * A bound, and whether the bound itself is admitted.
 *
 * One slot per side. Two bounds on one side is the schema saying one thing twice, and a frontend
 * that reads several checks reports the strictest rather than passing both on.
 */
export interface Bound<T> {
  readonly value: T
  readonly exclusive: boolean
}

/** The string formats a document has a name for. A format a target lacks is the target's to drop. */
export type StringFormat =
  | 'email'
  | 'uri'
  | 'uuid'
  | 'hostname'
  | 'ipv4'
  | 'ipv6'
  | 'date'
  | 'time'
  | 'date-time'
  | 'duration'

/**
 * What each scalar can be asserted about, indexed by the scalar it belongs to.
 *
 * Indexed rather than merged into one bag. A bag types nothing: a string carrying `multipleOf`
 * compiles, and the wrongness is found by whoever reads the document rather than by the compiler.
 */
interface AssertionsByScalar {
  readonly string: {
    readonly minLength?: number
    readonly maxLength?: number
    /** Every pattern holds at once. A list, because conjoining them is a target's decision. */
    readonly patterns?: readonly string[]
    readonly format?: StringFormat
  }
  readonly number: {
    readonly minimum?: Bound<number>
    readonly maximum?: Bound<number>
    readonly multipleOf?: number
    readonly integer?: boolean
  }
  readonly bigint: {
    readonly minimum?: Bound<bigint>
    readonly maximum?: Bound<bigint>
  }
  readonly date: {
    readonly minimum?: Bound<Date>
    readonly maximum?: Bound<Date>
  }
  readonly boolean: Record<string, never>
  readonly null: Record<string, never>
  readonly unknown: Record<string, never>
}

/** A scalar, carrying only the assertions its own name admits. */
export type Scalar = {
  [N in ScalarName]: { readonly name: N; readonly assertions: AssertionsByScalar[N] }
}[ScalarName]

/**
 * One value a schema admits, tagged with the type of the value.
 *
 * Tagged rather than a bare union of primitives, because a set may mix types and the type of each
 * value has to survive the mixing. A list of bare values loses which value belongs to which type,
 * and a reader that recovers it is guessing.
 */
export type AdmittedValue =
  | { readonly of: 'string'; readonly value: string }
  | { readonly of: 'number'; readonly value: number }
  | { readonly of: 'boolean'; readonly value: boolean }
  | { readonly of: 'bigint'; readonly value: bigint }
  | { readonly of: 'null' }

/**
 * What a wrapper does to the schema the wrapper holds.
 *
 * Each arm carries what that arm needs. A shared payload would give `optional` a value field that
 * nothing fills and `default` a value field that may be absent.
 */
export type Wrapping<S> =
  | { readonly how: 'optional'; readonly inner: S }
  | { readonly how: 'nullable'; readonly inner: S }
  | { readonly how: 'nonoptional'; readonly inner: S }
  /** Freezes what a parse returns. Admits what the inner schema admits, so a document says nothing. */
  | { readonly how: 'readonly'; readonly inner: S }
  | { readonly how: 'default'; readonly inner: S; readonly value: JsonValue }
  /** Replaces a failed parse. A caller may still send only what the inner schema admits. */
  | { readonly how: 'catch'; readonly inner: S }

/**
 * What a structure accepts beyond the children the structure names.
 *
 * One shape for an object and for a tuple. Two shapes for one question let the two disagree, and a
 * reader of the second has to learn that `undefined` there means what `nothing` means here.
 */
export type Rest<S> =
  | { readonly allows: 'anything' }
  | { readonly allows: 'nothing' }
  | { readonly allows: 'schema'; readonly schema: S }

/**
 * Children at keys or at positions.
 *
 * One group rather than four, because an algebra that does not read structure answers all four with
 * one case. An algebra that does read structure dispatches on `of`, which is a keyed sum of its own.
 */
/**
 * One property of an object, and what the object says about the key rather than about the value.
 *
 * Whether a key may be absent, and what stands in when the key is absent, belong here and not to the
 * schema at the key. A validator may state either on the edge and hold no schema that means
 * "optional number", so a reading of one has nothing to point a wrapper at.
 *
 * A frontend whose validator states them on the value lifts them to here, and points `schema` at
 * what is left. So the question is asked once, in one place, whichever validator was read.
 */
export interface ObjectProperty<S> {
  readonly schema: S
  readonly required: boolean
  readonly default: JsonValue | undefined
}

export type Structure<S> =
  | {
      readonly of: 'object'
      /** A map, so a key that collides with a prototype member is a key like any other. */
      readonly properties: ReadonlyMap<string, ObjectProperty<S>>
      readonly rest: Rest<S>
    }
  | {
      readonly of: 'tuple'
      readonly positions: readonly S[]
      readonly rest: Rest<S>
    }
  | {
      readonly of: 'list'
      readonly items: S
      /** Named `assertions` because a scalar's are named that. One word for one thing. */
      readonly assertions: {
        readonly minItems?: number
        readonly maxItems?: number
        readonly unique?: boolean
      }
    }
  | {
      readonly of: 'dictionary'
      readonly keys: S
      readonly values: S
    }

/** The law a combination holds its members under. */
export type CombinationLaw = 'any' | 'all' | 'exactlyOne'

/**
 * Several schemas under one law.
 *
 * Two members at least. A combination of one is the member, and a frontend that produces one has
 * read a wrapper as a combination.
 */
export interface Combination<S> {
  readonly law: CombinationLaw
  readonly members: readonly [S, S, ...S[]]
  /** The property every member states a different value of, where the source library declares one. */
  readonly discriminant: string | undefined
}

/**
 * Two schemas, where what a caller sends and what the program receives may differ.
 *
 * Three cases rather than two flags. Two booleans admit four states and only three exist, and the
 * fourth compiles.
 */
export type Conversion<S> =
  /** Nothing between the sides changes the value, so both sides describe one value. */
  | { readonly how: 'checks'; readonly sent: S; readonly produced: S }
  /** One direction, and both sides are schemas. */
  | { readonly how: 'transforms'; readonly sent: S; readonly produced: S }
  /**
   * One direction, and the conversion runs first, so no schema states what a caller may send.
   *
   * A case rather than an absent `sent` field. An optional field says the same thing and lets a
   * reader treat a missing side as an oversight.
   */
  | { readonly how: 'unstatedInput'; readonly produced: S }
  /**
   * One direction, and the conversion runs last, so no schema states what comes out.
   *
   * The mirror of the case above, and both exist because a validator writes both. A conversion
   * standing at either end of a chain leaves that end with nothing to describe.
   */
  | { readonly how: 'unstatedOutput'; readonly sent: S }
  /**
   * Both directions. The wire form travels whichever way the conversion runs, so `value` is an
   * in-memory type that no document describes.
   */
  | { readonly how: 'codec'; readonly wire: S; readonly value: S }

/** A schema reached through a thunk, which is how a source library writes a cycle. */
export interface Deferred<S> {
  readonly resolve: () => S
}

/**
 * The groups, as a keyed map.
 *
 * Keyed rather than a list of arms. A list cannot see a repeated tag, and two arms carrying one tag
 * compile and widen. A duplicate key is a syntax error.
 */
interface NodeCases<S> {
  readonly scalar: Scalar
  readonly values: { readonly admitted: readonly [AdmittedValue, ...AdmittedValue[]] }
  readonly wrapper: Wrapping<S>
  readonly structural: Structure<S>
  readonly combination: Combination<S>
  readonly conversion: Conversion<S>
  readonly deferred: Deferred<S>
}

/** The name of a group. */
export type NodeKind = keyof NodeCases<unknown>

/** A schema, read. The tag comes from the key, so a case cannot carry a tag from another case. */
export type Node<S> = {
  [K in NodeKind]: { readonly kind: K } & NodeCases<S>[K]
}[NodeKind]

/** One group of `Node`, selected by name. */
export type NodeOf<S, K extends NodeKind> = Extract<Node<S>, { readonly kind: K }>

/**
 * A schema this library has no reading for.
 *
 * Every validator states things a document cannot carry: a symbol, a promise, a function, a value
 * admitted by a predicate the library cannot see. A reading says so rather than inventing a node.
 */
export class UnreadableSchema extends FasciaError<{ schema: unknown }> {
  constructor(schema: unknown, reason: string) {
    super(`this schema has no reading: ${reason}`, { schema })
  }
}

/**
 * A source library's schema, read.
 *
 * The one thing a frontend owes everything downstream. The reading may fail, and a failure is a
 * value: a total reading would leave a frontend the choice of throwing or of inventing a node, and
 * the invented node reaches a document as a statement nobody made.
 */
export interface Source<S> {
  readonly read: (schema: S) => Node<S> | UnreadableSchema

  /**
   * What this schema is called, where the source library knows.
   *
   * A name is what lets a schema that holds itself be written down: the name is bound before the
   * body is described, so meeting the schema again yields a reference. Without one there is nothing
   * to bind, and a cycle cannot be described at all.
   *
   * Every validator keeps this somewhere, and each keeps it somewhere different. Stated as a member
   * every source must answer, so a frontend added later is a compile error asking what it names.
   */
  readonly nameOf: (schema: S) => string | undefined
}

/**
 * Where the walk stopped with no shape to answer about.
 *
 * A second sum rather than two more groups of `Node`, because the producer differs. A frontend
 * produces a node, and the walk produces a halt. Put `revisited` among the groups and a reading can
 * return one, which is a reading claiming the walk has been somewhere.
 *
 * Keyed like the groups are, so a halt added here is one compile error per algebra and one at the
 * dispatch below, each naming the halt.
 */
interface HaltCases<S> {
  /** The source has no reading for this schema. The reading says so and the walk relays it. */
  readonly unreadable: { readonly error: UnreadableSchema }
  /** This schema is one of its own ancestors, so descending again would not end. */
  readonly revisited: { readonly schema: S }
}

/** The name of a halt. */
export type HaltKind = keyof HaltCases<unknown>

/** A position the walk stopped at. */
export type Halt<S> = {
  [K in HaltKind]: { readonly halted: K } & HaltCases<S>[K]
}[HaltKind]

/** One halt, selected by name. */
export type HaltOf<S, K extends HaltKind> = Extract<Halt<S>, { readonly halted: K }>

/**
 * The two sums name nothing in common, which is what makes the algebra their coproduct.
 *
 * A name in both would intersect two call signatures onto one key, and an algebra could satisfy the
 * key by answering either. Nothing else reports that, because the intersection is well formed.
 */
const _kindsAreDisjoint: [Extract<NodeKind, HaltKind>] extends [never]
  ? true
  : { 'a name is both a group and a halt': Extract<NodeKind, HaltKind> } = true
void _kindsAreDisjoint

/**
 * One answer per group.
 *
 * A case receives the node and `follow`, the recursive call itself, rather than children that are
 * already reduced. So a case can decline to descend, which three of the answers this library needs
 * do, and which a case handed reduced children cannot express.
 *
 * A group added here is one compile error per algebra, and each error names the algebra that has to
 * answer.
 */
export type NodeFold<S, T> = {
  readonly [K in NodeKind]: (node: NodeOf<S, K>, follow: (child: S) => T) => T
} & {
  /**
   * A halt receives no `follow`, so descending past one is unrepresentable rather than discouraged.
   * A caller that names components binds a reference at a revisit. A caller that names nothing
   * raises there.
   */
  readonly [K in HaltKind]: (halt: HaltOf<S, K>) => T
}

/**
 * The walk, given a reading and an answer.
 *
 * The `switch` is what makes the dispatch total. Indexing the algebra by `node.kind` reads as the
 * same thing and is not checked: the compiler cannot correlate the handler it selects with the node
 * it holds, so every handler receives every node.
 *
 * **Totality is an answer per group, not an end to the walk.** A schema reached through a thunk can
 * hold itself, and an algebra that descends into one runs forever. The ancestors of the schema in
 * hand are what end it, and they are the walk's rather than the algebra's: an algebra that forgot
 * would be one silent hang per answer.
 */
export function foldSource<S, T>(schema: S, source: Source<S>, algebra: NodeFold<S, T>): T {
  return walk(schema, source, algebra, new Set<S>())
}

function walk<S, T>(
  schema: S,
  source: Source<S>,
  algebra: NodeFold<S, T>,
  ancestors: ReadonlySet<S>
): T {
  // The path to this schema, not every schema seen. One schema reached down two branches is a shared
  // component and not a cycle, and a set of everything seen reads the second branch as the first.
  if (ancestors.has(schema)) {
    return halted(algebra, { halted: 'revisited', schema })
  }

  const node = source.read(schema)
  if (isError(node)) {
    return halted(algebra, { halted: 'unreadable', error: node })
  }

  const path = new Set(ancestors).add(schema)
  const follow = (child: S): T => walk(child, source, algebra, path)

  switch (node.kind) {
    case 'scalar':
      return algebra.scalar(node, follow)
    case 'values':
      return algebra.values(node, follow)
    case 'wrapper':
      return algebra.wrapper(node, follow)
    case 'structural':
      return algebra.structural(node, follow)
    case 'combination':
      return algebra.combination(node, follow)
    case 'conversion':
      return algebra.conversion(node, follow)
    case 'deferred':
      return algebra.deferred(node, follow)
    default:
      node satisfies never
      throw new Error(`a reading produced a node of no group: ${JSON.stringify(node)}`)
  }
}

/** The dispatch over the second sum, so a halt added to `HaltCases` is a compile error here. */
function halted<S, T>(algebra: NodeFold<S, T>, at: Halt<S>): T {
  switch (at.halted) {
    case 'unreadable':
      return algebra.unreadable(at)
    case 'revisited':
      return algebra.revisited(at)
    default:
      at satisfies never
      throw new Error(`the walk halted for no stated reason: ${JSON.stringify(at)}`)
  }
}
