import type { Bound, Scalar, StringFormat } from '@fasciajs/core'
import { SchemaAST } from 'effect'

/**
 * What a refinement refines, read from the annotation the refinement carries.
 *
 * **A refinement's own condition is a function**, so nothing about it can be read. What can be read
 * is the `JSONSchema` annotation effect attaches beside the function, and that annotation is written
 * in a target's words rather than in a schema's. So this file runs the motto backwards: it takes the
 * words a caller's library chose and recovers the thing they were chosen to say.
 *
 * Only the words this package can turn back into something are taken. A key it does not know is
 * dropped rather than passed on, because a keyword travelling untranslated would reach a document
 * that was never asked whether it has a word for it.
 */

type Fragment = Record<string, unknown>

/** Every assertion a chain of refinements states, before it is sorted by the type it belongs to. */
export interface Refined {
  readonly minLength?: number
  readonly maxLength?: number
  readonly patterns?: readonly string[]
  readonly format?: StringFormat
  readonly minimum?: Bound<number>
  readonly maximum?: Bound<number>
  readonly multipleOf?: number
  readonly minItems?: number
  readonly maxItems?: number
}

/**
 * The schema a chain of refinements stands on, and everything the chain states about it.
 *
 * effect states each refinement as a node wrapping the one before, so a schema with two bounds is
 * two nodes deep. zod folds them into one bag and arktype keeps them beside a basis; effect is the
 * one of the three where reading an assertion means walking.
 *
 * The innermost wins where two refinements state one keyword, because the walk reads from the
 * outside in and takes only what is still unset. A later refinement cannot loosen an earlier one in
 * effect, so the innermost is also the strictest.
 */
export function refinedFrom(ast: SchemaAST.AST): { base: SchemaAST.AST; refined: Refined } {
  const fragments: Fragment[] = []
  let base = ast

  while (SchemaAST.isRefinement(base)) {
    const fragment = base.annotations[SchemaAST.JSONSchemaAnnotationId]
    if (isFragment(fragment)) {
      fragments.push(fragment)
    }
    base = base.from
  }

  return { base, refined: merged(fragments) }
}

function isFragment(value: unknown): value is Fragment {
  return typeof value === 'object' && value !== null
}

function merged(fragments: readonly Fragment[]): Refined {
  let refined: Refined = {}

  // Outermost first, so an inner statement of the same keyword is the one kept.
  for (const fragment of fragments) {
    refined = { ...refined, ...readFragment(fragment) }
  }

  return refined
}

/** The formats a document has a name for, keyed by what effect writes. */
const FORMAT_NAMES: Partial<Record<string, StringFormat>> = {
  email: 'email',
  uri: 'uri',
  url: 'uri',
  uuid: 'uuid',
  hostname: 'hostname',
  ipv4: 'ipv4',
  ipv6: 'ipv6',
  date: 'date',
  time: 'time',
  'date-time': 'date-time',
  duration: 'duration'
}

function numberAt(fragment: Fragment, key: string): number | undefined {
  const value = fragment[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function readFragment(fragment: Fragment): Refined {
  const minLength = numberAt(fragment, 'minLength')
  const maxLength = numberAt(fragment, 'maxLength')
  const minItems = numberAt(fragment, 'minItems')
  const maxItems = numberAt(fragment, 'maxItems')
  const multipleOf = numberAt(fragment, 'multipleOf')
  const minimum = boundAt(fragment, 'minimum', 'exclusiveMinimum')
  const maximum = boundAt(fragment, 'maximum', 'exclusiveMaximum')

  const pattern = fragment['pattern']
  const format = fragment['format']
  const named = typeof format === 'string' ? FORMAT_NAMES[format] : undefined

  return {
    ...(minLength !== undefined && { minLength }),
    ...(maxLength !== undefined && { maxLength }),
    ...(minItems !== undefined && { minItems }),
    ...(maxItems !== undefined && { maxItems }),
    ...(multipleOf !== undefined && { multipleOf }),
    ...(minimum !== undefined && { minimum }),
    ...(maximum !== undefined && { maximum }),
    ...(typeof pattern === 'string' && { patterns: [pattern] }),
    ...(named !== undefined && { format: named })
  }
}

/** A bound, and whether the bound itself is admitted. JSON Schema states the two under two keys. */
function boundAt(
  fragment: Fragment,
  inclusiveKey: string,
  exclusiveKey: string
): Bound<number> | undefined {
  const exclusive = numberAt(fragment, exclusiveKey)
  if (exclusive !== undefined) {
    return { value: exclusive, exclusive: true }
  }

  const inclusive = numberAt(fragment, inclusiveKey)
  return inclusive === undefined ? undefined : { value: inclusive, exclusive: false }
}

/** The assertions a string admits, taken from what the chain stated. */
export function stringAssertionsOf(
  refined: Refined
): Extract<Scalar, { name: 'string' }>['assertions'] {
  return {
    ...(refined.minLength !== undefined && { minLength: refined.minLength }),
    ...(refined.maxLength !== undefined && { maxLength: refined.maxLength }),
    ...(refined.patterns !== undefined && { patterns: refined.patterns }),
    ...(refined.format !== undefined && { format: refined.format })
  }
}

/** The assertions a number admits. */
export function numberAssertionsOf(
  refined: Refined
): Extract<Scalar, { name: 'number' }>['assertions'] {
  return {
    ...(refined.minimum !== undefined && { minimum: refined.minimum }),
    ...(refined.maximum !== undefined && { maximum: refined.maximum }),
    ...(refined.multipleOf !== undefined && { multipleOf: refined.multipleOf })
  }
}

/** The assertions a list admits. */
export function listAssertionsOf(refined: Refined): {
  readonly minItems?: number
  readonly maxItems?: number
  readonly unique?: boolean
} {
  return {
    ...(refined.minItems !== undefined && { minItems: refined.minItems }),
    ...(refined.maxItems !== undefined && { maxItems: refined.maxItems })
  }
}
