/**
 * Arri Type Definition, as the specification defines it.
 *
 * Eight forms, and what is absent matters as much as what is present. ATD is a modified JSON Type
 * Definition, and it states a shape and nothing about the values in it: there is no `minLength`, no
 * `minimum`, no `pattern`, and no keyword for any of them to be written under. It also has no
 * general disjunction, no intersection and no positional form.
 *
 * That is why this is the first target. A specification that can say everything reports nothing
 * about whether a term is neutral, and one that refuses this much reports a great deal.
 */

/** The scalar types ATD names. A width is chosen from the bounds a term states. */
export type AtdType =
  | 'boolean'
  | 'string'
  | 'timestamp'
  | 'float32'
  | 'float64'
  | 'int8'
  | 'uint8'
  | 'int16'
  | 'uint16'
  | 'int32'
  | 'uint32'
  | 'int64'
  | 'uint64'

/** What a form may say about itself, which is a name and a note and nothing else. */
export interface AtdMetadata {
  readonly id?: string
  readonly description?: string
  readonly isDeprecated?: boolean
}

/** Common to every form. Nullability is a flag here, on any form. */
interface AtdCommon {
  readonly isNullable?: boolean
  readonly metadata?: AtdMetadata
}

/** The empty form. Any value at all. */
export interface AtdEmpty extends AtdCommon {}

/** The type form. One named scalar. */
export interface AtdTypeForm extends AtdCommon {
  readonly type: AtdType
}

/** The enum form. Strings only, which is the constraint that refuses the most. */
export interface AtdEnum extends AtdCommon {
  readonly enum: readonly [string, ...string[]]
}

/** The elements form. A list of one type. */
export interface AtdElements extends AtdCommon {
  readonly elements: AtdSchema
}

/** The properties form. Optionality is a separate object, which is the edge. */
export interface AtdProperties extends AtdCommon {
  readonly properties?: Readonly<Record<string, AtdSchema>>
  readonly optionalProperties?: Readonly<Record<string, AtdSchema>>
  /** Refuse a key the form does not name. Absent means an unnamed key is ignored. */
  readonly isStrict?: boolean
}

/** The values form. A record whose values share one schema. */
export interface AtdValues extends AtdCommon {
  readonly values: AtdSchema
}

/** The discriminator form. The only disjunction ATD has, and only over properties forms. */
export interface AtdDiscriminator extends AtdCommon {
  readonly discriminator: string
  readonly mapping: Readonly<Record<string, AtdProperties>>
}

/** The ref form. A name, resolved against a definition carrying the same id. */
export interface AtdRef extends AtdCommon {
  readonly ref: string
}

export type AtdSchema =
  | AtdEmpty
  | AtdTypeForm
  | AtdEnum
  | AtdElements
  | AtdProperties
  | AtdValues
  | AtdDiscriminator
  | AtdRef
