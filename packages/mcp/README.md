# @fasciajs/mcp

Tools, written as Model Context Protocol definitions.

Part of [fascia](https://github.com/fasciajs/fascia). A schema is described once and written as
anything: four validators and five targets, and neither side knows the other exists.

```sh
npm install @fasciajs/mcp
```

A tool takes named arguments, so the schema at each end must name `object` and anything else is
refused. A tool carries its own definitions rather than pointing into a table, so each holds what it
reaches and no more.

```ts
import { spellMcpTools } from '@fasciajs/mcp'

spellMcpTools([{ name: 'create_user', arguments: User, result: User }], zodSource, naming)
```

See the [root README](https://github.com/fasciajs/fascia#readme) for the whole shape, what it
refuses, and the numbers.

MIT.
