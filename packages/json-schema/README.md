# @fasciajs/json-schema

A term, written as JSON Schema 2020-12.

Part of [fascia](https://github.com/fasciajs/fascia). A schema is described once and written as
anything: four validators and five targets, and neither side knows the other exists.

```sh
npm install @fasciajs/json-schema
```

2020-12 has a keyword for almost every assertion a term carries. What it gives up is reported rather
than dropped: a tuple states values at positions and a term does not say which must be present.

```ts
import { spellJsonSchema } from '@fasciajs/json-schema'

const spelled = spellJsonSchema(term)
spelled.written      // the document
spelled.departures   // what it gave up, and which way
```

See the [root README](https://github.com/fasciajs/fascia#readme) for the whole shape, what it
refuses, and the numbers.

MIT.
