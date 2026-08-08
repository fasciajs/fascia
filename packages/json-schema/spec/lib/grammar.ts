import * as z from 'zod'

/**
 * Schemas built from the constructs this library claims to describe, and the values used to tell
 * two readings of one schema apart.
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
 * - `z.lazy()`, which needs a name and produces a reference. Worth adding, and it needs the check
 *   to resolve `$ref` against `$defs`, which the shape below does not do yet.
 */

/** A deterministic source of numbers. An unreproducible failure is a rumour rather than a report. */
export function numbers(seed: number): () => number {
  let state = seed >>> 0

  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let drawn = Math.imul(state ^ (state >>> 15), 1 | state)
    drawn = (drawn + Math.imul(drawn ^ (drawn >>> 7), 61 | drawn)) ^ drawn
    return ((drawn ^ (drawn >>> 14)) >>> 0) / 4294967296
  }
}

function pick<T>(next: () => number, choices: readonly T[]): T {
  const chosen = choices[Math.floor(next() * choices.length)]
  if (chosen === undefined) {
    throw new Error('the grammar drew from nothing')
  }
  return chosen
}

/**
 * The values every subject is asked about.
 *
 * Fixed rather than derived from the schema in hand, because the values that tell two readings apart
 * are the ones a schema's own shape would not suggest: the empty array against a tuple's bounds,
 * `null` against everything, a fractional number against a whole one.
 */
export const VALUES: readonly unknown[] = [
  null,
  true,
  false,
  0,
  1,
  -1,
  1.5,
  2,
  9,
  10,
  '',
  'a',
  'abc',
  'abcdefgh',
  [],
  [1],
  ['a'],
  ['a', 1],
  ['a', 1, 'extra'],
  {},
  { a: 'a' },
  { a: 1 },
  { a: 'a', b: 1 },
  { a: 'a', extra: true },
  { kind: 'a' },
  { kind: 'b', b: 1 }
]

/** One schema, drawn from the grammar. */
export function schemaOf(next: () => number, depth: number): z.ZodType {
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
