# @fasciajs/effect

An effect `Schema`, read as a `Node`.

Part of [fascia](https://github.com/fasciajs/fascia). A schema is described once and written as
anything: four validators and five targets, and neither side knows the other exists.

```sh
npm install @fasciajs/effect
```

effect publishes a plain tagged union, so the dispatch is a switch and a node effect adds is a
compile error. A transformation carries both directions, so effect produces a codec as a matter of
course.

```ts
import { effectSource } from '@fasciajs/effect'
import { describe } from '@fasciajs/core'

describe(Schema.Struct({ id: Schema.String }).ast, effectSource, 'input')
```

See the [root README](https://github.com/fasciajs/fascia#readme) for the whole shape, what it
refuses, and the numbers.

MIT.
