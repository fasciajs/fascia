import type { JsonValue } from './json.js'

/**
 * What a schema says about itself, which changes nothing about what it accepts.
 *
 * **A fixed vocabulary rather than a bag a caller fills.** Every validator here lets a caller put
 * arbitrary keys beside a schema: `z.string().meta({ minimum: 3 })` is accepted and stored. A bag
 * passed through would carry one target's keywords across a term that holds none, and an assertion
 * arriving as metadata would change what a reader accepts while every departure this library reports
 * stayed silent about it. So four things travel, and anything else stays where a caller wrote it.
 *
 * These four are what every target here has a word for and what none of them reads as a constraint.
 */
export interface Meta {
  readonly title?: string
  readonly description?: string
  readonly examples?: readonly JsonValue[]
  readonly deprecated?: boolean
}

/** A schema that says nothing about itself. */
export const noMeta: Meta = {}

/**
 * Two statements about one value, the outer one winning where both say a thing.
 *
 * A wrapper carries what a caller wrote last: `z.string().describe('inner').optional()` states the
 * inner one and `z.string().optional().describe('outer')` states the outer, and the outer is the
 * later word about the same value.
 */
export function outermost(outer: Meta, inner: Meta): Meta {
  return { ...inner, ...outer }
}

/**
 * What one statement says that another does not already say.
 *
 * **A use of a named schema may describe that use, and a document holds the description beside the
 * reference.** Two schemas sharing a name are one shape, so the second is written as a reference to
 * the first. Where the second says something further about itself, that goes on the reference: a
 * caller writing `withOpenApi(IsoDate(), { description: 'when the session expires' })` is describing
 * this use of the date and not every date.
 *
 * A word the two already share is dropped rather than repeated. A reference and the schema it names
 * both carrying one sentence say what one says, and a reader that found them disagreeing would have
 * nothing to choose by.
 */
export function beyond(stated: Meta, already: Meta): Meta {
  return {
    ...(stated.title !== undefined && stated.title !== already.title && { title: stated.title }),
    ...(stated.description !== undefined &&
      stated.description !== already.description && { description: stated.description }),
    ...(stated.examples !== undefined &&
      !sameExamples(stated.examples, already.examples) && { examples: stated.examples }),
    ...(stated.deprecated !== undefined &&
      stated.deprecated !== already.deprecated && { deprecated: stated.deprecated })
  }
}

/**
 * Whether two lists of examples hold the same values.
 *
 * Compared as JSON, which is the form every one of them has: a value reaches `examples` only after
 * `asExamples` gave it a JSON form. Two lists that agree hold one order, so the text agrees as well.
 */
function sameExamples(
  stated: readonly JsonValue[],
  already: readonly JsonValue[] | undefined
): boolean {
  return already !== undefined && JSON.stringify(stated) === JSON.stringify(already)
}

/**
 * What a vendor's bag of words says, taking only the four and only where each is well formed.
 *
 * The bag crosses the boundary, so every value in it is unknown until this reads it. A key this does
 * not name is left where a caller wrote it rather than travelling untyped.
 */
export function metaFrom(bag: Readonly<Record<string, unknown>> | undefined): Meta {
  if (bag === undefined) {
    return noMeta
  }

  const title = bag['title']
  const description = bag['description']
  const deprecated = bag['deprecated']
  const examples = asExamples(bag['examples'])

  return {
    ...(typeof title === 'string' && { title }),
    ...(typeof description === 'string' && { description }),
    ...(examples !== undefined && { examples }),
    ...(typeof deprecated === 'boolean' && { deprecated })
  }
}

/**
 * A list of examples, where every one has a JSON form.
 *
 * All of them or none. A list with one value dropped out of it is a document stating that a caller
 * may send the others, which is a narrower claim than the schema made.
 */
function asExamples(value: unknown): readonly JsonValue[] | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    return undefined
  }

  const examples: JsonValue[] = []
  for (const one of value) {
    const json = asJsonValue(one)
    if (json === undefined) {
      return undefined
    }
    examples.push(json)
  }
  return examples
}

/** A value with a JSON form, or nothing where it has none. */
function asJsonValue(value: unknown): JsonValue | undefined {
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return value
    case 'number':
      return Number.isFinite(value) ? value : undefined
    case 'object':
      return value === null ? null : asJsonStructure(value)
    default:
      return undefined
  }
}

function asJsonStructure(value: object): JsonValue | undefined {
  if (Array.isArray(value)) {
    const items: JsonValue[] = []
    for (const one of value) {
      const json = asJsonValue(one)
      if (json === undefined) {
        return undefined
      }
      items.push(json)
    }
    return items
  }

  const entries: Record<string, JsonValue> = {}
  for (const [key, one] of Object.entries(value)) {
    const json = asJsonValue(one)
    if (json === undefined) {
      return undefined
    }
    entries[key] = json
  }
  return entries
}
