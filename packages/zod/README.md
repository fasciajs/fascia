# @fasciajs/zod

A zod schema, read as a `Node`.

Part of [fascia](https://github.com/fasciajs/fascia). A schema is described once and written as
anything: four validators and five targets, and neither side knows the other exists.

```sh
npm install @fasciajs/zod
```

The set of types is derived from what zod exports, so a type zod adds is a compile error naming
it rather than a schema that reads as something else.

```ts
import { zodSource } from '@fasciajs/zod'
import { describe } from '@fasciajs/core'

describe(z.object({ id: z.string() }), zodSource, 'input')
```

See the [root README](https://github.com/fasciajs/fascia#readme) for the whole shape, what it
refuses, and the numbers.

MIT.
