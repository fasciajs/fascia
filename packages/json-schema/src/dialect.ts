/**
 * A document in an older dialect, stated again in 2020-12.
 *
 * One reader reads one dialect, and each other dialect is translated where it enters. Two readers
 * would state every keyword the dialects share twice. effect and valibot write draft-07, and a
 * document in the OpenAPI 3.0 style writes draft-04's bounds, so this is how each becomes a frontend.
 *
 * Three differences change what a document admits, and each dialect is one row of them. Before
 * 2020-12 a tuple is `items: [...]` with `additionalItems` after it. Before 2019-09 a `$ref`
 * overrides every keyword beside it. In draft-04 an exclusive bound is a boolean beside `minimum`
 * or `maximum`.
 *
 * A dialect does not settle two things. It says to ignore a keyword it does not know, and to ignore
 * an assertion beside a `$ref`. Ajv 8 holds both: it asserts every keyword its class knows, whatever
 * `$schema` says, and has no option to ignore a sibling of `$ref`. Such a document admits two sets of
 * values, and a term states one, so each is contested and refused.
 */

/** A document is unknown data, and this is where it is parsed. A schema is keyed or it is not. */
export function isKeyed(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The dialects a document is read in. Each one is named explicitly, by `$schema` or by a caller. */
const NAMES = ['draft-04', 'draft-06', 'draft-07', '2019-09', '2020-12', 'oas-3.1'] as const

export type Dialect = (typeof NAMES)[number]

/**
 * The `$schema` URIs each dialect is named by. The writer writes the first, and the reader matches
 * every one.
 *
 * OpenAPI 3.1 names its dialect `/dialect/base`, and publishes the same dialect under a dated `$id`.
 * It is 2020-12 with `format` as an annotation and four keywords of its own: `discriminator`, `xml`,
 * `externalDocs` and `example`. The specification says a discriminator "MUST NOT change the
 * validation outcome", and the other three describe, so none of the four asserts.
 */
export const SCHEMA_URIS: Readonly<Record<Dialect, readonly [string, ...string[]]>> = {
  'draft-04': ['http://json-schema.org/draft-04/schema#'],
  'draft-06': ['http://json-schema.org/draft-06/schema#'],
  'draft-07': ['http://json-schema.org/draft-07/schema#'],
  '2019-09': ['https://json-schema.org/draft/2019-09/schema'],
  '2020-12': ['https://json-schema.org/draft/2020-12/schema'],
  'oas-3.1': [
    'https://spec.openapis.org/oas/3.1/dialect/base',
    'https://spec.openapis.org/oas/3.1/dialect/2024-11-10'
  ]
}

/**
 * The dialect a `$schema` names, or nothing where it names none listed here.
 *
 * The scheme and an empty fragment are written both ways by validators, and name one dialect.
 */
export function dialectNamed(uri: string): Dialect | undefined {
  const bare = (one: string): string => one.replace(/^https?:\/\//, '').replace(/#$/, '')
  return NAMES.find((name) => SCHEMA_URIS[name].some((named) => bare(named) === bare(uri)))
}

interface Rules {
  /** Keywords a later dialect asserts by and this one does not know. */
  readonly unknown: readonly string[]
  /** Whether a `$ref` overrides the keywords beside it. */
  readonly refOverrides: boolean
  /** Whether an exclusive bound is a boolean beside the bound. */
  readonly booleanBounds: boolean
}

const SINCE_2020 = ['prefixItems', '$dynamicRef']
const SINCE_2019 = [
  ...SINCE_2020,
  'dependentRequired',
  'dependentSchemas',
  'unevaluatedItems',
  'unevaluatedProperties',
  'minContains',
  'maxContains',
  '$recursiveRef'
]
const SINCE_07 = [...SINCE_2019, 'if', 'then', 'else']
const SINCE_06 = [...SINCE_07, 'const', 'contains', 'propertyNames']

/** The dialects read as they stand, because each one is 2020-12 in what it asserts. */
type Current = '2020-12' | 'oas-3.1'

const RULES: Readonly<Record<Exclude<Dialect, Current>, Rules>> = {
  'draft-04': { unknown: SINCE_06, refOverrides: true, booleanBounds: true },
  'draft-06': { unknown: SINCE_07, refOverrides: true, booleanBounds: false },
  'draft-07': { unknown: SINCE_2019, refOverrides: true, booleanBounds: false },
  '2019-09': { unknown: SINCE_2020, refOverrides: false, booleanBounds: false }
}

/** A document in a dialect, stated in 2020-12. */
export function asCurrent(root: unknown, dialect: Dialect): unknown {
  return dialect === '2020-12' || dialect === 'oas-3.1' ? root : translated(root, RULES[dialect])
}

/** Keywords holding one schema. */
const ONE = ['additionalProperties', 'not', 'if', 'then', 'else', 'propertyNames', 'contains']

/** Keywords holding a list of schemas. */
const LIST = ['anyOf', 'oneOf', 'allOf']

/** Keywords holding schemas by name. `dependencies` holds a list of names beside a schema. */
const BY_NAME = ['properties', 'patternProperties', 'definitions', '$defs', 'dependencies']

/** What stands beside a `$ref` and still counts: where definitions live, and what a schema says. */
const BESIDE_REF = [
  '$ref',
  '$schema',
  '$id',
  'id',
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

/** Each translated schema the dialect does not settle, and why. */
const contested = new WeakMap<object, string>()

/** Why a translated schema admits two sets of values, where it does. */
export function contestOf(schema: object): string | undefined {
  return contested.get(schema)
}

function translated(schema: unknown, rules: Rules): unknown {
  if (!isKeyed(schema)) {
    return schema
  }

  const each = (one: unknown): unknown => translated(one, rules)
  const held: Record<string, unknown> = {}
  for (const [name, value] of Object.entries(schema)) {
    if (name === 'items' || name === 'additionalItems') {
      continue
    }

    held[name] = ONE.includes(name)
      ? each(value)
      : LIST.includes(name) && Array.isArray(value)
        ? value.map(each)
        : BY_NAME.includes(name) && isKeyed(value)
          ? Object.fromEntries(Object.entries(value).map(([key, one]) => [key, each(one)]))
          : value
  }

  const unknown = rules.unknown.filter((name) => Object.hasOwn(schema, name))
  if (unknown.length > 0) {
    contested.set(
      held,
      `this states ${unknown.join(', ')}, which the dialect it names does not know and Ajv asserts anyway`
    )
  }

  if (rules.refOverrides && typeof schema['$ref'] === 'string') {
    if (Object.keys(schema).some((name) => !BESIDE_REF.includes(name))) {
      contested.set(
        held,
        'this is a reference with an assertion beside it, which the dialect ignores and Ajv holds'
      )
    }
    return held
  }

  const items = schema['items']
  if (Array.isArray(items)) {
    held['prefixItems'] = items.map(each)
    if (Object.hasOwn(schema, 'additionalItems')) {
      held['items'] = each(schema['additionalItems'])
    }
  } else if (items !== undefined) {
    // `additionalItems` beside a schema in `items` asserts nothing, because no position is named.
    held['items'] = each(items)
  }

  if (rules.booleanBounds) {
    exclusive(held, 'minimum', 'exclusiveMinimum')
    exclusive(held, 'maximum', 'exclusiveMaximum')
  }

  return held
}

/**
 * A draft-04 bound, which is a number and a boolean saying whether the number itself is admitted.
 *
 * 2020-12 states an exclusive bound as the number under the exclusive name, so `true` moves the
 * number there. `false` is the inclusive bound, which is what the number says alone.
 */
function exclusive(held: Record<string, unknown>, bound: string, flag: string): void {
  const value = held[bound]
  const stated = held[flag]
  if (typeof stated !== 'boolean') {
    return
  }

  delete held[flag]
  if (stated && typeof value === 'number') {
    delete held[bound]
    held[flag] = value
  }
}
