# @fasciajs/valibot

A valibot schema, read as a `Node`.

Part of [fascia](https://github.com/fasciajs/fascia). A schema is described once and written as
anything: four validators and five targets, and neither side knows the other exists.

```sh
npm install @fasciajs/valibot
```

valibot states an assertion as a list of actions on the node itself, so a bounded string is one node
with a pipe beside it and reading an assertion means walking that list.

```ts
import { valibotSource } from '@fasciajs/valibot'
import { describe } from '@fasciajs/core'

describe(v.object({ id: v.string() }), valibotSource, 'input')
```

See the [root README](https://github.com/fasciajs/fascia#readme) for the whole shape, what it
refuses, and the numbers.

MIT.
