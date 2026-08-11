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

An operation states a body, the responses, and what a caller sends outside the body. The body is
described as the input side and each response as the output side, so one schema with a default or a
conversion under it becomes two components.

A parameter is a name, a place and a schema, and no validator holds that shape. So one object is
stated for each place, and its properties are the parameters there. A key that may be absent is a
parameter that is not required.

```ts
{
  path: '/wallets/{salt}',
  method: 'post',
  parameters: {
    path: z.object({ salt: WalletSalt }),
    query: z.object({ limit: z.number().optional() }),
    header: z.object({ authorization: z.string() })
  },
  body: WalletDraft,
  responses: {
    '200': { schema: Wallet, description: 'the wallet, as stored' },
    '204': { description: 'gone' },
    '404': { schema: Problem }
  }
}
```

A response states what no schema carries: its description, the headers it sets, the links it offers,
and the media type it is written in. None of those is a fact about the value, so no validator holds
one. A response with no `schema` carries no body, which is what a 204 answers with. Where a caller
describes nothing, the status is written, because OpenAPI requires a description.

A path parameter is required, and it fills a template expression the path holds. This refuses one
that may be absent, and one the path has no `{name}` for.

A stated body is required. OpenAPI reads an absent `required` as false, so a document that says
nothing tells a client the body may be omitted. `bodyRequired: false` says the other thing, and the
keyword is written either way. `bodyMediaType` names the media type, and `mediaType` does the same for
a response. Both are `application/json` where a caller states none.

See the [root README](https://github.com/fasciajs/fascia#readme) for the whole shape, what it
refuses, and the numbers.

MIT.
