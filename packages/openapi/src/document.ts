import type {
  Ask,
  Departure,
  Described,
  Naming,
  Source,
  Spelled,
  Spelling,
  UndescribableSchema
} from '@fasciajs/core'
import { describeAll, isError, UnsayableTerm, under } from '@fasciajs/core'
import { refsAt, spellJsonSchema } from '@fasciajs/json-schema'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'
import { discriminating } from './discriminator.js'
import type { V31 } from './openapi.js'
import { toV30 } from './v30.js'

/**
 * A set of operations, written as an OpenAPI 3.1 document.
 *
 * **The schema half is already written and already measured.** An OpenAPI 3.1 schema is a JSON
 * Schema 2020-12 schema, so this target spells nothing itself: it asks the 2020-12 target and moves
 * the references to where a document keeps them. What is here is the envelope, which is the same job
 * the arri app definition does and a different shape.
 *
 * Three things OpenAPI states that arri does not. An operation has one request body and several
 * responses, so a position is not one of a pair. A name in `components.schemas` is held to a
 * pattern, so this is the first target that refuses a name. And a caller sends part of a request
 * outside the body, in the path, the query string, a header or a cookie.
 */

/**
 * A 2020-12 schema, as OpenAPI's own declaration names it.
 *
 * **One cast, here, and it is between two vendors declaring one thing.** An OpenAPI 3.1 schema is a
 * JSON Schema 2020-12 schema, and `json-schema-typed` and `openapi-types` each declare that shape
 * without knowing about the other. Nothing is widened: the value is the one the 2020-12 target
 * wrote, and this states which of the two declarations the document holds it under.
 */
function asSchemaObject(written: JSONSchema): V31.SchemaObject {
  return written as V31.SchemaObject
}

/**
 * A parameter, holding the schema the 2020-12 target wrote.
 *
 * **One cast, here, because the declaration is wrong about one field.** openapi-types declares the
 * 3.1 parameter as the 3.0 one, so its `schema` is a 3.0 schema and refuses an exclusive bound
 * written as a number. A 3.1 parameter holds a 2020-12 schema, which is the same value this file
 * already puts under `content` without a cast. Nothing is widened, and the fields OpenAPI states
 * about a parameter rather than about its schema are named here.
 */
function asParameter(stated: {
  readonly name: string
  readonly in: Location
  readonly required: boolean
  readonly schema: V31.SchemaObject | V31.ReferenceObject
}): V31.ParameterObject {
  return stated as V31.ParameterObject
}

/** Where an OpenAPI document keeps the schemas its operations refer to. */
export const COMPONENTS = '#/components/schemas/'

/** What a name may be, which OpenAPI states as a pattern on the keys of `components.schemas`. */
const NAME = /^[a-zA-Z0-9._-]+$/

/**
 * Which dialect a document is written in.
 *
 * The one place this library chooses between them. 3.1 holds a 2020-12 schema unchanged and 3.0
 * holds one of its own, so a schema is translated once, here, and nothing below this line asks which
 * dialect it is writing for.
 */
export type Version = '3.1' | '3.0'

/** What a media type is where a caller states none. */
const JSON_MEDIA_TYPE = 'application/json'

/** What OpenAPI states about a response rather than about the value it carries. */
interface ResponseFacts {
  /**
   * What this response is, which OpenAPI requires of every response.
   *
   * Where a response carries a body, the body is what a caller was mainly saying, so this may stay
   * unstated and the status is written instead. Where a response carries no body, this is all there
   * is, so a caller states it.
   */
  readonly description?: string
  /** The media type the body is written in. `application/json` where a caller states none. */
  readonly mediaType?: string
  readonly headers?: Record<string, V31.ReferenceObject | V31.HeaderObject>
  readonly links?: Record<string, V31.ReferenceObject | V31.LinkObject>
}

/**
 * One response, and everything OpenAPI states beside its schema.
 *
 * **Every field but `schema` is a fact a caller holds and no schema carries.** A description, the
 * headers a response sets, the links it offers and the media type it is written in are about the
 * response rather than about the value, so nothing in a validator states any of them. A document that
 * invents one says something the caller did not.
 *
 * **A response either carries a body or describes itself, and the two arms say which.** A response
 * with no body is a real thing: a 204 states a description and nothing under `content`. Written as
 * one shape with both fields optional, this would be a weak type, and a validator's own schema
 * satisfies a weak type by carrying a `description` of its own. A caller handing over the schema
 * where this stands would compile, describe nothing, and produce a response with no content and no
 * departure to report it. The arms make that call a type error instead.
 */
export type ResponseSpec<S> =
  | ({ readonly schema: S } & ResponseFacts)
  | ({ readonly schema?: undefined; readonly description: string } & Omit<
      ResponseFacts,
      'description'
    >)

/** The responses an operation answers with, keyed by status. */
export type Responses<S> = Readonly<Record<string, ResponseSpec<S>>>

/**
 * What a caller sends outside the body, grouped by where a caller puts it.
 *
 * **One object for each place, rather than a list of parameters.** OpenAPI states a name, a place and
 * a schema for every parameter, and no validator holds that shape. What a caller has is an object
 * whose keys are the names and whose edge says which of them may be absent, which is every part but
 * the place. The place is the key here, so nothing is stated twice.
 *
 * Each is described as the input side, because a parameter is something a caller sends.
 */
export interface RequestParameters<S> {
  readonly path?: S
  readonly query?: S
  readonly header?: S
  readonly cookie?: S
}

/** The four places OpenAPI reads a parameter from, in the order a document writes them. */
const LOCATIONS = ['path', 'query', 'header', 'cookie'] as const

/** One of the four places. */
type Location = (typeof LOCATIONS)[number]

/** One operation, and the schemas at its ends. */
export interface Operation<S> {
  readonly path: string
  /**
   * The method, as the words rather than as the enum.
   *
   * openapi-types declares these as a TypeScript enum, so a caller would have to import it to write
   * one. The template literal takes the values, and `post` states what `HttpMethods.POST` states.
   */
  readonly method: `${V31.HttpMethods}`
  readonly operationId?: string
  readonly summary?: string
  readonly description?: string
  readonly deprecated?: boolean
  /** What a caller sends outside the body. Each object's properties are the parameters. */
  readonly parameters?: RequestParameters<S>
  /** What a caller sends. Described as the input side. */
  readonly body?: S
  /**
   * Whether a request must carry a body.
   *
   * **A stated body is required unless a caller says otherwise.** OpenAPI reads an absent `required`
   * as false, so a document that says nothing says a request may omit the body. A caller who states
   * a body schema and nothing else means the other thing, and a generated client built from the
   * default holds a call that the service refuses every time.
   *
   * Written whichever way it lands, so no reader has to know which way OpenAPI defaults.
   */
  readonly bodyRequired?: boolean
  /** The media type the body is written in. `application/json` where a caller states none. */
  readonly bodyMediaType?: string
  /** What comes back, keyed by status. Each is described as the output side. */
  readonly responses?: Responses<S>
  /**
   * The groups this operation belongs to.
   *
   * A generator reads these to divide a client into one file per group. An operation naming none
   * lands in whatever the generator calls the rest, so a document that states no tag at all becomes
   * one flat client.
   */
  readonly tags?: readonly string[]
  /**
   * What a caller must present, as an alternative list: any one of these admits the request.
   *
   * Each names a scheme under `securitySchemes` and states the scopes it needs. An empty list here
   * says this one operation needs nothing, which is how a document exempts a login from the
   * requirement the rest of it states.
   */
  readonly security?: readonly V31.SecurityRequirementObject[]
}

/**
 * An operation a service calls rather than one it answers.
 *
 * A webhook is a path item under a name of its own, so it is an operation with the name where the
 * path stood. Everything else about it is the same, and it is described the same way.
 */
export type Webhook<S> = Omit<Operation<S>, 'path'>

/** The webhooks a service calls, keyed by the name a document holds each one under. */
export type Webhooks<S> = Readonly<Record<string, Webhook<S>>>

/**
 * What a document states about itself, beside the operations it holds.
 *
 * **Each of these is a fact a caller holds and no schema carries.** A scheme a request authenticates
 * under, the groups a client divides itself by, and the operations a service calls rather than
 * answers are all about the service. Nothing in a validator states any of them, and a document
 * without them describes a service that needs no credential and has one flat client.
 */
export interface DocumentSpec<S> {
  /** The groups an operation names, with a description of each. */
  readonly tags?: readonly V31.TagObject[]
  /** What every operation requires, where the operation states nothing of its own. */
  readonly security?: readonly V31.SecurityRequirementObject[]
  /** The schemes an operation's requirement names. A requirement naming no scheme resolves to none. */
  readonly securitySchemes?: Record<string, V31.ReferenceObject | V31.SecuritySchemeObject>
  /** The operations a service calls. 3.1 only, because 3.0 has no keyword for one. */
  readonly webhooks?: Webhooks<S>
}

/** A document, or the reason there is none. */
export type OperationSpelling = Spelling<V31.Document> | UndescribableSchema

export function spellOpenApi<S>(
  operations: readonly Operation<S>[],
  source: Source<S>,
  naming: Naming<S>,
  info: V31.InfoObject,
  version: Version = '3.1',
  document: DocumentSpec<S> = {}
): OperationSpelling {
  const hooks = Object.entries(document.webhooks ?? {})

  // 3.0 has no `webhooks`, and a set of operations written nowhere is worse than a refusal: a caller
  // who stated them would publish a document that describes a service half its size.
  if (version === '3.0' && hooks.length > 0) {
    return new UnsayableTerm(
      ['webhooks'],
      `this states ${hooks.length === 1 ? 'a webhook' : `${hooks.length} webhooks`}, and 3.0 has no keyword for one. Write the document as 3.1, or state the webhooks somewhere a 3.0 reader looks`
    )
  }

  const held: Held<S>[] = [
    ...operations.map((operation) => ({ holder: 'path' as const, operation })),
    ...hooks.map(([name, webhook]) => ({
      holder: 'webhook' as const,
      operation: { ...webhook, path: name }
    }))
  ]

  const positions = positionsOf(held)

  const described = describeAll(
    positions.map((position) => position.ask),
    source,
    naming
  )
  if (isError(described)) {
    return described
  }

  const departures: Departure[] = []
  const schemas: Record<string, V31.SchemaObject> = {}

  for (const [name, term] of byName(described.definitions)) {
    if (!NAME.test(name)) {
      return new UnsayableTerm(
        [name],
        `OpenAPI holds a component under a name of letters, digits, a dot, a dash or an underscore, and this one is called ${name}. Give the schema another name`
      )
    }

    const spelled = spellJsonSchema(term)
    if (isError(spelled)) {
      return spelled
    }

    const said = inDialect(refsAt(spelled.written, COMPONENTS), version)
    const shown = discriminating(
      { written: asSchemaObject(said.written), departures: spelled.departures },
      term,
      described.definitions,
      COMPONENTS
    )

    schemas[name] = shown.written
    departures.push(...under(name, [...shown.departures, ...said.departures]))
  }

  const written: AtPosition[] = []
  for (const [index, position] of positions.entries()) {
    const term = described.terms[index]
    if (term === undefined) {
      throw new Error('a position was described as nothing')
    }

    if (position.in !== undefined) {
      const built = parametersOf(term, position.in, position.path, described.definitions, version)
      if (isError(built)) {
        return built
      }

      written.push({ of: 'parameters', parameters: built.written })
      departures.push(...under(`${position.method} ${position.path}`, built.departures))
      continue
    }

    const spelled = spellJsonSchema(term)
    if (isError(spelled)) {
      return spelled
    }

    const said = inDialect(refsAt(spelled.written, COMPONENTS), version)
    const shown = discriminating(
      { written: asSchemaObject(said.written), departures: spelled.departures },
      term,
      described.definitions,
      COMPONENTS
    )

    written.push({ of: 'schema', schema: shown.written })
    departures.push(
      ...under(`${position.method} ${position.path}`, [...shown.departures, ...said.departures])
    )
  }

  const webhooks = itemsOf(held, positions, written, 'webhook')

  // `components` holds two maps now, so it is written where either has something in it. Written empty
  // it would state that a document holds components and name none.
  const components: V31.ComponentsObject = {
    ...(Object.keys(schemas).length > 0 && { schemas }),
    ...(document.securitySchemes !== undefined && { securitySchemes: document.securitySchemes })
  }

  return {
    written: {
      openapi: version === '3.1' ? '3.1.0' : '3.0.3',
      info,
      ...(document.tags !== undefined && { tags: [...document.tags] }),
      ...(document.security !== undefined && { security: [...document.security] }),
      paths: itemsOf(held, positions, written, 'path'),
      ...(Object.keys(webhooks).length > 0 && { webhooks }),
      ...(Object.keys(components).length > 0 && { components })
    },
    departures
  }
}

/**
 * Which of the two maps a path item belongs to.
 *
 * `paths` and `webhooks` hold the same shape under different keys, so one builder writes both and a
 * position says which. Held in the key as well, because a webhook may be named for a path and the two
 * would otherwise be one entry.
 */
type Holder = 'path' | 'webhook'

/** One operation, with the name the document holds it under. */
interface Held<S> {
  readonly holder: Holder
  readonly operation: Operation<S>
}

interface Position<S> {
  readonly holder: Holder
  readonly path: string
  readonly method: string
  /** The request body, the status a response answers under, or the place a parameter stands. */
  readonly at: string
  /**
   * Set where this position holds parameters rather than one schema.
   *
   * The place is what tells the two apart, and a position holding parameters is divided into several
   * where one holding a body stays one.
   */
  readonly in?: Location
  readonly ask: Ask<S>
}

/**
 * What a position put in the document.
 *
 * A body and a response each hold one schema. A place a parameter stands holds a list, because the
 * properties of one object are several parameters.
 */
type AtPosition =
  | { readonly of: 'schema'; readonly schema: V31.SchemaObject }
  | { readonly of: 'parameters'; readonly parameters: readonly V31.ParameterObject[] }

/**
 * Every schema a document holds, with the side its position gives it.
 *
 * A request body is what a caller sends and a response is what comes back, so a side comes from a
 * position. An operation has one of the first and any number of the second, which is where this
 * differs from a procedure.
 */
function positionsOf<S>(held: readonly Held<S>[]): Position<S>[] {
  const positions: Position<S>[] = []

  for (const { holder, operation } of held) {
    const where = { holder, path: operation.path, method: operation.method }

    for (const location of LOCATIONS) {
      const schema = operation.parameters?.[location]
      if (schema !== undefined) {
        positions.push({ ...where, at: location, in: location, ask: { schema, io: 'input' } })
      }
    }

    if (operation.body !== undefined) {
      positions.push({ ...where, at: 'body', ask: { schema: operation.body, io: 'input' } })
    }

    // A response carrying no body is described as nothing, because there is no value to describe.
    for (const [status, response] of Object.entries(operation.responses ?? {})) {
      if (response.schema !== undefined) {
        positions.push({ ...where, at: status, ask: { schema: response.schema, io: 'output' } })
      }
    }
  }

  return positions
}

/**
 * The definitions in the order a document writes them, which is by name.
 *
 * **A component block is a lookup table, and the order of a lookup table states nothing.** What the
 * walk produced is the order it met each name, with one whole side before the other, so two names
 * that split sit apart and a name's two sides do not.
 *
 * Sorted because this document is generated and kept. Insertion order is stable for one input and
 * moves for another: adding an operation, or moving one, reorders names that did not change, and a
 * diff then shows work nobody did. By name, a diff holds what a caller altered and nothing else.
 *
 * By code point rather than by locale, so the order does not follow the machine that wrote it.
 */
function byName(definitions: ReadonlyMap<string, Described>): [string, Described][] {
  return [...definitions].sort(([one], [other]) => (one < other ? -1 : one > other ? 1 : 0))
}

/** A schema as the chosen dialect says it. 3.1 says what 2020-12 says, so it says nothing more. */
function inDialect(written: JSONSchema, version: Version): Spelled<JSONSchema> {
  return version === '3.1' ? { written, departures: [] } : toV30(written)
}

/**
 * The parameters one object states, one for each property the object names.
 *
 * **The object is spelled whole and then divided, rather than a property at a time.** A value that
 * stands in where a key is absent belongs on that key's schema, and the 2020-12 target decided that
 * already. Dividing what it wrote keeps the decision in one place, and a property whose own schema
 * has a name stays a reference to the component holding it.
 *
 * A caller who named the object gets a component for it as well. The name was theirs to give, and
 * nothing here can tell whether something else refers to it.
 */
function parametersOf(
  term: Described,
  location: Location,
  path: string,
  definitions: ReadonlyMap<string, Described>,
  version: Version
): Spelling<readonly V31.ParameterObject[]> {
  // A caller who named the object gets a reference, and the properties are in the body it names.
  const stated = term.kind === 'ref' ? definitions.get(term.name) : term

  if (stated === undefined || stated.kind !== 'typed' || stated.name !== 'object') {
    const said = stated === undefined ? 'a reference to nothing' : `a ${stated.kind}`
    return new UnsayableTerm(
      [location],
      `the ${location} parameters are the properties of an object, and this states ${said}. Describe an object whose keys are the parameter names`
    )
  }

  if (stated.admitsNull) {
    return new UnsayableTerm(
      [location],
      `the ${location} parameters admit null, and a request carries no null where a list of parameters stands. Describe an object whose properties may be absent instead`
    )
  }

  const spelled = spellJsonSchema(stated)
  if (isError(spelled)) {
    return spelled
  }

  const said = inDialect(refsAt(spelled.written, COMPONENTS), version)
  const object = asSchemaObject(said.written)
  const required = new Set(object.required ?? [])
  const templated = templateOf(path)

  const parameters: V31.ParameterObject[] = []
  for (const [name, schema] of Object.entries(object.properties ?? {})) {
    // OpenAPI states that a path parameter is required, and a reader meeting an absent one would have
    // no path to read. A key that may be absent says the other thing, so the two disagree.
    if (location === 'path' && !required.has(name)) {
      return new UnsayableTerm(
        [location, name],
        `${name} stands in the path and may be absent, and a path has no form without it. Make ${name} required`
      )
    }

    // A path parameter fills a template expression. One that fills nothing is read by nobody, and the
    // expression it was written for stays in the path unfilled.
    if (location === 'path' && !templated.has(name)) {
      return new UnsayableTerm(
        [location, name],
        `${name} stands in the path and ${path} holds no {${name}} for it to fill. Name the parameter as the path writes it`
      )
    }

    parameters.push(asParameter({ name, in: location, required: required.has(name), schema }))
  }

  return { written: parameters, departures: [...spelled.departures, ...said.departures] }
}

/** The names a path holds as template expressions, which a path parameter fills one of. */
function templateOf(path: string): ReadonlySet<string> {
  const names = new Set<string>()
  for (const match of path.matchAll(/\{([^{}]+)\}/g)) {
    const name = match[1]
    if (name !== undefined) {
      names.add(name)
    }
  }
  return names
}

/**
 * The operations of one holder, grouped under the name each is reached at.
 *
 * `paths` and `webhooks` are the same shape under different keys, so this writes either and the
 * holder says which. A caller asking for both gets two calls and one set of positions.
 */
function itemsOf<S>(
  held: readonly Held<S>[],
  positions: readonly Position<S>[],
  written: readonly AtPosition[],
  holder: Holder
): Record<string, V31.PathItemObject> {
  const at = new Map<string, AtPosition>()
  for (const [index, position] of positions.entries()) {
    const one = written[index]
    if (one !== undefined) {
      at.set(`${position.holder} ${position.method} ${position.path} ${position.at}`, one)
    }
  }

  /** The one schema a position holds, where the position holds a schema at all. */
  const schemaAt = (key: string): V31.SchemaObject | undefined => {
    const one = at.get(key)
    return one?.of === 'schema' ? one.schema : undefined
  }

  const paths: Record<string, V31.PathItemObject> = {}
  for (const { operation } of held.filter((one) => one.holder === holder)) {
    const where = `${holder} ${operation.method} ${operation.path}`
    const body = schemaAt(`${where} body`)

    // The four places in one list, in the order the constant names them, so a document does not
    // reorder itself when a caller states them another way.
    const parameters: V31.ParameterObject[] = []
    for (const location of LOCATIONS) {
      const one = at.get(`${where} ${location}`)
      if (one?.of === 'parameters') {
        parameters.push(...one.parameters)
      }
    }

    const responses: Record<string, V31.ResponseObject> = {}
    for (const [status, response] of Object.entries(operation.responses ?? {})) {
      const schema = schemaAt(`${where} ${status}`)
      responses[status] = {
        // OpenAPI requires a description on a response, and a document without one is refused by
        // the meta-schema. The status is what a caller was told, so it stands where they said nothing.
        description: response.description ?? `the ${status} response`,
        ...(response.headers !== undefined && { headers: response.headers }),
        ...(response.links !== undefined && { links: response.links }),
        ...(schema !== undefined && {
          content: { [response.mediaType ?? JSON_MEDIA_TYPE]: { schema } }
        })
      }
    }

    paths[operation.path] = {
      ...paths[operation.path],
      [operation.method]: {
        ...(operation.operationId !== undefined && { operationId: operation.operationId }),
        ...(operation.summary !== undefined && { summary: operation.summary }),
        ...(operation.description !== undefined && { description: operation.description }),
        ...(operation.deprecated !== undefined && { deprecated: operation.deprecated }),
        ...(operation.tags !== undefined && { tags: [...operation.tags] }),
        // An empty list is a statement: this operation requires nothing where the document requires
        // something. So the key is written wherever a caller stated one, and length decides nothing.
        ...(operation.security !== undefined && { security: [...operation.security] }),
        ...(parameters.length > 0 && { parameters }),
        ...(body !== undefined && {
          requestBody: {
            required: operation.bodyRequired ?? true,
            content: { [operation.bodyMediaType ?? JSON_MEDIA_TYPE]: { schema: body } }
          }
        }),
        responses
      }
    }
  }

  return paths
}
