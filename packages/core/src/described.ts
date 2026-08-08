import type { JsonValue } from './json.js'
import type { AdmittedValue, Bound, StringFormat } from './node.js'

/**
 * What is true of a schema, in no target's words.
 *
 * The term between the two trees. A reading says what a validator wrote; this says what is true of
 * the value, and only a target chooses how to write it. Nothing here names a keyword of any
 * specification, which is what lets one target spell it as JSON Schema and another as something that
 * cannot say half of it.
 *
 * This file imports nothing but the vocabulary a reading already used, and depends on no target.
 */

/**
 * The types a document can name.
 *
 * No `null` and no `integer`. Null is a value rather than a type, so it belongs among the values a
 * term admits. A whole number is a number that is whole, which is an assertion about the value:
 * JSON Schema calls it `integer`, ATD calls it `int32` and picks the width from the bounds, and a
 * term that chose either would be holding a target's word.
 */
export type DescribedTypeName = 'string' | 'number' | 'boolean' | 'object' | 'array'

/** One property of an object, and what the object says about the key rather than the value. */
export interface DescribedProperty {
  readonly term: Described
  readonly required: boolean
  readonly default: JsonValue | undefined
}

/** What an object admits at a key it does not name. */
export type DescribedRest =
  | { readonly allows: 'anything' }
  | { readonly allows: 'nothing' }
  | { readonly allows: 'term'; readonly term: Described }

/**
 * What each type can be asserted about, indexed by the type it belongs to.
 *
 * Indexed rather than gathered into one bag. A bag types nothing: a string carrying `multipleOf`
 * compiles, and a target writes it into a document that no reader will refuse and every reader will
 * misread.
 */
interface AssertionsByTypeName {
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
    /** Whole numbers only. A target names the width from the bounds beside this. */
    readonly integer?: boolean
  }
  readonly boolean: Record<string, never>
  readonly object: {
    readonly properties: ReadonlyMap<string, DescribedProperty>
    readonly rest: DescribedRest
  }
  readonly array: {
    readonly items: Described
    readonly minItems?: number
    readonly maxItems?: number
  }
}

/**
 * The cases, as a keyed map.
 *
 * Keyed rather than a list of arms, so two arms carrying one tag is a syntax error rather than a
 * type that compiles and admits both. The tag is supplied from the key, so a case carrying a tag
 * that disagrees with where it sits cannot be written.
 */
interface DescribedCases {
  /**
   * A value of one stated type.
   *
   * Distributed over the type name, so the assertions a case may carry are the ones its own type
   * admits and no others.
   */
  readonly typed: {
    [Name in DescribedTypeName]: {
      readonly name: Name
      readonly assertions: AssertionsByTypeName[Name]
    }
  }[DescribedTypeName]

  /** A fixed set of admitted values. The type of each value travels with the value. */
  readonly values: { readonly admitted: readonly [AdmittedValue, ...AdmittedValue[]] }

  /** Any of these. */
  readonly some: { readonly members: readonly [Described, Described, ...Described[]] }

  /**
   * Exactly one of these.
   *
   * A discriminant where the source stated one. It rides here and on no other combination, because
   * this is the only one whose members exclude each other, and a reader choosing by a tag is
   * choosing among things only one of which can match.
   */
  readonly exactlyOne: {
    readonly members: readonly [Described, Described, ...Described[]]
    readonly discriminant: string | undefined
  }

  /** All of these at once. */
  readonly every: { readonly members: readonly [Described, Described, ...Described[]] }

  /** Values at positions, which is a different thing from a list of one type. */
  readonly tuple: {
    readonly positions: readonly Described[]
    readonly rest: DescribedRest
  }

  /** Nothing is stated about the value. */
  readonly untyped: NoPayload
}

/**
 * A case whose name is the whole of what it says.
 *
 * `Record<string, never>` cannot be used here. It refuses every key, and each case is intersected
 * with its tag, so the tag itself would have to be `never`.
 */
type NoPayload = Record<never, never>

/** The name of a case. */
export type DescribedKind = keyof DescribedCases

/**
 * A schema, described.
 *
 * **Every case carries whether the value may be null**, because whether null is admitted is a fact
 * about the value and not a way of writing one. Four validators state it four ways: zod wraps,
 * arktype and effect put it in a union, and a target may want a flag beside a type, a member of a
 * type list, or a keyword of its own. A term that chose any of those would have chosen for the
 * target.
 */
export type Described = {
  [K in DescribedKind]: {
    readonly kind: K
    readonly admitsNull: boolean
  } & DescribedCases[K]
}[DescribedKind]

/** One case of the term, selected by name. */
export type DescribedOf<K extends DescribedKind> = Extract<Described, { readonly kind: K }>

/**
 * One answer per case.
 *
 * A target is one total function over this. A case added here is one compile error per target, and
 * each error names the target that has to answer.
 */
export type SpellsDescribed<Written> = {
  readonly [K in DescribedKind]: (term: DescribedOf<K>) => Written
}
