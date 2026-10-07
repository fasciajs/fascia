/**
 * A draft-07 document, stated again in 2020-12.
 *
 * One reader reads one dialect, and the other is translated where it enters. Two readers would state
 * every keyword the dialects share twice. effect and valibot write draft-07, so this is how either
 * document becomes a frontend.
 *
 * Two differences change what a document admits. A tuple is `items: [...]` with `additionalItems`
 * after it, where 2020-12 writes `prefixItems` and `items`. And draft-07 says to ignore every keyword
 * beside a `$ref`, where 2020-12 holds them all at once.
 */

/** A document is unknown data, and this is where it is parsed. A schema is keyed or it is not. */
export function isKeyed(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The dialect a document states. A document stating none is read as 2020-12. */
const DRAFT_07 = /^https?:\/\/json-schema\.org\/draft-07\/schema#?$/

export function asCurrent(root: unknown): unknown {
  return isKeyed(root) && typeof root['$schema'] === 'string' && DRAFT_07.test(root['$schema'])
    ? fromDraft07(root)
    : root
}

/** Keywords holding one schema. */
const ONE = ['additionalProperties', 'not', 'if', 'then', 'else', 'propertyNames', 'contains']

/** Keywords holding a list of schemas. */
const LIST = ['anyOf', 'oneOf', 'allOf']

/** Keywords holding schemas by name. `dependencies` holds a list of names beside a schema. */
const BY_NAME = ['properties', 'patternProperties', 'definitions', '$defs', 'dependencies']

/** Keywords 2020-12 asserts by and draft-07 does not know, so a draft-07 reader ignores them. */
const UNKNOWN = [
  'prefixItems',
  'dependentRequired',
  'dependentSchemas',
  'unevaluatedItems',
  'unevaluatedProperties',
  'minContains',
  'maxContains',
  '$dynamicRef'
]

/** What stands beside a `$ref` and still counts: where definitions live, and what a schema says. */
const BESIDE_REF = [
  '$ref',
  '$schema',
  '$id',
  '$comment',
  '$defs',
  'definitions',
  'title',
  'description',
  'default',
  'examples',
  'deprecated',
  'readOnly',
  'writeOnly'
]

/**
 * Schemas holding a `$ref` with an assertion beside it, which a draft-07 document does not settle.
 *
 * The draft says to ignore the assertion, and Ajv 8 holds it, with no option to do otherwise. One
 * document then admits two sets of values, and a term states one.
 */
const contested = new WeakSet<object>()

export function isContested(schema: object): boolean {
  return contested.has(schema)
}

function fromDraft07(schema: unknown): unknown {
  if (!isKeyed(schema)) {
    return schema
  }

  const referred = typeof schema['$ref'] === 'string'
  const translated: Record<string, unknown> = {}
  for (const [name, value] of Object.entries(schema)) {
    if (UNKNOWN.includes(name) || name === 'items' || name === 'additionalItems') {
      continue
    }

    translated[name] = ONE.includes(name)
      ? fromDraft07(value)
      : LIST.includes(name) && Array.isArray(value)
        ? value.map(fromDraft07)
        : BY_NAME.includes(name) && isKeyed(value)
          ? Object.fromEntries(Object.entries(value).map(([key, one]) => [key, fromDraft07(one)]))
          : value
  }

  if (referred) {
    if (Object.keys(schema).some((name) => !BESIDE_REF.includes(name))) {
      contested.add(translated)
    }
    return translated
  }

  const items = schema['items']
  if (Array.isArray(items)) {
    translated['prefixItems'] = items.map(fromDraft07)
    if (Object.hasOwn(schema, 'additionalItems')) {
      translated['items'] = fromDraft07(schema['additionalItems'])
    }
  } else if (items !== undefined) {
    // `additionalItems` beside a schema in `items` asserts nothing, because no position is named.
    translated['items'] = fromDraft07(items)
  }

  return translated
}
