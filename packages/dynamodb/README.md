# @fasciajs/dynamodb

A term, written as the AttributeValue members a value may take.

Part of [fascia](https://github.com/fasciajs/fascia). A schema is described once and written as
anything: four validators and five targets, and neither side knows the other exists.

```sh
npm install @fasciajs/dynamodb
```

The one target here that does not describe JSON. It has ten types, no keyword for any assertion, no
reference form, and a native set, so it says things the others refuse and refuses most of what they
state exactly.

Nothing reads this format yet. A green check says the shape is well formed, not that it is true.

```ts
import { spellDynamo } from '@fasciajs/dynamodb'

spellDynamo(term).written   // { S: {} }, { M: … }, { S: {}, NULL: {} }
```

See the [root README](https://github.com/fasciajs/fascia#readme) for the whole shape, what it
refuses, and the numbers.

MIT.
