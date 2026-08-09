# @fasciajs/atd

A term and a set of procedures, written for arri.

Part of [fascia](https://github.com/fasciajs/fascia). A schema is described once and written as
anything: four validators and five targets, and neither side knows the other exists.

```sh
npm install @fasciajs/atd
```

arri names a procedure's two ends rather than holding them, so every position is named and a schema
standing at both becomes two definitions where its sides differ. arri's own generators write
TypeScript, Dart and Rust clients from what this produces.

```ts
import { spellAtd, spellAtdApp } from '@fasciajs/atd'

spellAtd(term)                                    // one schema
spellAtdApp(procedures, zodSource, naming, info)  // a whole app definition
```

See the [root README](https://github.com/fasciajs/fascia#readme) for the whole shape, what it
refuses, and the numbers.

MIT.
