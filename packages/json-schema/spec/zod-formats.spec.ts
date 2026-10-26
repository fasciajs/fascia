import { createHash } from 'node:crypto'
import { VALUES } from '@fascia-internal/grammar'
import { describe as description, isError } from '@fasciajs/core'
import { spellJsonSchemaAll } from '@fasciajs/json-schema'
import { zodSource } from '@fasciajs/zod'
import { Ajv2020 } from 'ajv/dist/2020.js'
import { default as formats } from 'ajv-formats'
import { describe, expect, it } from 'vitest'
import * as z from 'zod'

/**
 * zod's own parse is the oracle for every format zod exports.
 *
 * A format is a check in zod's code, and the code is not always the pattern zod states beside it.
 * zod parses an IPv6 address with a function, a JWT with a decode, and a local time with a pattern
 * the `time` keyword forbids. So the reader can only be right about a format where its document
 * agrees with the parse, and this asks that of every format, on values from the format's standard.
 */

/**
 * Every format zod builds in, by the name it gives the format.
 *
 * Read from zod's own union rather than from the classes. `hex`, `hostname`, `currency_code` and the
 * hashes are a custom format with a name, so no class names them, and the union does.
 */
type FormatName = z.core.$ZodStringFormatTypes['_zod']['def']['format']

type HashFormat = `${z.core.util.HashAlgorithm}_${z.core.util.HashEncoding}`

/** Each value, then the same value one edit away, so a pool reaches each side of a boundary. */
function near(seeds: readonly string[]): string[] {
  const found = new Set<string>()
  for (const seed of seeds) {
    const middle = Math.floor(seed.length / 2)
    found.add(seed)
    found.add(seed.slice(1))
    found.add(seed.slice(0, -1))
    found.add(seed + seed.slice(-1))
    found.add(seed.toUpperCase())
    found.add(seed.toLowerCase())
    for (const other of ['0', 'a', 'Z', '-', '.', ':', '=', '_', ' ', '/']) {
      found.add(seed.slice(0, middle) + other + seed.slice(middle + 1))
    }
  }
  return [...found]
}

const UUIDS = near([
  '123e4567-e89b-12d3-a456-426614174000',
  '00000000-0000-0000-0000-000000000000',
  'ffffffff-ffff-ffff-ffff-ffffffffffff',
  '1ec9414c-232a-6b00-b3c8-9e6bdeced846',
  '017f22e2-79b0-7cc3-98c4-dc0c0c07398f',
  '123e4567-e89b-92d3-a456-426614174000',
  '{123e4567-e89b-12d3-a456-426614174000}'
])

const DATETIMES = near([
  '2026-09-05T12:30:00Z',
  '2026-09-05T12:30:00.123Z',
  '2026-09-05T12:30:00+02:00',
  '2026-09-05T12:30:00',
  '2026-09-05T12:30Z',
  '2026-09-05T12:30',
  '2026-09-05t12:30:00z',
  '2026-09-05 12:30:00Z',
  '2024-02-29T00:00:00Z',
  '2026-02-29T00:00:00Z',
  '2026-09-05T23:59:60Z'
])

const TIMES = near(['12:30:00', '12:30', '12:30:00.5', '12:30:00Z', '12:30:00+02:00', '23:59:60'])

type Entry = readonly [label: string, schema: z.core.$ZodType, pool: readonly string[]]

/**
 * Each format, the schemas zod builds with it, and the values each schema is asked about.
 *
 * A record over the union, so a format zod adds is a compile error that names the format.
 */
const FORMATS: Record<Exclude<FormatName, HashFormat>, readonly Entry[]> = {
  base64: [['base64()', z.base64(), near(['', 'YQ==', 'YWI=', 'YWJj', 'YWJjZA==', '+/+/'])]],
  base64url: [['base64url()', z.base64url(), near(['', 'YQ', 'YWI', 'YWJj', '-_-_'])]],
  cidrv4: [
    ['cidrv4()', z.cidrv4(), near(['192.0.2.0/24', '10.0.0.0/8', '0.0.0.0/0', '192.0.2.1/32'])]
  ],
  cidrv6: [
    [
      'cidrv6()',
      z.cidrv6(),
      near(['2001:db8::/32', '::/0', '2001:db8::1/128', '::ffff:192.0.2.0/120'])
    ]
  ],
  credit_card: [
    [
      'creditCard()',
      z.creditCard(),
      near(['4111111111111111', '5555555555554444', '378282246310005', '4111 1111 1111 1111'])
    ]
  ],
  cuid: [['cuid()', z.cuid(), near(['cjld2cjxh0000qzrmn831i7rn'])]],
  cuid2: [['cuid2()', z.cuid2(), near(['tz4a98xxat96iws9zmbrgj3a'])]],
  currency_code: [['currencyCode()', z.currencyCode(), near(['USD', 'EUR', 'XXX'])]],
  e164: [['e164()', z.e164(), near(['+14155552671', '+442071838750'])]],
  email: [
    [
      'email()',
      z.email(),
      near([
        'a@b.com',
        'first.last@example.org',
        'a+tag@example.co',
        "o'hara@example.ie",
        '"quoted"@example.com',
        'a@[192.0.2.1]',
        'ü@example.com'
      ])
    ]
  ],
  emoji: [['emoji()', z.emoji(), near(['😀', '👍🏽', '🇺🇸', '1️⃣'])]],
  guid: [['guid()', z.guid(), UUIDS]],
  hex: [['hex()', z.hex(), near(['', 'ff', 'DEADbeef', '0x1f'])]],
  hostname: [
    [
      'hostname()',
      z.hostname(),
      near([
        'example.com',
        'a',
        'a-b.example',
        'xn--bcher-kva.example',
        'example.com.',
        '192.0.2.1'
      ])
    ]
  ],
  iban: [['iban()', z.iban(), near(['GB82WEST12345698765432', 'DE89370400440532013000'])]],
  ipv4: [['ipv4()', z.ipv4(), near(['192.0.2.1', '0.0.0.0', '255.255.255.255'])]],
  ipv6: [
    [
      'ipv6()',
      z.ipv6(),
      near(['2001:db8::1', '::', '::1', '::ffff:192.0.2.1', '2001:db8:0:0:0:0:2:1', 'fe80::1%eth0'])
    ]
  ],
  date: [['iso.date()', z.iso.date(), near(['2026-09-05', '2024-02-29', '2026-02-29'])]],
  datetime: [
    ['iso.datetime()', z.iso.datetime(), DATETIMES],
    ['iso.datetime({ offset: true })', z.iso.datetime({ offset: true }), DATETIMES],
    ['iso.datetime({ local: true })', z.iso.datetime({ local: true }), DATETIMES],
    ['iso.datetime({ precision: -1 })', z.iso.datetime({ precision: -1 }), DATETIMES],
    ['iso.datetime({ precision: 0 })', z.iso.datetime({ precision: 0 }), DATETIMES]
  ],
  duration: [
    [
      'iso.duration()',
      z.iso.duration(),
      near(['P1D', 'PT1H', 'P1W', 'P1Y2M3DT4H5M6S', 'PT0.5S', 'P1.5D', 'P1W2D'])
    ]
  ],
  time: [
    ['iso.time()', z.iso.time(), TIMES],
    ['iso.time({ precision: -1 })', z.iso.time({ precision: -1 }), TIMES]
  ],
  jwt: [
    [
      'jwt()',
      z.jwt(),
      near([
        // The example token of RFC 7519, section 3.1.
        'eyJ0eXAiOiJKV1QiLA0KICJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJqb2UiLA0KICJleHAiOjEzMDA4MTkzODAsDQogImh0dHA6Ly9leGFtcGxlLmNvbS9pc19yb290Ijp0cnVlfQ.dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk',
        'eyJhbGciOiJub25lIn0.e30.'
      ])
    ]
  ],
  ksuid: [['ksuid()', z.ksuid(), near(['0ujtsYcgvSTl8PAuAdqWYSMnLOv'])]],
  mac: [['mac()', z.mac(), near(['00:1B:44:11:3A:B7', '00-1B-44-11-3A-B7', '001B.4411.3AB7'])]],
  nanoid: [['nanoid()', z.nanoid(), near(['V1StGXR8_Z5jdHi6B-myT'])]],
  ulid: [['ulid()', z.ulid(), near(['01ARZ3NDEKTSV4RRFFQ69G5FAV'])]],
  url: [
    [
      'url()',
      z.url(),
      near([
        'https://example.com',
        'http://a',
        'mailto:a@example.com',
        'urn:isbn:0451450523',
        'file:///etc/hosts',
        'http://[::1]/',
        'https://例え.jp/',
        '//example.com'
      ])
    ]
  ],
  uuid: [
    ['uuid()', z.uuid(), UUIDS],
    ['uuidv4()', z.uuidv4(), UUIDS],
    ['uuidv7()', z.uuidv7(), UUIDS]
  ],
  xid: [['xid()', z.xid(), near(['9m4e2mr0ui3e8a215n4g'])]]
}

/**
 * Each hash, in each encoding, on the digests of two inputs.
 *
 * A list rather than a record, because `z.hash` takes the algorithm as a literal. The two checks
 * below make a name zod adds to either half a compile error.
 */
const ALGORITHMS = ['md5', 'sha1', 'sha256', 'sha384', 'sha512'] as const
const ENCODINGS = ['hex', 'base64', 'base64url'] as const

const _everyAlgorithm: [Exclude<z.core.util.HashAlgorithm, (typeof ALGORITHMS)[number]>] extends [
  never
]
  ? true
  : { 'zod hashes with an algorithm this oracle builds no schema for': never } = true
void _everyAlgorithm
const _everyEncoding: [Exclude<z.core.util.HashEncoding, (typeof ENCODINGS)[number]>] extends [
  never
]
  ? true
  : { 'zod writes a hash in an encoding this oracle builds no schema for': never } = true
void _everyEncoding

const HASHES: readonly Entry[] = ALGORITHMS.flatMap((algorithm) =>
  ENCODINGS.map(
    (enc): Entry => [
      `hash('${algorithm}', { enc: '${enc}' })`,
      z.hash(algorithm, { enc }),
      near(['', 'abc'].map((input) => createHash(algorithm).update(input).digest(enc)))
    ]
  )
)

/** Each number format, alone and after each other one, because a schema can state two. */
const NUMBER_FORMATS = [
  ['int', z.int],
  ['int32', z.int32],
  ['uint32', z.uint32],
  ['float32', z.float32],
  ['float64', z.float64]
] as const

const NUMBERS: readonly number[] = [
  0,
  1,
  -1,
  1.5,
  -1.5,
  2 ** 31 - 1,
  2 ** 31,
  -(2 ** 31),
  -(2 ** 31) - 1,
  2 ** 32 - 1,
  2 ** 32,
  Number.MAX_SAFE_INTEGER,
  Number.MAX_SAFE_INTEGER + 2,
  3.4028234663852886e38,
  3.5e38,
  Number.MAX_VALUE
]

const NUMBER_SCHEMAS = NUMBER_FORMATS.flatMap(([name, build]) => [
  [`${name}()`, build(), NUMBERS] as const,
  ...NUMBER_FORMATS.filter(([other]) => other !== name).map(
    ([other, then]) => [`${name}().check(${other}())`, build().check(then()), NUMBERS] as const
  )
])

interface Measured {
  /** Values the document takes and zod refuses. */
  readonly wider: readonly string[]
  /** Values zod takes and the document refuses. */
  readonly narrower: readonly string[]
}

function measure(schema: z.core.$ZodType, pool: readonly unknown[]): Measured | string {
  const described = description(schema, zodSource, 'input')
  if (isError(described)) {
    return described.message
  }
  const spelled = spellJsonSchemaAll(described)
  if (isError(spelled)) {
    return spelled.message
  }

  const ajv = new Ajv2020({ strict: false, allErrors: false })
  formats.default(ajv)
  const document = ajv.compile(spelled.written as object)

  const wider: string[] = []
  const narrower: string[] = []
  for (const value of new Set([...pool, ...VALUES])) {
    const byDocument = document(value) === true
    const byZod = z.safeParse(schema, value).success
    if (byDocument && !byZod) {
      wider.push(JSON.stringify(value))
    } else if (!byDocument && byZod) {
      narrower.push(JSON.stringify(value))
    }
  }
  return { wider, narrower }
}

/**
 * How often each document differs from zod at these pools, as [wider, narrower].
 *
 * A schema missing here differs nowhere. The counts move when the reader or zod changes, which is
 * what a run against an oracle has to notice.
 */
const KNOWN: Partial<Record<string, readonly [wider: number, narrower: number]>> = {
  // zod checks these in code and states a pattern that is not the check. The card and the IBAN hold
  // a checksum, and a JWT has no pattern at all. zod parses IPv6 with a function that takes an
  // IPv4 tail the pattern refuses, in an address and in a prefix.
  'creditCard()': [22, 0],
  'iban()': [8, 0],
  'jwt()': [19, 0],
  'ipv6()': [0, 5],
  'cidrv6()': [0, 3],

  // The `date-time` and `time` keywords need an offset and seconds. zod's time never has an offset,
  // and these options drop the offset or the seconds, so zod writes no keyword for them.
  'iso.datetime({ local: true })': [0, 4],
  'iso.datetime({ precision: -1 })': [0, 1],
  'iso.time()': [0, 4],
  'iso.time({ precision: -1 })': [0, 1],

  // The `duration` keyword takes a fraction on no unit, and zod takes one on the seconds.
  'iso.duration()': [0, 1],

  // zod parses a URL with `new URL`, and the `uri` keyword reads RFC 3986, which has no IRI.
  'url()': [2, 15],

  // A later float format replaces the integer format, and zod keeps the integer.
  'int().check(float32())': [2, 0],
  'int().check(float64())': [2, 0],
  'int32().check(float32())': [2, 0],
  'int32().check(float64())': [2, 0],
  'uint32().check(float32())': [1, 0],
  'uint32().check(float64())': [1, 0]
}

describe("a document from a zod format accepts what zod's parse accepts", () => {
  const schemas = [...Object.values(FORMATS).flat(), ...HASHES, ...NUMBER_SCHEMAS]

  for (const [label, schema, pool] of schemas) {
    it(`agrees with z.${label} on values from its standard`, () => {
      const measured = measure(schema, pool)
      if (typeof measured === 'string') {
        throw new Error(`z.${label} has no document: ${measured}`)
      }
      const known = KNOWN[label] ?? [0, 0]
      expect(
        [measured.wider.length, measured.narrower.length],
        `wider: ${measured.wider.slice(0, 5).join(', ')}; narrower: ${measured.narrower.slice(0, 5).join(', ')}`
      ).toEqual(known)
    })
  }
})
