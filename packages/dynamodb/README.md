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

The AWS SDK reads it. `convertToAttr` turns a value into the attribute a table holds, and the check
beside this package asks the one question that matters: a value the schema takes marshals to an
attribute this description admits, over schemas drawn from all four validators.

This target is the newest here and the one with the fewest words. Read what it gives up: it has no
keyword for an assertion, no room for what a caller said about a schema, and no form for a
disjunction, so a description is wider than its schema wherever any of those was stated.

```ts
import { spellDynamo } from '@fasciajs/dynamodb'

spellDynamo(term).written   // { S: {} }, { M: … }, { S: {}, NULL: {} }
```

See the [root README](https://github.com/fasciajs/fascia#readme) for the whole shape, what it
refuses, and the numbers.

MIT.
