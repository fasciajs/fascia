/**
 * Every keyword a dialect read here defines, and what the reader does with each one.
 *
 * One table, because the reader, the translation and the check against the meta-schemas each ask
 * the same question of a keyword. Each list kept apart drifted: `$id` stood beside a `$ref` as
 * harmless, and nothing asked what `$id` does to the `$ref` under it.
 */

/** The JSON Schema dialects, oldest first. A keyword is known from one of these on. */
export const DRAFTS = ['draft-04', 'draft-06', 'draft-07', '2019-09', '2020-12'] as const

export type Draft = (typeof DRAFTS)[number]

/**
 * What the reader does with a keyword.
 *
 * - `location` names a schema or a place, and asserts nothing.
 * - `annotation` describes a value, and asserts nothing.
 * - `reference` points at another schema.
 * - `typed` and `valued` name the type, or the values, a schema admits.
 * - `asserted` holds a value of one type to a rule that a term states.
 * - `unread` asserts, and a term has no word for the assertion.
 * - `combined` and `conjoined` are a disjunction and a conjunction of schemas.
 * - `translated` is a form a later dialect states again, so the reader never sees it.
 */
export type Role =
  | 'location'
  | 'annotation'
  | 'reference'
  | 'typed'
  | 'valued'
  | 'asserted'
  | 'unread'
  | 'combined'
  | 'conjoined'
  | 'translated'

/** Where a keyword holds schemas: one schema, a list of them, or a map of them by name. */
export type Holds = 'one' | 'list' | 'by name'

export interface Keyword {
  readonly role: Role
  readonly since: Draft
  /** The first dialect that does not know the keyword, where one removed it. */
  readonly until?: Draft
  readonly holds?: Holds
}

export const KEYWORDS: ReadonlyMap<string, Keyword> = new Map<string, Keyword>([
  ['$schema', { role: 'location', since: 'draft-04' }],
  ['id', { role: 'location', since: 'draft-04', until: 'draft-06' }],
  ['$id', { role: 'location', since: 'draft-06' }],
  ['$anchor', { role: 'location', since: '2019-09' }],
  ['$dynamicAnchor', { role: 'location', since: '2020-12' }],
  ['$recursiveAnchor', { role: 'location', since: '2019-09' }],
  ['$vocabulary', { role: 'location', since: '2019-09' }],
  ['definitions', { role: 'location', since: 'draft-04', holds: 'by name' }],
  ['$defs', { role: 'location', since: '2019-09', holds: 'by name' }],

  ['$comment', { role: 'annotation', since: 'draft-07' }],
  ['title', { role: 'annotation', since: 'draft-04' }],
  ['description', { role: 'annotation', since: 'draft-04' }],
  ['default', { role: 'annotation', since: 'draft-04' }],
  ['examples', { role: 'annotation', since: 'draft-06' }],
  ['deprecated', { role: 'annotation', since: '2019-09' }],
  ['readOnly', { role: 'annotation', since: 'draft-07' }],
  ['writeOnly', { role: 'annotation', since: 'draft-07' }],
  ['contentEncoding', { role: 'annotation', since: 'draft-07' }],
  ['contentMediaType', { role: 'annotation', since: 'draft-07' }],
  ['contentSchema', { role: 'annotation', since: '2019-09', holds: 'one' }],

  ['$ref', { role: 'reference', since: 'draft-04' }],
  ['type', { role: 'typed', since: 'draft-04' }],
  ['enum', { role: 'valued', since: 'draft-04' }],
  ['const', { role: 'valued', since: 'draft-06' }],

  ['minLength', { role: 'asserted', since: 'draft-04' }],
  ['maxLength', { role: 'asserted', since: 'draft-04' }],
  ['pattern', { role: 'asserted', since: 'draft-04' }],
  ['format', { role: 'asserted', since: 'draft-04' }],
  ['minimum', { role: 'asserted', since: 'draft-04' }],
  ['maximum', { role: 'asserted', since: 'draft-04' }],
  ['exclusiveMinimum', { role: 'asserted', since: 'draft-04' }],
  ['exclusiveMaximum', { role: 'asserted', since: 'draft-04' }],
  ['multipleOf', { role: 'asserted', since: 'draft-04' }],
  ['items', { role: 'asserted', since: 'draft-04', holds: 'one' }],
  ['prefixItems', { role: 'asserted', since: '2020-12', holds: 'list' }],
  ['minItems', { role: 'asserted', since: 'draft-04' }],
  ['maxItems', { role: 'asserted', since: 'draft-04' }],
  ['uniqueItems', { role: 'asserted', since: 'draft-04' }],
  ['properties', { role: 'asserted', since: 'draft-04', holds: 'by name' }],
  ['required', { role: 'asserted', since: 'draft-04' }],
  ['additionalProperties', { role: 'asserted', since: 'draft-04', holds: 'one' }],
  ['propertyNames', { role: 'asserted', since: 'draft-06', holds: 'one' }],

  ['not', { role: 'unread', since: 'draft-04', holds: 'one' }],
  ['if', { role: 'unread', since: 'draft-07', holds: 'one' }],
  ['then', { role: 'unread', since: 'draft-07', holds: 'one' }],
  ['else', { role: 'unread', since: 'draft-07', holds: 'one' }],
  ['contains', { role: 'unread', since: 'draft-06', holds: 'one' }],
  ['minContains', { role: 'unread', since: '2019-09' }],
  ['maxContains', { role: 'unread', since: '2019-09' }],
  ['patternProperties', { role: 'unread', since: 'draft-04', holds: 'by name' }],
  ['minProperties', { role: 'unread', since: 'draft-04' }],
  ['maxProperties', { role: 'unread', since: 'draft-04' }],
  ['dependentRequired', { role: 'unread', since: '2019-09' }],
  ['dependentSchemas', { role: 'unread', since: '2019-09', holds: 'by name' }],
  // A map holding a list of names or a schema at each key.
  ['dependencies', { role: 'unread', since: 'draft-04', holds: 'by name' }],
  ['unevaluatedItems', { role: 'unread', since: '2019-09', holds: 'one' }],
  ['unevaluatedProperties', { role: 'unread', since: '2019-09', holds: 'one' }],
  ['$dynamicRef', { role: 'unread', since: '2020-12' }],
  ['$recursiveRef', { role: 'unread', since: '2019-09' }],

  ['anyOf', { role: 'combined', since: 'draft-04', holds: 'list' }],
  ['oneOf', { role: 'combined', since: 'draft-04', holds: 'list' }],
  ['allOf', { role: 'conjoined', since: 'draft-04', holds: 'list' }],

  ['additionalItems', { role: 'translated', since: 'draft-04', until: '2020-12', holds: 'one' }]
])

/** The keywords the table holds where `test` holds, in the order of the table. */
export function keywordsWhere(test: (keyword: Keyword) => boolean): readonly string[] {
  return [...KEYWORDS].filter(([, keyword]) => test(keyword)).map(([name]) => name)
}

/** Whether a keyword changes which values a schema admits. */
export function asserts(keyword: Keyword): boolean {
  return keyword.role !== 'location' && keyword.role !== 'annotation'
}

/** Whether a dialect knows a keyword. */
export function knows(draft: Draft, keyword: Keyword): boolean {
  const at = DRAFTS.indexOf(draft)
  return (
    DRAFTS.indexOf(keyword.since) <= at &&
    (keyword.until === undefined || at < DRAFTS.indexOf(keyword.until))
  )
}

/** The schemas a keyword holds in a 2020-12 document, or none where the keyword holds none. */
export function schemasIn(name: string, value: unknown): readonly unknown[] {
  const holds = KEYWORDS.get(name)?.holds
  switch (holds) {
    case undefined:
      return []
    case 'one':
      return [value]
    case 'list':
      return Array.isArray(value) ? value : []
    case 'by name':
      return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? Object.values(value)
        : []
    default:
      holds satisfies never
      throw new Error(`a keyword holds schemas in no way named here: ${String(holds)}`)
  }
}
