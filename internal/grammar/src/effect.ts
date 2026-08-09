import { Schema, type SchemaAST } from 'effect'
import { pick, type Subject } from './draw.js'

/**
 * Schemas built from the effect constructs this library claims to describe.
 *
 * **What is in the grammar is the whole of what the property proves.** A construct left out is
 * indistinguishable from one that was forgotten, so what is absent is listed below with the reason.
 *
 * Absent on purpose:
 *
 * - `Schema.Date` and `Schema.BigInt`, which JSON has no form for, so there is no document to
 *   compare against.
 * - A transformation, which effect builds bidirectionally and which reads as a codec. What a codec
 *   accepts is one form and what it produces is another, and a single document names neither alone.
 * - A refinement over anything the reading has no case for, such as `Schema.filter` with a bare
 *   predicate. It is dropped and the document is wider, which is a missing reading rather than a
 *   target that has no word, and the report would not say which.
 * - `Schema.suspend`, which names a schema and produces a reference. The value pool holds no value
 *   nested more than two deep, so a recursive schema and its first unrolling accept the same values.
 *
 * `Schema.Int` is present and it is why the check carries definitions: effect names it, so it
 * reaches a document as a reference. Every document holding one compiled as nothing until the check
 * spelled the definitions beside the term, and the run reported agreement over the documents it
 * skipped.
 */
export function effectGrammar(next: () => number, depth: number): Subject<SchemaAST.AST> {
  const schema = schemaOf(next, depth)

  return {
    // effect reads from the AST rather than from the schema, which is a thin wrapper over one.
    schema: schema.ast,
    // Whether effect takes a value is effect's answer, asked of the type side rather than of a
    // decode: a decode runs a transformation and this grammar states none.
    accepts: Schema.is(schema)
  }
}

/**
 * Any schema of effect's, with the inferred type widened away.
 *
 * effect states the inferred type of each schema, and a recursive grammar cannot name one. This is
 * effect's own name for a schema whose type is not known and that needs nothing to run.
 */
type EffectSchema = Schema.Schema.AnyNoContext

function schemaOf(next: () => number, depth: number): EffectSchema {
  return depth <= 0 ? leaf(next) : pick(next, [leaf, leaf, structure, combination])(next, depth)
}

function leaf(next: () => number): EffectSchema {
  return pick(next, [
    () => Schema.String,
    () => Schema.String.pipe(Schema.minLength(2)),
    () => Schema.String.pipe(Schema.maxLength(3)),
    () => Schema.String.pipe(Schema.pattern(/^a/)),
    () => Schema.Number,
    () => Schema.Number.pipe(Schema.greaterThanOrEqualTo(1)),
    () => Schema.Number.pipe(Schema.lessThan(9)),
    // effect states a whole number as a type in its annotation, where zod states a flag and
    // arktype a divisor of one.
    () => Schema.Int,
    () => Schema.Number.pipe(Schema.multipleOf(2)),
    () => Schema.Boolean,
    () => Schema.Literal('a'),
    () => Schema.Literal(1),
    () => Schema.Literal('a', 'abc'),
    () => Schema.Unknown,
    () => Schema.Null
  ])()
}

function structure(next: () => number, depth: number): EffectSchema {
  const inner = () => schemaOf(next, depth - 1)

  return pick(next, [
    () => Schema.Array(inner()),
    () => Schema.Array(inner()).pipe(Schema.minItems(1)),
    () => Schema.Array(inner()).pipe(Schema.maxItems(2)),
    () => Schema.Struct({ a: inner() }),
    () => Schema.Struct({ a: inner(), b: Schema.optional(inner()) }),
    () => Schema.Record({ key: Schema.String, value: inner() }),
    () => Schema.Tuple(inner()),
    () => Schema.Tuple(inner(), inner()),
    () => Schema.Tuple([inner()], Schema.Number)
  ])()
}

function combination(next: () => number, depth: number): EffectSchema {
  const inner = () => schemaOf(next, depth - 1)

  return pick(next, [
    () => Schema.Union(inner(), inner()),
    () => Schema.NullOr(inner()),
    () =>
      Schema.Union(
        Schema.Struct({ kind: Schema.Literal('a') }),
        Schema.Struct({ kind: Schema.Literal('b'), b: Schema.Number })
      )
  ])()
}
