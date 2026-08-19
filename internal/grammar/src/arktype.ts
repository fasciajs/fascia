import type { BaseRoot } from '@ark/schema'
import { type } from 'arktype'
import { pick, type Subject } from './draw.js'

/**
 * Schemas built from the arktype constructs this library claims to describe.
 *
 * **What is in the grammar is the whole of what the property proves.** A construct left out is
 * indistinguishable from one that was forgotten, so what is absent is listed below with the reason.
 *
 * Absent on purpose:
 *
 * - `Date` and `bigint`, which JSON has no form for, so there is no document to compare against.
 * - `.onUndeclaredKey('reject')`, which the reading has no case for: an object always reads as
 *   accepting an unnamed key. Including it would report a widening that is a missing reading rather
 *   than a target that has no word, and the report would not say which.
 * - A morph, which states what it converts and leaves what comes out to a function.
 * - A value that stands in where a key is absent. arktype reads one as a morph, and refuses an
 *   unordered union of two objects whose inputs overlap when either carries one: `{ a: string, b:
 *   number }` or `{ a: string, b: number = 1 }` is indeterminate to its parser. Every structure here
 *   can stand in the union case, so the construct cannot be drawn without dropping that case. zod
 *   and valibot draw it.
 * - An object stated by an index signature alone. arktype's `object` domain admits an array, and a
 *   document's does not, so every such document refuses a value arktype takes. The spec beside this
 *   file states the divergence rather than leaving it to a comment here.
 * - A scope, which names a schema and is what a recursive type needs. The value pool holds no value
 *   nested more than two deep, so a recursive schema and its first unrolling accept the same values.
 */
export function arkGrammar(next: () => number, depth: number): Subject<BaseRoot> {
  const schema = schemaOf(next, depth)

  return {
    // One cast, here, because arktype publishes `Type` and keeps its node types private. A `Type`
    // is one of arktype's nodes, which is what makes a reading at one level possible at all.
    schema: schema as unknown as BaseRoot,
    // Whether arktype takes a value is arktype's answer. A refusal is a value of its own type.
    accepts: (value) => !(schema(value) instanceof type.errors)
  }
}

/**
 * A schema built at runtime rather than from a literal.
 *
 * `type.raw` is arktype's own parser for a definition it cannot see, and it states one type for
 * every schema. `type` states the inferred type of each, which a recursive grammar cannot name.
 */
type ArkType = ReturnType<typeof type.raw>

function schemaOf(next: () => number, depth: number): ArkType {
  return depth <= 0 ? leaf(next) : pick(next, [leaf, leaf, structure, combination])(next, depth)
}

function leaf(next: () => number): ArkType {
  return pick(next, [
    () => type.raw('string'),
    () => type.raw('string >= 2'),
    () => type.raw('string <= 3'),
    () => type.raw('/^a/'),
    () => type.raw('number'),
    () => type.raw('number >= 1'),
    () => type.raw('number < 9'),
    // arktype states a whole number as a divisor of one, where zod states a flag and effect a type.
    () => type.raw('number.integer'),
    () => type.raw('number % 2'),
    () => type.raw('boolean'),
    () => type.raw("'a'"),
    () => type.raw('1'),
    () => type.raw("'a' | 'abc'"),
    () => type.raw('unknown'),
    () => type.raw('null')
  ])()
}

function structure(next: () => number, depth: number): ArkType {
  const inner = () => schemaOf(next, depth - 1)

  return pick(next, [
    () => inner().array(),
    () => inner().array().atLeastLength(1),
    () => inner().array().atMostLength(2),
    () => type.raw({ a: inner() }),
    () => type.raw({ a: inner(), 'b?': inner() }),
    () => type.raw([inner()]),
    () => type.raw([inner(), inner()])
  ])()
}

function combination(next: () => number, depth: number): ArkType {
  const inner = () => schemaOf(next, depth - 1)

  return pick(next, [
    () => inner().or(inner()),
    () => inner().or('null'),
    () => type.raw({ a: 'string' }).and({ b: 'number' })
  ])()
}
