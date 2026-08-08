/**
 * What DynamoDB carries, and what a description of it says.
 *
 * **An AttributeValue is a coproduct whose tag is the key.** `{ S: 'abc' }` is a tagged value and
 * `S` is the tag, where a term writes the tag beside the payload. So the two are the same shape and
 * this file writes it the same way the term does: a keyed map of the cases, indexed to a union. A
 * duplicate key is a syntax error, and a case cannot carry a tag from another case.
 *
 * **A value and a description of one are two different laws over the same members.** A value is
 * exactly one member, and DynamoDB refuses one carrying two. A description states which members a
 * schema admits, and a nullable string admits two. Both laws are written here, because writing one
 * and using it for both is how a description that says `S` or `NULL` becomes a value that claims to
 * be both at once.
 */

/**
 * A case whose name is the whole of what it says.
 *
 * `Record<string, never>` cannot be used here. It refuses every key, and each case is intersected
 * with the others being absent, so the case itself would have to be `never`.
 */
type NoPayload = Record<never, never>

/**
 * Exactly one of the members, and the others shut out.
 *
 * The `never` on every other key is what makes this exact. A mapped type over one key says nothing
 * about the rest, and an object type is open, so `{ S: 'a', N: '1' }` satisfies a bare `{ S: string }`
 * and reaches a service that refuses it. Excess property checking does not see it either: each key is
 * known to some member of the union.
 */
export type ExactlyOne<T> = {
  [K in keyof T]-?: { readonly [key in K]-?: T[key] } & {
    readonly [other in Exclude<keyof T, K>]?: never
  }
}[keyof T]

/**
 * At least one of the members, with every other one optional and still typed.
 *
 * `Partial<T>` is what the other keys are held to. Without it a second key is unchecked rather than
 * absent, which is the same hole as above wearing the other law's name.
 */
export type AtLeastOne<T> = {
  [K in keyof T]-?: Partial<T> & { readonly [key in K]-?: T[key] }
}[keyof T]

/** The members of an AttributeValue, and what a value carries under each. */
interface AttributeCarries {
  readonly S: string
  readonly N: string
  readonly B: Uint8Array
  readonly SS: readonly string[]
  readonly NS: readonly string[]
  readonly BS: readonly Uint8Array[]
  readonly M: { readonly [name: string]: AttributeValue }
  readonly L: readonly AttributeValue[]
  readonly BOOL: boolean
  readonly NULL: boolean
}

/** The name of a member. */
export type AttributeName = keyof AttributeCarries

/** One value, which is exactly one member. */
export type AttributeValue = ExactlyOne<AttributeCarries>

/** What a description states under each member. */
interface AttributeStates {
  readonly S: NoPayload
  readonly N: NoPayload
  readonly B: NoPayload
  readonly SS: NoPayload
  readonly NS: NoPayload
  readonly BS: NoPayload
  readonly M: MapShape
  readonly L: ListShape
  readonly BOOL: NoPayload
  readonly NULL: NoPayload
}

/**
 * The members a schema admits, which is at least one.
 *
 * A scalar admits one. A nullable admits two. A disjunction admits as many as its members land on.
 */
export type AttributeShape = AtLeastOne<AttributeStates>

/**
 * A map, and what it states at each name.
 *
 * Whether a name must be present is stated here rather than under the shape at it. DynamoDB has an
 * attribute or has none, and `{ NULL: true }` is a value it has, so the two questions the term keeps
 * apart stay apart: a name that may be absent is not a name whose value may be null.
 */
export interface MapShape {
  readonly attributes: ReadonlyMap<string, MapEntry>
  readonly rest: RestShape
}

export interface MapEntry {
  readonly shape: AttributeShape
  readonly required: boolean
}

/** What a map admits at a name it does not state. */
export type RestShape =
  | { readonly allows: 'anything' }
  | { readonly allows: 'nothing' }
  | { readonly allows: 'shape'; readonly shape: AttributeShape }

export interface ListShape {
  readonly items: AttributeShape
}

/** Every member, which is what a schema stating nothing admits. */
export const anyAttribute: AttributeShape = {
  S: {},
  N: {},
  B: {},
  SS: {},
  NS: {},
  BS: {},
  BOOL: {},
  NULL: {},
  M: { attributes: new Map(), rest: { allows: 'anything' } },
  L: { items: { S: {}, N: {}, B: {}, BOOL: {}, NULL: {} } }
}
