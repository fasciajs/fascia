# @fasciajs/arktype

An arktype schema, read as a `Node`.

Part of [fascia](https://github.com/fasciajs/fascia). A schema is described once and written as
anything: four validators and five targets, and neither side knows the other exists.

```sh
npm install @fasciajs/arktype
```

Read through arktype's own machinery rather than through the shape of its output: `hasKind` narrows
to the node type for a kind, so a field arktype moves is a compile error.

```ts
import { arktypeSource } from '@fasciajs/arktype'
import { describe } from '@fasciajs/core'

describe(type({ id: 'string' }), arktypeSource, 'input')
```

See the [root README](https://github.com/fasciajs/fascia#readme) for the whole shape, what it
refuses, and the numbers.

MIT.
