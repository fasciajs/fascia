# Changelog

Every published package here carries one version, so one entry covers all of them. A package that
did not change in a release still takes the release's number, because ten packages that are ten
readings of one core have nothing to say by moving apart.

## 0.4.1

### Fixed

**An intersection admitted null where one member did.** A null member was taken out of a combination
and null admitted beside the rest, for every law. That is what a disjunction means. An intersection
holds every member at once, so `A & null` became `A` admitting null, which admits every A, and the
same move made `admitsNull` the disjunction of the members where an intersection needs the
conjunction. A document written from one took what the schema refuses, and no departure named it,
because the loss was in the reading.

**`@fasciajs/arktype` could not read an array whose element states nothing.** arktype records a
constraint and `unknown` is none, so `type('unknown[]').atLeastLength(1)` carries a proto and a
length and no structure node, and the reader had a shape only for the form that carries one. A
caller writing that got no document at all. It is a list of anything with that length.

**`@fasciajs/arktype` read an exact length on an array as an upper bound alone.** So
`type('string[]').exactlyLength(2)` wrote a document taking the empty list. An exact length is both
bounds, which is how a string's was read already.

**`@fasciajs/openapi` wrote a 3.0 schema admitting null where 3.0 reads no null.** OpenAPI 3.0 says
`nullable` "only takes effect if `type` is explicitly defined within the same Schema Object". A
reference admitting null was written `{ allOf: [{ $ref }], nullable: true }`, and null was pushed as a
flag onto a schema with no type, so the document refused null, and Ajv refused to compile it. The flag
is now written only beside a type with nothing that could refuse null. Anywhere else the schema is
joined to `{ enum: [null] }`, which is exact. A disjunction of exactly one admitting null was widened
to any of several before, and is exact now.

**`@fasciajs/json-schema` wrote null twice in an `enum`** where the values held null and the term
admitted it too. An `enum` holding a value twice is no schema, and Ajv refused to compile it.

**`@fasciajs/json-schema` wrote a definition named with `/` or `~` under a reference that missed it.**
A pointer escapes both characters, and the reference was written unescaped, so Ajv refused the
document. One pair of functions now writes a pointer and reads one.

### Added

**`@fasciajs/json-schema` reads a document as well as writing one.** `jsonSchemaSource` is a frontend
over 2020-12, so a validator that writes its own document becomes a frontend through it rather than
through a reading of its internals. `~standard.jsonSchema` is that interface where a validator states
one.

It brings the round trip this repository never had. What this library writes, it writes the same
after reading it, over every document written from every frontend here, and a term read from a
document admits what the document admits.

A `$ref` is read under the name it points at, so a document holding itself is described the way a
schema that holds itself is. `uniqueItems` is read as a set, because that is the document this
library writes for one.

A schema is read as every keyword it states at once, because that is what 2020-12 means by one. A
type beside a disjunction holds in each member, a reference beside an assertion is held to both,
and a count past the positions of a tuple is unrolled into positions. A keyword no term has a word
for is refused rather than dropped, and so is an assertion stated under no type, which admits every
value of another type. Dropped, either one would read a term wider than the document.

A document stating draft-04, draft-06, draft-07 or 2019-09 in `$schema` is read too, by stating it
again in 2020-12 where it enters. Before 2020-12 a tuple is `items: [...]` with `additionalItems`,
and in draft-04 an exclusive bound is a boolean beside `minimum` or `maximum`. Two things a dialect
does not settle are refused, because the dialect says to ignore them and Ajv asserts them, so the
document admits two sets of values: a keyword the dialect does not know, and before 2019-09 an
assertion beside a `$ref`. A boolean bound in a document naming no draft-04 is refused, where it was
read as absent and admitted the bound itself.

A `$ref` under an `$id` below the root is refused. Such a reference resolves against that `$id`, and
the reader resolves every reference against the root, so it read a definition the document does not
name. An `$id` that holds no reference is read, which is how effect writes one.

The round trip reads only what this library writes, and this library writes one family of keywords
per schema. So the documents arktype, zod, effect and valibot write are read too, and the term
agrees with Ajv over every one read. zod writes a schema holding itself at the root as `$ref: "#"`,
and a root has no name to refer to, so those three are refused.

arri is the first library this shows. It states Standard Schema and writes its own document, and
nothing here ever read an arri schema: `@fasciajs/atd` writes ATD and has no reading of it. It is
described now by a package that was already here.

### Changed

**A dialect is named, never assumed.** `spellJsonSchemaAll` writes `$schema` at the root of every
document, because a document naming no dialect reads differently in each and a reader chooses one in
silence. `jsonSchemaAt` takes the dialect as an argument, and refuses a `$schema` that disagrees with
it or that names no dialect read here. `spellJsonSchema` writes one schema for a document to hold,
and states no `$schema`, because the document holding it names the dialect.

OpenAPI 3.0 is a dialect read, named `oas-3.0`. Its Schema Object states no `$schema`, so the caller
names it. `nullable` joins null to the one type beside it, an exclusive bound is a boolean, and a type
list, a list in `items`, `nullable` with no type and a keyword 3.0 does not mention are refused.

The OpenAPI 3.1 dialect is one of the dialects read, named `oas-3.1`, by `/dialect/base` and by its
dated `$id`. It asserts what 2020-12 asserts: its four keywords describe, and the specification says
a discriminator must not change a verdict.

**`@fasciajs/arktype` reads a union it can tell apart by a key as an exclusive one.** arktype states
no exclusive union of its own and tells the members of any union apart wherever it can, and the
answer is on the node. A tag at one key is the form a document names, so a union carrying one
excludes its members, and says which key says so, where each member has a case of its own. Two
members sharing a tag can both take one value, and arktype tries both, so that union stays `anyOf`. A `domain` discriminant tells a
string from a number and names no key, and a tag nested inside a member is not one a document can
state, so neither is read.

What changes: 2020-12 writes `oneOf` where it wrote `anyOf`, OpenAPI writes a `discriminator` beside
it, and ATD writes the discriminator form where it refused the schema outright, because a
disjunction it cannot choose by a tag has no ATD form at all. Every one of those accepts the values
it accepted before, where it accepted anything.

### Not published

**`@fasciajs/aws-filter` writes a term as the filter policy SNS and SQS deliver a message by.** The
scope is a required argument, because SNS attributes, SNS bodies, SQS bodies and SQS attributes each
take a different grammar. A tagged union becomes `$or` over the tag, and a union of objects under a
key becomes `$or` under the key. An optional key gets `exists: false`, a range becomes a numeric
condition, a pattern held to one end becomes a prefix or a suffix, and any string in a body becomes
`prefix: ""`. A policy is never narrower than its schema, and each place it is wider is a departure. A
policy that AWS would refuse is not written.

AWS answered for this target. lambada measured which policies SNS and Lambda take, and which messages
each policy delivered, and measured again for each rule the writer needed that no row recorded. A
matching function and an acceptance model are held to every recorded row,
and then every policy written from all four validators is held to both. The package is private
until a caller uses it.

The 3.0 checks asked Ajv about a 2020-12 schema recovered from 3.0 by a translation written in the
specs, because Ajv was taken to have no `nullable`. It has one, and holds it as OpenAPI 3.0 states
it. The translation read the flag wherever it stood, so it compiled the document the writer got
wrong, and the check passed over the defect. The 3.0 document is now asked of Ajv directly, and the
translation is deleted.

Nothing else here reaches a registry, and what is here is why the two above were found.

The reader knows a keyword from one table, and the lists the reader and the translation ask are
derived from the table. A spec holds the table to the meta-schema each dialect publishes.

A schema that holds itself is drawn from every frontend, and two that hold each other reach the
specs. Recursion was described before this release and is described the same way after it.

An intersection is drawn over drawn members rather than over two fixed objects, an exclusive union
over drawn members rather than only as a discriminated union of tagged objects, and a name stands on
a drawn schema rather than only on one that holds itself. All three came from counting which shapes
nest inside which: of 104 pairings, 53 were ever drawn, and the first of the two fixes above was in
the half nothing reached. 82 are drawn now, and 20 of the 22 left are the set nothing produces.

## 0.4.0

### Added

**A term can answer for itself.** `admits(description, value)` in `@fasciajs/core` says whether a term
takes a value, or reports that it does not decide. A `format` is the one thing it will not decide,
because deciding an email means writing the validator this library refuses to be.

Until now nothing could ask a term anything. Every check asked a validator and a document, and one
number carried two questions: whether the frontend read the schema, and whether the target wrote the
term. A finding named neither.

`@fasciajs/json-schema` is measured against arktype, zod and effect writing 2020-12 from their own
schemas, which is the pair of steps this library performs with a frontend and a target. That asks
what a document should be rather than whether a value passes, and it found the tuple defect below.
This library differs from none of the three.

### Changed

**A set is a case of the term.** It was a list carrying `unique`, which is a predicate: no item is
held twice. A set is a quotient, because a position is not part of the value. `unique` is gone from a
list and `set` is a case beside `array` in `Node` and in `Described`, so a multiset cannot be written
and every target says what it does with one. 2020-12 writes `uniqueItems` and reports the order it
adds; ATD gives up both halves, in two directions.

**A tuple states how many positions must be present.** `minPositions` is on the node and on the term,
and every frontend states it the way each already lifts a key's optionality onto the edge. A count
rather than a flag on each position, because every validator here makes an optional position a
trailing one, and a flag would admit a required position after an optional one.

Both are a change to a published type. A caller who writes a frontend or a target of their own
answers for the new case and states the new count. A caller who describes a schema and writes a
document reads no difference, except that the documents are more exact.

A frontend refuses a validator's own set for a new reason. A parse of a list gives back a Set, so a
schema states a conversion rather than one value, and the term has a set that no reading produces.

### Fixed

**2020-12 wrote a tuple without `minItems`, so a document took the empty list against a tuple of one
position.** `prefixItems` states what stands at each position and nothing about how many are there.
The term threw the count away before the target saw it, and the departure reporting the loss named
the target rather than the reading. The target now reports no widening at all, for any frontend.

**`@fasciajs/effect` dropped the whole-number assertion.** `Schema.Int` annotates
`{ type: 'integer' }` and states nothing else, and the reader dropped a key it could not turn back
into something. It could turn that one back. A document took `1.5` where effect refused it, and no
departure recorded the widening, because the loss happened in the reading.

**`@fasciajs/zod` and `@fasciajs/valibot` demanded a tuple position their validator does not.** zod
checks a closed tuple against a length and one with a rest per position, so `z.tuple([z.unknown()])`
refuses the empty list and `z.tuple([z.unknown()], z.number())` takes it. valibot holds a tuple per
position throughout. Both readings are the validator's own now, and where two disagree the smaller
count is taken.

### Not published

`@fasciajs/dynamodb` is in the repository and reaches no registry. It is the same package it was, and
it is measured now: the AWS SDK marshaller reads what it writes, so the claim it makes is checkable.
A value the schema takes marshals to an attribute the description admits.

That check found three defects, all of them in this package alone. A disjunction was described as its
last member and refused a row matching its first. A tuple ignored what stands past its positions. A
title, a description, examples and a deprecation reached no attribute and no departure.

It writes a set exactly, under `SS` or `NS`, which is the one thing it says that every other target
here refuses. It is still not ready.

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
