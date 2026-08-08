/**
 * A value a document can carry.
 *
 * A default, an example and a literal each reach a document as data rather than as a schema, so each
 * one has to be written in JSON. A frontend converts a vendor's value into this type, or reports
 * that the value has no JSON form. `unknown` here would move that report to whoever writes the
 * document, which is after the schema that produced the value is out of reach.
 */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue }
