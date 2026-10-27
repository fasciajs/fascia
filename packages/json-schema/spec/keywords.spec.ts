import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { DRAFTS, type Draft, keywordsWhere, knows } from '../src/keywords.js'

/**
 * The keyword table against the meta-schemas each dialect publishes.
 *
 * The table is internal, so this spec imports the source. A keyword the table omits is one the
 * reader ignores in silence, and a validator asserts by it anyway.
 */

const require = createRequire(import.meta.url)

const vocabularies = (draft: string, names: readonly string[]): readonly string[] =>
  ['schema', ...names.map((name) => `meta/${name}`)].map(
    (name) => `ajv/dist/refs/json-schema-${draft}/${name}.json`
  )

const META: Readonly<Record<Draft, readonly string[]>> = {
  'draft-04': ['ajv-draft-04/dist/refs/json-schema-draft-04.json'],
  'draft-06': ['ajv/dist/refs/json-schema-draft-06.json'],
  'draft-07': ['ajv/dist/refs/json-schema-draft-07.json'],
  '2019-09': vocabularies('2019-09', [
    'applicator',
    'content',
    'core',
    'format',
    'meta-data',
    'validation'
  ]),
  '2020-12': vocabularies('2020-12', [
    'applicator',
    'content',
    'core',
    'format-annotation',
    'meta-data',
    'unevaluated',
    'validation'
  ])
}

/**
 * Keywords a dialect defines and its meta-schema does not list.
 *
 * draft-04 defines `$ref` in JSON Reference and `format` in its validation text. draft-07 defines
 * `writeOnly` in its validation text, and the meta-schema Ajv ships lists only `readOnly`.
 */
const UNLISTED: Readonly<Record<Draft, readonly string[]>> = {
  'draft-04': ['$ref', 'format'],
  'draft-06': [],
  'draft-07': ['writeOnly'],
  '2019-09': [],
  '2020-12': []
}

function listedIn(draft: Draft): readonly string[] {
  const listed = META[draft].flatMap((path): readonly string[] => {
    const meta: unknown = require(path)
    const properties =
      typeof meta === 'object' && meta !== null && 'properties' in meta ? meta.properties : {}
    return typeof properties === 'object' && properties !== null ? Object.keys(properties) : []
  })
  return [...listed, ...UNLISTED[draft]].sort()
}

describe('the reader classifies every keyword a dialect defines, and no other', () => {
  for (const draft of DRAFTS) {
    it(`knows in ${draft} what the ${draft} meta-schema lists`, () => {
      expect([...keywordsWhere((keyword) => knows(draft, keyword))].sort()).toEqual(listedIn(draft))
    })
  }
})
