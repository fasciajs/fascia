import * as z from 'zod'
import { pick, type Subject } from './measure.js'

/**
 * Schemas built from the zod constructs this library claims to describe.
 *
 * **What is in the grammar is the whole of what the property proves.** A construct left out is
 * indistinguishable from one that was forgotten, so what is absent is listed below with the reason.
 *
 * Absent on purpose:
 *
 * - `z.date()` and `z.bigint()`, which this library refuses to describe: JSON has no form for
 *   either, so there is no document to compare a parse against.
 * - `.catch()` and `z.coerce.*`, which accept more than any document states. The parser was widened
 *   deliberately and a document narrower than one is the decision rather than a finding, so
 *   including them without reading the report would count a decision as a defect.
 * - `z.lazy()`, which needs a name and produces a reference. The value pool holds no value nested
 *   more than two deep, so a recursive schema and its first unrolling accept the same values in it.
 */
export function zodGrammar(next: () => number, depth: number): Subject<z.core.$ZodType> {
  const schema = schemaOf(next, depth)

  return {
    schema,
    // Whether zod takes a value is zod's answer.
    accepts: (value) => schema.safeParse(value).success
  }
}

function schemaOf(next: () => number, depth: number): z.ZodType {
  return depth <= 0 ? leaf(next) : pick(next, [leaf, leaf, structure, combination])(next, depth)
}

function leaf(next: () => number): z.ZodType {
  return pick(next, [
    () => z.string(),
    () => z.string().min(2),
    () => z.string().max(3),
    () => z.string().regex(/^a/),
    () => z.number(),
    () => z.number().min(1),
    () => z.number().lt(9),
    () => z.number().int(),
    () => z.number().multipleOf(2),
    () => z.boolean(),
    () => z.literal('a'),
    () => z.literal(1),
    () => z.enum(['a', 'abc']),
    () => z.unknown(),
    () => z.null()
  ])()
}

function structure(next: () => number, depth: number): z.ZodType {
  const inner = () => schemaOf(next, depth - 1)

  return pick(next, [
    () => z.array(inner()),
    () => z.array(inner()).min(1),
    () => z.array(inner()).max(2),
    () => z.object({ a: inner() }),
    () => z.object({ a: inner(), b: inner().optional() }),
    () => z.strictObject({ a: inner() }),
    () => z.object({ a: inner() }).catchall(z.number()),
    () => z.record(z.string(), inner()),
    () => z.tuple([inner()]),
    () => z.tuple([inner(), inner()]),
    () => z.tuple([inner()], z.number())
  ])()
}

function combination(next: () => number, depth: number): z.ZodType {
  const inner = () => schemaOf(next, depth - 1)

  return pick(next, [
    () => z.union([inner(), inner()]),
    () => inner().nullable(),
    () => z.intersection(z.object({ a: z.string() }), z.object({ b: z.number() })),
    () =>
      z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('a') }),
        z.object({ kind: z.literal('b'), b: z.number() })
      ])
  ])()
}
