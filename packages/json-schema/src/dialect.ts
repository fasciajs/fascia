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

interface Rules {
  /** The `$schema` a document states this dialect by. */
  readonly uri: RegExp
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

const DIALECTS: readonly Rules[] = [
  {
    uri: /^https?:\/\/json-schema\.org\/draft-04\/schema#?$/,
    unknown: SINCE_06,
    refOverrides: true,
    booleanBounds: true
  },
  {
    uri: /^https?:\/\/json-schema\.org\/draft-06\/schema#?$/,
    unknown: SINCE_07,
    refOverrides: true,
    booleanBounds: false
  },
  {
    uri: /^https?:\/\/json-schema\.org\/draft-07\/schema#?$/,
    unknown: SINCE_2019,
    refOverrides: true,
    booleanBounds: false
  },
  {
    uri: /^https:\/\/json-schema\.org\/draft\/2019-09\/schema#?$/,
    unknown: SINCE_2020,
    refOverrides: false,
    booleanBounds: false
  }
]

/** A document, in 2020-12. A document stating no dialect, or one not listed, is read as 2020-12. */
export function asCurrent(root: unknown): unknown {
  const stated = isKeyed(root) ? root['$schema'] : undefined
  const rules =
    typeof stated === 'string' ? DIALECTS.find((one) => one.uri.test(stated)) : undefined
  return rules === undefined ? root : translated(root, rules)
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
