# Changelog

Every published package here carries one version, so one entry covers all of them. A package that
did not change in a release still takes the release's number, because ten packages that are ten
readings of one core have nothing to say by moving apart.

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

`RequestParameters` and `ResponseSpec` are exported.

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
