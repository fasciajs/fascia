import type {
  Ask,
  Departure,
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
 * Two things OpenAPI states that arri does not. An operation has one request body and several
 * responses, so a position is not one of a pair. And a name in `components.schemas` is held to a
 * pattern, so this is the first target that refuses a name.
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

/** The schemas an operation answers with, keyed by status. */
export type Responses<S> = Readonly<Record<string, S>>

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
  /** What a caller sends. Described as the input side. */
  readonly body?: S
  /** What comes back, keyed by status. Each is described as the output side. */
  readonly responses?: Responses<S>
}

/** A document, or the reason there is none. */
export type OperationSpelling = Spelling<V31.Document> | UndescribableSchema

export function spellOpenApi<S>(
  operations: readonly Operation<S>[],
  source: Source<S>,
  naming: Naming<S>,
  info: V31.InfoObject,
  version: Version = '3.1'
): OperationSpelling {
  const positions = positionsOf(operations)

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

  for (const [name, term] of described.definitions) {
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

  const written: V31.SchemaObject[] = []
  for (const [index, position] of positions.entries()) {
    const term = described.terms[index]
    if (term === undefined) {
      throw new Error('a position was described as nothing')
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

    written.push(shown.written)
    departures.push(
      ...under(`${position.method} ${position.path}`, [...shown.departures, ...said.departures])
    )
  }

  return {
    written: {
      openapi: version === '3.1' ? '3.1.0' : '3.0.3',
      info,
      paths: pathsOf(operations, positions, written),
      ...(Object.keys(schemas).length > 0 && { components: { schemas } })
    },
    departures
  }
}

interface Position<S> {
  readonly path: string
  readonly method: string
  /** The request body, or the status a response answers under. */
  readonly at: string
  readonly ask: Ask<S>
}

/**
 * Every schema a document holds, with the side its position gives it.
 *
 * A request body is what a caller sends and a response is what comes back, so a side comes from a
 * position. An operation has one of the first and any number of the second, which is where this
 * differs from a procedure.
 */
function positionsOf<S>(operations: readonly Operation<S>[]): Position<S>[] {
  const positions: Position<S>[] = []

  for (const operation of operations) {
    const where = { path: operation.path, method: operation.method }

    if (operation.body !== undefined) {
      positions.push({ ...where, at: 'body', ask: { schema: operation.body, io: 'input' } })
    }

    for (const [status, schema] of Object.entries(operation.responses ?? {})) {
      positions.push({ ...where, at: status, ask: { schema, io: 'output' } })
    }
  }

  return positions
}

/** A schema as the chosen dialect says it. 3.1 says what 2020-12 says, so it says nothing more. */
function inDialect(written: JSONSchema, version: Version): Spelled<JSONSchema> {
  return version === '3.1' ? { written, departures: [] } : toV30(written)
}

/** The operations, grouped under the path each one is reached at. */
function pathsOf<S>(
  operations: readonly Operation<S>[],
  positions: readonly Position<S>[],
  written: readonly V31.SchemaObject[]
): V31.PathsObject {
  const at = new Map<string, V31.SchemaObject>()
  for (const [index, position] of positions.entries()) {
    const schema = written[index]
    if (schema !== undefined) {
      at.set(`${position.method} ${position.path} ${position.at}`, schema)
    }
  }

  const paths: Record<string, V31.PathItemObject> = {}
  for (const operation of operations) {
    const body = at.get(`${operation.method} ${operation.path} body`)

    const responses: Record<string, V31.ResponseObject> = {}
    for (const status of Object.keys(operation.responses ?? {})) {
      const schema = at.get(`${operation.method} ${operation.path} ${status}`)
      responses[status] = {
        // OpenAPI requires a description on a response, and a document without one is refused by
        // the meta-schema. The status is what a caller was told, so it is what is written.
        description: `the ${status} response`,
        ...(schema !== undefined && { content: { 'application/json': { schema } } })
      }
    }

    paths[operation.path] = {
      ...paths[operation.path],
      [operation.method]: {
        ...(operation.operationId !== undefined && { operationId: operation.operationId }),
        ...(operation.summary !== undefined && { summary: operation.summary }),
        ...(operation.description !== undefined && { description: operation.description }),
        ...(operation.deprecated !== undefined && { deprecated: operation.deprecated }),
        ...(body !== undefined && {
          requestBody: { content: { 'application/json': { schema: body } } }
        }),
        responses
      }
    }
  }

  return paths
}
