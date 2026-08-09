# @fasciajs/openapi

Operations, written as an OpenAPI 3.1 or 3.0 document.

Part of [fascia](https://github.com/fasciajs/fascia). A schema is described once and written as
anything: four validators and five targets, and neither side knows the other exists.

```sh
npm install @fasciajs/openapi
```

A 3.1 schema is a 2020-12 schema, so this asks that target and moves the references. 3.0 is a
different dialect and is translated: `nullable` beside one type, an exclusive bound as a flag, and no
positional form.

```ts
import { spellOpenApi } from '@fasciajs/openapi'

spellOpenApi(operations, zodSource, naming, info)          // 3.1
spellOpenApi(operations, zodSource, naming, info, '3.0')   // 3.0
```

See the [root README](https://github.com/fasciajs/fascia#readme) for the whole shape, what it
refuses, and the numbers.

MIT.
