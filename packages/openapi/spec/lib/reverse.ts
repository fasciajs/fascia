/**
 * 2020-12, recovered from what 3.0 says.
 *
 * Each of the four things 3.0 says another way is reversible: a flag beside one type is a type list,
 * a flag beside a bound is the exclusive keyword. So the way back is a translation of the same kind
 * as the way there, and it is what lets a validator answer about a 3.0 document at all: Ajv reads
 * JSON Schema, and `nullable` is not one of its words.
 *
 * Written in the check rather than in the library, because nothing a caller receives needs it. The
 * spec beside this file reads it back against what 2020-12 wrote, so a translation that quietly
 * changed a schema fails there rather than passing here.
 */
export function fromV30(written: unknown): unknown {
  if (typeof written !== 'object' || written === null) {
    return written
  }
  if (Array.isArray(written)) {
    return written.map(fromV30)
  }

  const stated = written as Record<string, unknown>
  const out: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(stated)) {
    if (key === 'nullable') {
      continue
    }
    if (key === 'exclusiveMinimum' && value === true) {
      out['exclusiveMinimum'] = stated['minimum']
      continue
    }
    if (key === 'exclusiveMaximum' && value === true) {
      out['exclusiveMaximum'] = stated['maximum']
      continue
    }
    if (key === 'minimum' && stated['exclusiveMinimum'] === true) {
      continue
    }
    if (key === 'maximum' && stated['exclusiveMaximum'] === true) {
      continue
    }
    out[key] = fromV30(value)
  }

  if (stated['nullable'] !== true) {
    return out
  }

  // `nullable` says the value may be null and says it wherever it stands. Beside one named type the
  // tighter form is a type list, and everywhere else it is a value the schema admits beside what it
  // already admitted. The library writes the flag next to a wrapped reference, and reading it any
  // other way here would lose the null it was written to keep.
  if (typeof out['type'] === 'string') {
    return { ...out, type: [out['type'], 'null'] }
  }

  // The definitions stay at the top. A reference is resolved against the root of the document, so a
  // table carried inside a wrapper is a table nothing can reach, and the schema stops compiling.
  const { $defs, ...rest } = out
  return {
    anyOf: [rest, { type: 'null' }],
    ...($defs !== undefined && { $defs })
  }
}
