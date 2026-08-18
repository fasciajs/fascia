import * as v from 'valibot'
import { pick, type Subject } from './draw.js'

/**
 * Schemas built from the valibot constructs this library claims to describe.
 *
 * **What is in the grammar is the whole of what the property proves.** A construct left out is
 * indistinguishable from one that was forgotten, so what is absent is listed below with the reason.
 *
 * Absent on purpose:
 *
 * - `v.date()` and `v.bigint()`, which JSON has no form for.
 * - A transformation, whose far side no schema states.
 * - `v.record`, which accepts an array: valibot asks whether a value is an object and JavaScript
 *   says an array is one. A document has no word for a domain holding both, so every document from
 *   one refuses a value valibot takes. arktype's index signature does the same, and the spec beside
 *   the JSON Schema property states that one.
 * - `v.lazy`, which needs a name and produces a reference. The value pool holds no value nested more
 *   than two deep, so a recursive schema and its first unrolling accept the same values in it.
 */
export function valibotGrammar(next: () => number, depth: number): Subject<VSchema> {
  const schema = schemaOf(next, depth)

  return {
    schema: schema as unknown as VSchema,
    // Whether valibot takes a value is valibot's answer.
    accepts: (value) => v.safeParse(schema, value).success
  }
}

/** What the reader is given, without naming valibot's own type here. */
type VSchema = { readonly kind: 'schema'; readonly type: string }

type Any = v.GenericSchema

function schemaOf(next: () => number, depth: number): Any {
  return depth <= 0 ? leaf(next) : pick(next, [leaf, leaf, structure, combination])(next, depth)
}

function leaf(next: () => number): Any {
  return pick(next, [
    () => v.string(),
    () => v.pipe(v.string(), v.minLength(2)),
    () => v.pipe(v.string(), v.maxLength(3)),
    () => v.pipe(v.string(), v.regex(/^a/)),
    () => v.number(),
    () => v.pipe(v.number(), v.minValue(1)),
    () => v.pipe(v.number(), v.ltValue(9)),
    () => v.pipe(v.number(), v.integer()),
    () => v.pipe(v.number(), v.multipleOf(2)),
    () => v.boolean(),
    () => v.literal('a'),
    () => v.literal(1),
    () => v.picklist(['a', 'abc']),
    () => v.unknown(),
    () => v.null()
  ])() as Any
}

function structure(next: () => number, depth: number): Any {
  const inner = () => schemaOf(next, depth - 1)

  return pick(next, [
    () => v.array(inner()),
    () => v.pipe(v.array(inner()), v.minLength(1)),
    () => v.pipe(v.array(inner()), v.maxLength(2)),
    () => v.object({ a: inner() }),
    () => v.object({ a: inner(), b: v.optional(inner()) }),
    // A value that stands in where a key is absent, which is a fact about the key. Stated on a
    // property, because absence is a value the pool holds there: `{ a: 'a' }` omits `b`, so a
    // document requiring `b` refuses a value the validator takes.
    //
    // The replacement's schema is concrete, because a replacement has to be a value that schema
    // admits and `inner` draws an arbitrary one.
    () => v.object({ a: inner(), b: v.optional(v.string(), 'a') }),
    () => v.object({ a: inner(), b: v.optional(v.number(), 1) }),
    () => v.strictObject({ a: inner() }),
    () => v.objectWithRest({ a: inner() }, v.number()),
    () => v.tuple([inner()]),
    () => v.tuple([inner(), inner()]),
    () => v.tupleWithRest([inner()], v.number())
  ])() as Any
}

function combination(next: () => number, depth: number): Any {
  const inner = () => schemaOf(next, depth - 1)

  return pick(next, [
    () => v.union([inner(), inner()]),
    () => v.nullable(inner()),
    () => v.intersect([v.object({ a: v.string() }), v.object({ b: v.number() })]),
    () =>
      v.variant('kind', [
        v.object({ kind: v.literal('a') }),
        v.object({ kind: v.literal('b'), b: v.number() })
      ])
  ])() as Any
}
