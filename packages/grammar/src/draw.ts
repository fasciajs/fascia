/**
 * How a schema is drawn, and the values every subject is asked about.
 *
 * Shared by the spec of every target, so two targets are measured over one set of schemas and the
 * numbers they report are comparable. A grammar tuned to one target would report what that target is
 * good at.
 */

/**
 * One schema drawn from a grammar, and the validator's own answer about a value.
 *
 * The answer is asked of the validator rather than of a reading of it. A reading asked twice agrees
 * with itself whatever it says, which measures nothing.
 */
export interface Subject<S> {
  readonly schema: S
  readonly accepts: (value: unknown) => boolean
}

/** A grammar: a schema of a validator, drawn from a source of numbers. */
export type Grammar<S> = (next: () => number, depth: number) => Subject<S>

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

export function pick<T>(next: () => number, choices: readonly T[]): T {
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
  // Beyond a 32 bit integer, and a whole number. A target that reads a width off the bounds has to
  // pick one for a schema that stated none, and every other value here fits in the narrowest.
  3000000000,
  -3000000000,
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
