# @fasciajs/core

The term a schema is described as, and the departures a target reports about it.

Part of [fascia](https://github.com/fasciajs/fascia). A schema is described once and written as
anything: four validators and five targets, and neither side knows the other exists.

```sh
npm install @fasciajs/core
```

Nothing here names a validator or a target. A frontend reads a schema into a `Node`, `describe`
folds that into a `Described`, and a target writes the `Described` down.

```ts
import { describe, isError, refusing } from '@fasciajs/core'
import { zodSource } from '@fasciajs/zod'

const described = describe(schema, zodSource, 'input')
if (isError(described)) throw new Error(described.message)

described.term          // what is true of the value
described.definitions   // what it referred to by name
```

See the [root README](https://github.com/fasciajs/fascia#readme) for the whole shape, what it
refuses, and the numbers.

MIT.
