# Changelog

Every published package here carries one version, so one entry covers all of them. A package that
did not change in a release still takes the release's number, because ten packages that are ten
readings of one core have nothing to say by moving apart.

## 0.4.0

### Added

**Every target now has a reader, and the term can answer for itself.**

`admits(description, value)` in `@fasciajs/core` says whether a term takes a value, or reports that
it does not decide. A `format` is the one thing it will not decide, because deciding an email means
writing the validator this library refuses to be. Until now nothing could ask a term anything: every
check asked a validator and a document, and one number carried two questions.

`@fasciajs/dynamodb` is measured against the AWS SDK marshaller. `convertToAttr` turns a value into
the attribute a table holds, so the claim this target makes is one sentence: a value the schema takes
marshals to an attribute this description admits. That was untested and the README said so.

The 2020-12 target is also measured against arktype, zod and effect writing 2020-12 from their own
schemas. That asks what a document should be rather than whether a value passes, and it found the
tuple defect below. This library differs from none of the three.

### Changed

**A set is a case of the term.** It was a list carrying `unique`, which is a predicate: no item is
held twice. A set is a quotient, because a position is not part of the value, and `@fasciajs/dynamodb`
performed that quotient while the term stated only the predicate. `unique` is gone from a list and
`set` is a case beside `array`, so a multiset cannot be written and every target says what it does
with one: DynamoDB writes `SS` or `NS` exactly, 2020-12 writes `uniqueItems` and reports the order it
adds, ATD gives up both halves in two directions.

**A tuple states how many positions must be present.** `minPositions` is on the node and on the term,
and every frontend states it the way each already lifts a key's optionality onto the edge. A count
rather than a flag on each position, because every validator here makes an optional position a
trailing one.

A frontend that reads a validator's own set refuses it for a new reason. A parse of a list gives back
a Set, so a schema states a conversion rather than one value, and the term now has a set that nothing
here produces.

### Fixed

**2020-12 wrote a tuple without `minItems`, so a document took the empty list against a tuple of one
position.** `prefixItems` states what stands at each position and nothing about how many are there.
The term threw the count away before the target saw it, and the departure that reported the loss
named the target rather than the reading. The target now reports no widening at all, for any
frontend.

**`@fasciajs/effect` dropped the whole-number assertion.** `Schema.Int` annotates `{ type: 'integer' }`
and states nothing else, and the reader dropped a key it could not turn back into something. It could
turn that one back. A document took `1.5` where effect refused it, and no departure recorded the
widening, because the loss happened in the reading.

**`@fasciajs/dynamodb` described a disjunction as its last member alone.** Two members landing on `M`
were merged with a spread, so a description of a discriminated union refused a row matching its first
option. The members are joined now, and the departure beside it said `wider` while the code narrowed.

**`@fasciajs/dynamodb` ignored what stands past a tuple's positions**, so `[string, ...number]` said
`S` and turned away a row holding a number.

**`@fasciajs/dynamodb` lost what a caller said about a schema without reporting it.** A title, a
description, examples and a deprecation reached no attribute and no departure. The loss is in neither
direction and it is named now.

## 0.3.0

### Added

`@fasciajs/openapi` states the parts of a request and a response that no schema carries.

An operation states what a caller sends outside the body. A parameter is a name, a place, and a
schema, and no validator holds that shape, so `parameters` states one object for each place and its
properties are the parameters there. A key that may be absent is a parameter that is not required. A
path parameter is required, and it fills a template expression the path holds, so a document refuses
one that may be absent and one the path has no `{name}` for.

A response states its description, the headers it sets, the links it offers, and the media type it
is written in. None of those is a fact about a value. A response with no `schema` carries no body,
which is what a 204 answers with.

`bodyRequired` says whether a body is required, and the keyword is written either way, because
OpenAPI reads an absent `required` as false. `bodyMediaType` and `mediaType` name the media type,
and both are `application/json` where a caller states none.

A document states what a service needs and how a client divides. `tags` on an operation is what a
generator makes one file per group from. A security requirement names a scheme, and an empty list on
one operation says that operation needs nothing where the document needs something. The schemes, the
document's own groups, and its webhooks arrive in a sixth parameter. A webhook is an operation a
service calls rather than answers, so it is a path item under a name instead of a path, and it is
described the same way. 3.0 has no `webhooks`, so stating one for a 3.0 document is refused.

A use of a named schema may describe that use. Two schemas claiming one name are one shape, so the
second is written as a reference, and what the second says about itself beyond what the component
already says stands on the reference. A word the two share is written once. 3.1 reads a keyword
beside a `$ref` and 3.0 reads none, so 3.0 puts the reference under a conjunction of one and leaves
the rest outside it, and reports that.

`DocumentSpec`, `RequestParameters`, `ResponseSpec`, `Webhook`, and `Webhooks` are exported.

### Changed

**A pattern under `i`, `m`, or `s` is refused**, in `@fasciajs/zod` and `@fasciajs/valibot`. A
document states a pattern as text and states no flag beside it, so the source alone accepts less than
the schema does: zod takes `AB` under `/^ab$/i` and `^ab$` turns it away. The flag is gone before a
term exists, so no target could report the loss. Write the pattern so it matches without the flag.
A schema that produced a document before now produces a refusal, and this is the one change here that
stops a build.

`@fasciajs/json-schema` states the type the values of an enum share, where they share one. A
generator reads `type` to choose a form, and a list of strings under no type became an opaque value of
whatever the target language calls unknown. This changes the 2020-12 target, so every target built on
that one writes the type and not only `@fasciajs/openapi`.

`ResponseSpec` states either a schema or a description. Written as one shape with both optional it was
a weak type, and a validator's own schema satisfied a weak type by carrying a `description` of its
own. So `responses: { '200': User }` compiled, asked for nothing, and produced a response with no
`content` and no departure to report it. That call is a type error now.

`components.schemas` is written in the order of its names. A component block is a lookup table, so
its order states nothing, and the order the walk produced moved whenever an operation was added or
moved. A document kept in version control showed a diff nobody made.

A parameter's description stands on the parameter rather than on the schema under it. OpenAPI holds
one in both places and a generator reads the parameter's own. A reference keeps whatever its component
says, because that sentence belongs to the component rather than to one use of it.

### Fixed

A list of admitted values admitting null accepted less in 3.0 than in 3.1. Null reached the list and
`nullable` did not reach the type beside it, so the type turned away a value the list admitted.
Nothing could reach this before, because no list of values carried a type.

## 0.1.1

### Fixed

Every package names `./package.json` in its `exports`. A subpath a package does not name is a
subpath Node refuses, so a build tool that read a dependency's version or its `type` threw
`ERR_PACKAGE_PATH_NOT_EXPORTED`.

Every package states `keywords`, `homepage`, and `bugs`. Registry search reads `keywords` and reads
no other field that way, so `0.1.0` was reachable by its exact name and by nothing else.

## 0.1.0

The first published version.

### Added

Nine packages. `@fasciajs/core` holds the term, the reading it is built from, and the departures a
target reports.

Four frontends read a schema into that term: `@fasciajs/zod`, `@fasciajs/arktype`,
`@fasciajs/effect`, and `@fasciajs/valibot`.

Four targets write the term down: `@fasciajs/json-schema` as JSON Schema 2020-12,
`@fasciajs/openapi` as an OpenAPI 3.1 or 3.0 document, `@fasciajs/atd` as an Arri Type Definition,
and `@fasciajs/mcp` as Model Context Protocol tool definitions.

A spelling states three outcomes rather than two. A target says what the term states, or says less
and stays sound, or cannot say it at all. Only the third is a failure. Each departure states a
direction, and `refusing` lets a caller decide which direction stops a build.

A schema states two shapes where a default or a codec makes the input side and the output side
differ. A document holding both sides holds both shapes, and nothing is written into the schema to
say so.

### Not published

`@fasciajs/dynamodb` is in the repository and reaches no registry. The package writes a term as the
AttributeValue members a value may take, and it is not ready.

### Known

Every package publishes ESM only. `@fasciajs/arktype` could not publish CommonJS in any case,
because it reads `constraintKinds` from `@ark/schema` at run time, and `@ark/schema` publishes ESM
only.

A consumer who installs `@fasciajs/core` beside a target can hold two copies of core, because a
caret range does not span a minor below `1.0`. Two copies cost size and nothing else. Every
`instanceof` in this library tests a built-in rather than a class the library exports, so no check
answers wrong across the two.
