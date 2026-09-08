import * as z from 'zod'
import { pick, type Subject } from './draw.js'

/**
 * Schemas built from the zod constructs this library claims to describe.
 *
 * **What is in the grammar is the whole of what the property proves.** A construct left out is
 * indistinguishable from one that was forgotten, so what is absent is listed below with the reason.
 *
 * Absent on purpose:
 *
 * - `z.date()` and `z.bigint()`, which this library refuses to describe: JSON has no form for
 *   either, so there is no document to compare a parse against. `z.literal(1n)` is drawn, and the
 *   two are different questions: every reader here has a branch for a bigint among the values a
 *   term admits, and until it was drawn no run reached one. What a target does with it is the
 *   answer being measured.
 * - `.catch()` and `z.coerce.*`, which accept more than any document states. The parser was widened
 *   deliberately and a document narrower than one is the decision rather than a finding, so
 *   including them without reading the report would count a decision as a defect.
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
    () => z.email(),
    () => z.uuid(),
    () => z.number(),
    () => z.number().min(1),
    () => z.number().lt(9),
    () => z.number().int(),
    () => z.number().multipleOf(2),
    () => z.boolean(),
    () => z.literal('a'),
    () => z.literal(1),
    () => z.literal(1n),
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
    // A value that stands in where a key is absent, which is a fact about the key. Stated on a
    // property rather than at a root, because absence is a value the pool holds there: `{ a: 'a' }`
    // omits `b`, and a document requiring `b` refuses a value zod takes. A root default is discarded
    // by the term, and the pool holds no absent root to ask about, so one there would measure nothing.
    //
    // The inner schema is concrete, because a replacement has to be a value that schema admits and
    // `inner` draws an arbitrary one. The catchall and the tuple rest below are concrete for the
    // same reason.
    () => z.object({ a: inner(), b: z.string().default('a') }),
    () => z.object({ a: inner(), b: z.number().default(1) }),
    () => z.strictObject({ a: inner() }),
    () => z.object({ a: inner() }).catchall(z.number()),
    () => z.record(z.string(), inner()),
    () => z.tuple([inner()]),
    () => z.tuple([inner(), inner()]),
    () => z.tuple([inner()], z.number()),
    () => recursive(),
    () => underName(inner())
  ])()
}

/**
 * A schema that holds itself, which is what a reference is for.
 *
 * zod names nothing on its own, so a caller states one. `valuesNear` draws a value that nests
 * through the reference, which is what tells this apart from its first unrolling.
 */
function recursive(): z.ZodType {
  const held: z.ZodType = z
    .lazy(() => z.object({ name: z.string(), children: z.array(held) }))
    .meta({ id: 'Held' })
  return held
}

/**
 * A schema under a name, which is what a reference is written from.
 *
 * A name stands on any schema, and until this only a schema that held itself carried one, so every
 * target's reference form was exercised over one shape. The count keeps two names apart inside one
 * draw: two schemas claiming one name is an error this library reports, and not what is measured
 * here.
 */
let named = 0

function underName(schema: z.ZodType): z.ZodType {
  named += 1
  return schema.meta({ id: `Named${named}` })
}

function combination(next: () => number, depth: number): z.ZodType {
  const inner = () => schemaOf(next, depth - 1)

  return pick(next, [
    () => z.union([inner(), inner()]),
    () => inner().nullable(),
    // Drawn rather than fixed, because an intersection of two objects was the only one measured and
    // every target does something different with one. An uninhabited intersection is drawn too, and
    // what each target writes for one is the answer being measured.
    () => z.intersection(inner(), inner()),
    () =>
      z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('a') }),
        z.object({ kind: z.literal('b'), b: z.number() })
      ])
  ])()
}
