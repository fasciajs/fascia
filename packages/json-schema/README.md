# @fasciajs/json-schema

A term, written as JSON Schema 2020-12.

Part of [fascia](https://github.com/fasciajs/fascia). A schema is described once and written as
anything: four validators and five targets, and neither side knows the other exists.

```sh
npm install @fasciajs/json-schema
```

2020-12 has a keyword for every assertion a term carries, and it reports no widening at all. What it
gives up it reports rather than drops: a discriminant tells the members of a disjunction apart, and
`oneOf` states what the document accepts without one.

It reads one too. A validator that writes its own 2020-12 becomes a frontend through this package,
so a fifth library is a document rather than a reading of its internals.

```ts
import { describe } from '@fasciajs/core'
import { jsonSchemaAt, jsonSchemaSource } from '@fasciajs/json-schema'

describe(jsonSchemaAt(document), jsonSchemaSource, 'input')
```

What this library writes, it reads: `spell` then `read` then `spell` is where it started, over every
document written from every frontend here. A term read from a document admits what the document
admits, asked of Ajv.

```ts
import { spellJsonSchema } from '@fasciajs/json-schema'

const spelled = spellJsonSchema(term)
spelled.written      // the document
spelled.departures   // what it gave up, and which way
```

See the [root README](https://github.com/fasciajs/fascia#readme) for the whole shape, what it
refuses, and the numbers.

MIT.
