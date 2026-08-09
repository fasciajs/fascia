import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

/**
 * A written schema whose references point somewhere else.
 *
 * This target writes `#/$defs/<name>`, because that is where 2020-12 keeps a definition. A document
 * holding these schemas may keep them elsewhere: OpenAPI keeps them under `#/components/schemas/`.
 *
 * The rewrite lives here rather than in whoever needs it, because `#/$defs/` is this file's
 * convention. A package matching that string from outside would be reading a decision it does not
 * own, and the two would drift apart in silence.
 */
export const DEFS = '#/$defs/'

export function refsAt(written: JSONSchema, prefix: string): JSONSchema {
  if (typeof written === 'boolean') {
    return written
  }

  const rewritten: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(written)) {
    rewritten[key] =
      key === '$ref' && typeof value === 'string' && value.startsWith(DEFS)
        ? prefix + value.slice(DEFS.length)
        : within(value, prefix)
  }

  return rewritten as JSONSchema
}

/** A value inside a schema, which may be a schema, a list of them, or a map of them. */
function within(value: unknown, prefix: string): unknown {
  if (Array.isArray(value)) {
    return value.map((one) => within(one, prefix))
  }

  return typeof value === 'object' && value !== null ? refsAt(value as JSONSchema, prefix) : value
}
