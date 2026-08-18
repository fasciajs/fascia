import { attest } from '@ark/attest'
import { arktypeSource } from '@fasciajs/arktype'
import type { SideNames } from '@fasciajs/core'
import { isError } from '@fasciajs/core'
import { effectSource } from '@fasciajs/effect'
import type { DocumentSpec, Operation, Responses, V31 } from '@fasciajs/openapi'
import { spellOpenApi } from '@fasciajs/openapi'
import { zodSource } from '@fasciajs/zod'
import { Validator } from '@seriousme/openapi-schema-validator'
import { type } from 'arktype'
import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'
import * as z from 'zod'

/**
 * A set of operations, written as an OpenAPI 3.1 document.
 *
 * **The schema half was already written and already measured.** A 3.1 schema is a 2020-12 schema, so
 * this target asks the 2020-12 one and moves the references. What is new is the envelope, and what
 * is new about the envelope is that an operation has one request body and several responses, so a
 * position is no longer one of a pair.
 *
 * **The OpenAPI meta-schema reads every document this spec builds.** A document its own maintainers
 * refuse is not a document, whatever the assertions below say about it.
 */

const sides: SideNames = { input: (name) => `${name}Input`, output: (name) => `${name}Output` }
const info: V31.InfoObject = { title: 'Users', version: '1' }

const validator = new Validator()

async function documentOf(
  operations: readonly Operation<z.core.$ZodType>[],
  document?: DocumentSpec<z.core.$ZodType>
) {
  const spelled = spellOpenApi(operations, zodSource, { sides }, info, '3.1', document)
  if (isError(spelled)) {
    throw new Error(spelled.message)
  }

  const verdict = await validator.validate(spelled.written as unknown as Record<string, unknown>)
  expect(verdict.errors ?? [], JSON.stringify(verdict.errors)).toEqual([])
  expect(verdict.valid).toBe(true)

  return spelled
}

describe('an operation names what it takes and what it answers with', () => {
  const User = z.object({ id: z.string(), role: z.string().default('reader') }).meta({ id: 'User' })

  it('writes a request body and a response under one path', async () => {
    const document = await documentOf([
      {
        path: '/users',
        method: 'post',
        operationId: 'createUser',
        body: User,
        responses: { '200': { schema: User } }
      }
    ])

    const operation = document.written.paths?.['/users']?.post
    expect(operation?.operationId).toBe('createUser')
    expect(operation?.requestBody).toEqual({
      required: true,
      content: { 'application/json': { schema: { $ref: '#/components/schemas/UserInput' } } }
    })
    expect(operation?.responses?.['200']).toEqual({
      description: 'the 200 response',
      content: { 'application/json': { schema: { $ref: '#/components/schemas/UserOutput' } } }
    })
  })

  it('splits one schema at two positions, because a default differs', async () => {
    const document = await documentOf([
      { path: '/users', method: 'post', body: User, responses: { '200': { schema: User } } }
    ])

    const schemas = document.written.components?.schemas
    expect(Object.keys(schemas ?? {}).sort()).toEqual(['UserInput', 'UserOutput'])
    // One body, and the two sides differ in `required` alone.
    const properties = { id: { type: 'string' }, role: { type: 'string', default: 'reader' } }
    expect(schemas?.['UserInput']).toEqual({ type: 'object', properties, required: ['id'] })
    expect(schemas?.['UserOutput']).toEqual({
      type: 'object',
      properties,
      required: ['id', 'role']
    })
  })

  it('answers with several statuses, which a procedure has no room for', async () => {
    // Where this differs from an arri procedure. A position is not one of a pair, and each response
    // is described as the output side.
    const Problem = z.object({ message: z.string() }).meta({ id: 'Problem' })

    const document = await documentOf([
      {
        path: '/users/{id}',
        method: 'get',
        responses: { '200': { schema: User }, '404': { schema: Problem } }
      }
    ])

    const responses = document.written.paths?.['/users/{id}']?.get?.responses
    expect(Object.keys(responses ?? {})).toEqual(['200', '404'])
    expect(responses?.['404']).toEqual({
      description: 'the 404 response',
      content: { 'application/json': { schema: { $ref: '#/components/schemas/Problem' } } }
    })
  })

  it('writes two methods under one path', async () => {
    const document = await documentOf([
      { path: '/users', method: 'get', responses: { '200': { schema: User } } },
      { path: '/users', method: 'post', body: User, responses: { '200': { schema: User } } }
    ])

    expect(Object.keys(document.written.paths?.['/users'] ?? {}).sort()).toEqual(['get', 'post'])
  })

  it('carries what a caller said about the operation', async () => {
    const document = await documentOf([
      {
        path: '/users',
        method: 'get',
        summary: 'every user',
        description: 'in no order',
        deprecated: true,
        responses: { '200': { schema: User } }
      }
    ])

    expect(document.written.paths?.['/users']?.get).toEqual({
      summary: 'every user',
      description: 'in no order',
      deprecated: true,
      responses: {
        '200': {
          description: 'the 200 response',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } }
        }
      }
    })
  })

  it('inlines a schema that has no name of its own', async () => {
    const document = await documentOf([
      {
        path: '/ping',
        method: 'get',
        responses: { '200': { schema: z.object({ at: z.string() }) } }
      }
    ])

    expect(document.written.paths?.['/ping']?.get?.responses?.['200']).toEqual({
      description: 'the 200 response',
      content: {
        'application/json': {
          schema: { type: 'object', properties: { at: { type: 'string' } }, required: ['at'] }
        }
      }
    })
    expect(document.written.components).toBeUndefined()
  })
})

describe('what OpenAPI refuses, and what this says instead', () => {
  it('refuses a name OpenAPI has no room for under components', async () => {
    // The first target that refuses a name. OpenAPI holds a component under a key matching
    // `^[a-zA-Z0-9._-]+$`, so a schema a caller named with a space cannot be written.
    const Spaced = z.object({ a: z.string() }).meta({ id: 'a user' })

    const spelled = spellOpenApi(
      [{ path: '/pets', method: 'get', responses: { '200': { schema: Spaced } } }],
      zodSource,
      { sides },
      info
    )

    expect(isError(spelled) ? spelled.message : 'written').toContain('a user')
  })

  it('reports what the schema half gave up, at the position that gave it up', async () => {
    const document = await documentOf([
      { path: '/pets', method: 'get', responses: { '200': { schema: z.tuple([z.string()]) } } }
    ])

    // The tuple widening the 2020-12 target reports, reaching a caller with the operation that
    // produced it in its path.
    expect(document.departures[0]).toEqual({
      at: ['get /pets'],
      direction: 'wider',
      cause: 'noWordForIt',
      said: expect.stringContaining('does not say which of them must be present')
    })
  })
})

describe('a document states what a service needs and how a client divides', () => {
  /**
   * **A credential, a group and a webhook are facts about the service.** No validator holds any of
   * them, so a document without them describes a service that needs no credential, has one flat
   * client, and calls nobody. The first is the one with teeth: a generated client with no scheme has
   * no way to authenticate at all.
   */
  const Pet = z.object({ id: z.string() }).meta({ id: 'Pet' })

  const bearer: V31.SecuritySchemeObject = { type: 'http', scheme: 'bearer' }

  it('divides the operations into the groups a generator makes files from', async () => {
    const document = await documentOf([
      {
        path: '/pets',
        method: 'get',
        tags: ['pets'],
        responses: { '200': { schema: Pet } }
      }
    ])

    expect(document.written.paths?.['/pets']?.get).toEqual({
      tags: ['pets'],
      responses: {
        '200': {
          description: 'the 200 response',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } }
        }
      }
    })
  })

  it('names the schemes a requirement resolves against', async () => {
    const document = await documentOf(
      [{ path: '/pets', method: 'get', responses: { '200': { schema: Pet } } }],
      { security: [{ bearer: [] }], securitySchemes: { bearer } }
    )

    expect(document.written.security).toEqual([{ bearer: [] }])
    expect(document.written.components?.securitySchemes).toEqual({ bearer })
    // The schemas stay where they were. `components` holds two maps and neither displaces the other.
    expect(Object.keys(document.written.components?.schemas ?? {})).toEqual(['Pet'])
  })

  it('lets one operation require nothing where the document requires something', async () => {
    // An empty list is a statement rather than an absence, so the key is written whatever its length.
    // This is how a document exempts a login from what the rest of it demands.
    const document = await documentOf(
      [
        {
          path: '/login',
          method: 'post',
          security: [],
          responses: { '200': { schema: z.string() } }
        },
        { path: '/pets', method: 'get', responses: { '200': { schema: Pet } } }
      ],
      { security: [{ bearer: [] }], securitySchemes: { bearer } }
    )

    expect(document.written.paths?.['/login']?.post).toEqual({
      security: [],
      responses: {
        '200': {
          description: 'the 200 response',
          content: { 'application/json': { schema: { type: 'string' } } }
        }
      }
    })
    // No `security` key, which the comparison states by holding the whole value. The operation takes
    // what the document requires, so stating anything here would be this operation overriding it.
    expect(document.written.paths?.['/pets']?.get).toEqual({
      responses: {
        '200': {
          description: 'the 200 response',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } }
        }
      }
    })
  })

  it('describes a webhook the same way, under a name instead of a path', async () => {
    const document = await documentOf([], {
      webhooks: {
        petAdopted: {
          method: 'post',
          body: Pet,
          responses: { '204': { description: 'taken' } }
        }
      }
    })

    // The body is described, so the schema is a component and the webhook refers to it like any
    // other operation. A webhook a caller wrote by hand would hold a schema nothing described.
    expect(document.written.webhooks?.['petAdopted']).toEqual({
      post: {
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } }
        },
        responses: { '204': { description: 'taken' } }
      }
    })
    expect(Object.keys(document.written.components?.schemas ?? {})).toEqual(['Pet'])
  })

  it('keeps a webhook apart from a path of the same name', async () => {
    // Both maps hold one shape under a caller's own key, so a name may stand in each. The two would
    // be one entry if a position were keyed by name and method alone.
    const document = await documentOf(
      [{ path: '/ready', method: 'post', body: Pet, responses: { '204': { description: 'p' } } }],
      {
        webhooks: {
          '/ready': { method: 'post', body: Pet, responses: { '204': { description: 'w' } } }
        }
      }
    )

    expect(document.written.paths?.['/ready']?.post?.responses?.['204']).toEqual({
      description: 'p'
    })
    expect(document.written.webhooks?.['/ready']).toEqual({
      post: {
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } }
        },
        responses: { '204': { description: 'w' } }
      }
    })
  })

  it('refuses a webhook in 3.0, which has no keyword for one', async () => {
    // Written nowhere, a caller publishes a document describing a service half its size. 3.1 states
    // webhooks and 3.0 does not, so this is the dialect refusing rather than the target giving up.
    const spelled = spellOpenApi(
      [{ path: '/pets', method: 'get', responses: { '200': { schema: Pet } } }],
      zodSource,
      { sides },
      info,
      '3.0',
      { webhooks: { ready: { method: 'post', responses: { '204': { description: 'x' } } } } }
    )

    expect(isError(spelled) ? spelled.message : 'written').toContain('3.0 has no keyword for one')
  })
})

describe('a use of a named schema may describe that use', () => {
  /**
   * **A shared type used in two places may want a sentence about one of them.** A document holds one
   * timestamp type, and one field holding that type is when a pet was last fed. Put on the component
   * the sentence describes every timestamp, and dropped it describes nothing, so it stands beside the
   * reference.
   *
   * 3.1 reads a keyword next to a `$ref` and 3.0 reads none, which is the one place these two dialects
   * disagree about a reference.
   */
  const Name = z.string().min(2).meta({ id: 'Name' })
  const described = z
    .string()
    .min(2)
    .meta({ id: 'Name', description: 'the name this caller sends' })
  const Holder = z.object({ plain: Name, said: described }).meta({ id: 'Holder' })

  it('states the sentence beside the reference, which 3.1 reads', async () => {
    const document = await documentOf([
      { path: '/pets', method: 'get', responses: { '200': { schema: Holder } } }
    ])

    expect(document.written.components?.schemas?.['Holder']).toEqual({
      type: 'object',
      properties: {
        plain: { $ref: '#/components/schemas/Name' },
        said: { $ref: '#/components/schemas/Name', description: 'the name this caller sends' }
      },
      required: ['plain', 'said']
    })
    // The component says nothing of its own, which the comparison states by holding the whole value.
    expect(document.written.components?.schemas?.['Name']).toEqual({ type: 'string', minLength: 2 })
  })

  it('moves it under a conjunction for 3.0, which reads no keyword beside a reference', async () => {
    const spelled = spellOpenApi(
      [{ path: '/pets', method: 'get', responses: { '200': { schema: Holder } } }],
      zodSource,
      { sides },
      info,
      '3.0'
    )
    if (isError(spelled)) {
      throw new Error(spelled.message)
    }

    expect((await validator.validate(spelled.written as never)).valid).toBe(true)
    expect(spelled.written.components?.schemas?.['Holder']).toEqual({
      type: 'object',
      properties: {
        plain: { $ref: '#/components/schemas/Name' },
        said: {
          allOf: [{ $ref: '#/components/schemas/Name' }],
          description: 'the name this caller sends'
        }
      },
      required: ['plain', 'said']
    })
  })

  it('reports the move, because the specification does not state it', async () => {
    const spelled = spellOpenApi(
      [{ path: '/pets', method: 'get', responses: { '200': { schema: Holder } } }],
      zodSource,
      { sides },
      info,
      '3.0'
    )
    if (isError(spelled)) {
      throw new Error(spelled.message)
    }

    expect(spelled.departures[0]).toEqual({
      at: ['Holder', 'properties/said'],
      direction: 'neither',
      cause: 'noShapeForIt',
      said: expect.stringContaining('3.0 reads no keyword there')
    })
  })
})

describe('a generated document is kept, so its order is its own', () => {
  /**
   * **A component block is a lookup table and its order states nothing, so a diff of one should hold
   * only what a caller altered.** The walk produces the order it met each name, one whole side before
   * the other. That is stable for one input and moves for another: an operation added or moved
   * reorders names nobody touched, and whoever reviews the document reads a change that is not one.
   */
  const Zebra = z.object({ a: z.string() }).meta({ id: 'Zebra' })
  const Apple = z.object({ a: z.string() }).meta({ id: 'Apple' })
  const Middle = z.object({ a: z.string(), d: z.string().default('x') }).meta({ id: 'Middle' })

  const zebra = {
    path: '/pets',
    method: 'post',
    body: Zebra,
    responses: { '200': { schema: Apple } }
  } as const
  const middle = {
    path: '/adoptions',
    method: 'post',
    body: Middle,
    responses: { '200': { schema: Middle } }
  } as const

  it('names the components in one order whatever order the operations arrive in', async () => {
    const one = await documentOf([zebra, middle])
    const other = await documentOf([middle, zebra])

    const names = ['Apple', 'MiddleInput', 'MiddleOutput', 'Zebra']
    expect(Object.keys(one.written.components?.schemas ?? {})).toEqual(names)
    expect(Object.keys(other.written.components?.schemas ?? {})).toEqual(names)
  })

  it('keeps the paths in the order the caller stated them, which is the callers to choose', async () => {
    // The other half of the same decision. A path order is a reading order somebody chose, and a
    // component order is not, so only the second is taken out of a caller's hands.
    //
    // The two paths are stated against their alphabetical order on purpose. Stated the other way this
    // would pass whether the paths were sorted or not, and would prove nothing about either.
    const document = await documentOf([zebra, middle])
    expect(Object.keys(document.written.paths ?? {})).toEqual(['/pets', '/adoptions'])
  })
})

describe('the type system refuses a response that describes nothing', () => {
  /**
   * **The shape a caller reaches for first is the one that must not compile.** A response held a
   * schema before this, so `responses: { '200': User }` is what an existing caller writes and what
   * anybody writes from memory.
   *
   * Written as one shape with `schema` and `description` both optional, `ResponseSpec` would be a weak
   * type, and a validator's schema satisfies a weak type by carrying a `description` of its own. That
   * call compiled, described nothing, and produced a response with no `content`. Every response-side
   * component vanished with it and no departure said so, because nothing was given up: nothing was
   * ever asked for.
   *
   * Through `attest` rather than `@ts-expect-error` alone, so the claim names the clause and a rename
   * cannot satisfy it.
   */
  it('refuses a schema where a response stands, which is the shape before this one', () => {
    const User = z.object({ id: z.string() })

    attest(() => {
      const responses = {
        // @ts-expect-error
        '200': User
      } satisfies Responses<z.core.$ZodType>
      return responses
    }).type.errors("Property 'schema' is missing")
  })

  it('refuses a response that carries neither a body nor a description', () => {
    // Nothing to write. OpenAPI requires a description, and a response with no schema has nothing
    // else to say, so the arms make the empty object a type error rather than an empty response.
    attest(() => {
      const responses = {
        // @ts-expect-error
        '204': {}
      } satisfies Responses<z.core.$ZodType>
      return responses
    }).type.errors("not assignable to type 'ResponseSpec")
  })
})

describe('a response states what no schema carries', () => {
  /**
   * **A description, the headers, the links and the media type are facts about the response.** None of
   * them is a fact about the value, so no validator holds any of them and a document that invents one
   * says something the caller did not. Each is stated beside the schema instead.
   */
  it('writes the description the caller gave, rather than one built from the status', async () => {
    const document = await documentOf([
      {
        path: '/pets',
        method: 'get',
        responses: { '200': { schema: z.string(), description: 'a pet name' } }
      }
    ])

    expect(document.written.paths?.['/pets']?.get?.responses?.['200']).toEqual({
      description: 'a pet name',
      content: { 'application/json': { schema: { type: 'string' } } }
    })
  })

  it('names the status where a caller describes nothing, because OpenAPI requires a description', async () => {
    const document = await documentOf([
      { path: '/pets', method: 'get', responses: { '404': { schema: z.string() } } }
    ])

    expect(document.written.paths?.['/pets']?.get?.responses?.['404']).toEqual({
      description: 'the 404 response',
      content: { 'application/json': { schema: { type: 'string' } } }
    })
  })

  it('carries the headers a response sets', async () => {
    const document = await documentOf([
      {
        path: '/pets',
        method: 'get',
        responses: {
          '200': {
            schema: z.string(),
            headers: { 'Cache-Control': { schema: { type: 'string' } } }
          }
        }
      }
    ])

    expect(document.written.paths?.['/pets']?.get?.responses?.['200']).toEqual({
      description: 'the 200 response',
      headers: { 'Cache-Control': { schema: { type: 'string' } } },
      content: { 'application/json': { schema: { type: 'string' } } }
    })
  })

  it('writes a body in the media type the caller named', async () => {
    // A text response is a string, and the header the service sends says so. A document naming JSON
    // for it contradicts the response the service actually writes.
    const document = await documentOf([
      {
        path: '/page',
        method: 'get',
        responses: { '200': { schema: z.string(), mediaType: 'text/html' } }
      }
    ])

    // Stated whole, so the assertion also says no JSON media type stands beside it.
    expect(document.written.paths?.['/page']?.get?.responses?.['200']).toEqual({
      description: 'the 200 response',
      content: { 'text/html': { schema: { type: 'string' } } }
    })
  })

  it('writes a response with no content where it carries no body', async () => {
    // A 204 answers with nothing. A schema here would be a body that never arrives.
    const document = await documentOf([
      { path: '/pets', method: 'delete', responses: { '204': { description: 'gone' } } }
    ])

    const response = document.written.paths?.['/pets']?.delete?.responses?.['204']
    expect(response).toEqual({ description: 'gone' })
    expect(document.written.components).toBeUndefined()
  })

  it('writes a request body in the media type the caller named', async () => {
    const document = await documentOf([
      {
        path: '/page',
        method: 'post',
        body: z.string(),
        bodyMediaType: 'text/html',
        responses: { '200': { schema: z.string() } }
      }
    ])

    expect(document.written.paths?.['/page']?.post?.requestBody).toEqual({
      required: true,
      content: { 'text/html': { schema: { type: 'string' } } }
    })
  })
})

describe('whether a request must carry a body is stated, never defaulted', () => {
  /**
   * **OpenAPI reads an absent `required` as false, which is the one wrong answer.** A caller who
   * states a body schema means a request carries one. A document that stays quiet tells a generated
   * client the body may be omitted, and the client then holds a call the service refuses every time.
   *
   * No departure could report this. A departure says what a target cannot state, and OpenAPI states
   * this in one keyword. Leaving it out drops a fact the caller gave.
   */
  it('says a stated body is required, because a caller who states one means it', async () => {
    const document = await documentOf([
      {
        path: '/pets',
        method: 'post',
        body: z.object({ note: z.string() }),
        responses: { '200': { schema: z.string() } }
      }
    ])

    expect(document.written.paths?.['/pets']?.post?.requestBody).toEqual({
      required: true,
      content: {
        'application/json': {
          schema: { type: 'object', properties: { note: { type: 'string' } }, required: ['note'] }
        }
      }
    })
  })

  it('says a body may be omitted where the caller says so', async () => {
    const document = await documentOf([
      {
        path: '/pets',
        method: 'patch',
        body: z.object({ note: z.string() }),
        bodyRequired: false,
        responses: { '200': { schema: z.string() } }
      }
    ])

    expect(document.written.paths?.['/pets']?.patch?.requestBody).toEqual({
      required: false,
      content: {
        'application/json': {
          schema: { type: 'object', properties: { note: { type: 'string' } }, required: ['note'] }
        }
      }
    })
  })

  it('writes the keyword either way, so no reader supplies the default', async () => {
    // The point of writing it when it is false as well. A reader that had to know OpenAPI's default
    // is a reader that can disagree with this document about what the service accepts.
    const document = await documentOf([
      {
        path: '/pets',
        method: 'post',
        body: z.string(),
        bodyRequired: false,
        responses: { '200': { schema: z.string() } }
      }
    ])

    expect(document.written.paths?.['/pets']?.post?.requestBody).toEqual({
      required: false,
      content: { 'application/json': { schema: { type: 'string' } } }
    })
  })
})

describe('a caller sends part of a request outside the body', () => {
  /**
   * **A parameter is a name, a place and a schema, and no validator holds that shape.** What a caller
   * has is an object whose keys are the names and whose edge says which may be absent. So an object
   * is stated for each place, and the properties are the parameters there.
   *
   * The whole request half of an operation depends on this. A document missing them describes
   * endpoints that take no path parameter, no query string and no header, which is a different
   * service from the one that runs.
   */
  it('writes one parameter for each property, at the place the caller put it', async () => {
    const document = await documentOf([
      {
        path: '/pets/{petId}',
        method: 'get',
        parameters: {
          path: z.object({ petId: z.string() }),
          query: z.object({ limit: z.number().optional(), status: z.enum(['open', 'shut']) }),
          header: z.object({ authorization: z.string() })
        },
        responses: { '200': { schema: z.object({ id: z.string() }) } }
      }
    ])

    expect(document.written.paths?.['/pets/{petId}']?.get?.parameters).toEqual([
      { name: 'petId', in: 'path', required: true, schema: { type: 'string' } },
      { name: 'limit', in: 'query', required: false, schema: { type: 'number' } },
      {
        name: 'status',
        in: 'query',
        required: true,
        schema: { type: 'string', enum: ['open', 'shut'] }
      },
      { name: 'authorization', in: 'header', required: true, schema: { type: 'string' } }
    ])
  })

  it('moves an inline description to the parameter, which is where a generator reads it', async () => {
    // A client's method takes an argument for the parameter, so the parameter is what a doc comment
    // is written from. Left on the schema the sentence documents nothing.
    const document = await documentOf([
      {
        path: '/pets/{petId}',
        method: 'get',
        parameters: { path: z.object({ petId: z.string().describe('the pet id') }) },
        responses: { '204': { description: 'x' } }
      }
    ])

    expect(document.written.paths?.['/pets/{petId}']?.get?.parameters).toEqual([
      {
        name: 'petId',
        in: 'path',
        required: true,
        description: 'the pet id',
        schema: { type: 'string' }
      }
    ])
  })

  it('moves a sentence standing beside a reference, which is the use site talking', async () => {
    // A component's own description is under `components`, so a sentence next to a `$ref` came from
    // this use of the named schema. The reference stays on the schema and the sentence goes up.
    //
    // Reachable only where the parameter is the second claimant of the name: the first one describes
    // the component, so the plain use has to come first for the described use to become a reference.
    const plain = z.string().meta({ id: 'PetId' })
    const said = z.string().meta({ id: 'PetId', description: 'the pet this call is about' })

    const document = await documentOf([
      { path: '/pets', method: 'get', responses: { '200': { schema: plain } } },
      {
        path: '/pets/{petId}',
        method: 'get',
        parameters: { path: z.object({ petId: said }) },
        responses: { '204': { description: 'x' } }
      }
    ])

    expect(document.written.paths?.['/pets/{petId}']?.get?.parameters).toEqual([
      {
        name: 'petId',
        in: 'path',
        required: true,
        description: 'the pet this call is about',
        schema: { $ref: '#/components/schemas/PetId' }
      }
    ])
    expect(document.written.components?.schemas?.['PetId']).toEqual({ type: 'string' })
  })

  it('leaves a referenced component its own description, which is not the use site talking', async () => {
    // A reference carries no metadata, so a description under one belongs to the component. Moving it
    // up would give this parameter a sentence another use of the same schema wrote.
    const PetId = z.string().describe('any pet id').meta({ id: 'PetId' })

    const document = await documentOf([
      {
        path: '/pets/{petId}',
        method: 'get',
        parameters: { path: z.object({ petId: PetId }) },
        responses: { '204': { description: 'x' } }
      }
    ])

    expect(document.written.paths?.['/pets/{petId}']?.get?.parameters).toEqual([
      {
        name: 'petId',
        in: 'path',
        required: true,
        schema: { $ref: '#/components/schemas/PetId' }
      }
    ])
    expect(document.written.components?.schemas?.['PetId']).toEqual({
      type: 'string',
      description: 'any pet id'
    })
  })

  it('says a key may be absent as the parameter not being required', async () => {
    // The one fact stated twice by two shapes. A validator puts it on the edge of the object and
    // OpenAPI puts it beside the parameter, so the object is the shorter of the two.
    const document = await documentOf([
      {
        path: '/pets',
        method: 'get',
        parameters: { query: z.object({ a: z.string(), b: z.string().optional() }) },
        responses: { '200': { schema: z.string() } }
      }
    ])

    const parameters = document.written.paths?.['/pets']?.get?.parameters
    expect(parameters).toEqual([
      { name: 'a', in: 'query', required: true, schema: { type: 'string' } },
      { name: 'b', in: 'query', required: false, schema: { type: 'string' } }
    ])
  })

  it('keeps a parameter whose schema has a name as a reference to the component', async () => {
    // A property with a name of its own is a component, and a parameter holds the reference. The
    // container is unnamed, so it is divided rather than written.
    const PetId = z.string().meta({ id: 'PetId' })

    const document = await documentOf([
      {
        path: '/pets/{petId}',
        method: 'get',
        parameters: { path: z.object({ petId: PetId }) },
        responses: { '200': { schema: z.string() } }
      }
    ])

    expect(document.written.paths?.['/pets/{petId}']?.get?.parameters).toEqual([
      {
        name: 'petId',
        in: 'path',
        required: true,
        schema: { $ref: '#/components/schemas/PetId' }
      }
    ])
  })

  it('carries the value that stands in where a key is absent', async () => {
    // The 2020-12 target puts a default on the key's own schema, and dividing what it wrote keeps
    // that decision in one place rather than restating it here.
    const document = await documentOf([
      {
        path: '/pets',
        method: 'get',
        parameters: { query: z.object({ limit: z.number().default(20) }) },
        responses: { '200': { schema: z.string() } }
      }
    ])

    expect(document.written.paths?.['/pets']?.get?.parameters?.[0]).toEqual({
      name: 'limit',
      in: 'query',
      required: false,
      schema: { type: 'number', default: 20 }
    })
  })

  it('divides a container the caller named, and keeps the name as a component', async () => {
    // A shared header set has a name of its own, so the term is a reference and the properties are in
    // the body it names. The component stays, because the name was the caller's to give and nothing
    // here can tell whether something else refers to it.
    const AuthorizationHeaders = z
      .object({ authorization: z.string() })
      .meta({ id: 'AuthorizationHeaders' })

    const document = await documentOf([
      {
        path: '/pets',
        method: 'get',
        parameters: { header: AuthorizationHeaders },
        responses: { '200': { schema: z.string() } }
      }
    ])

    expect(document.written.paths?.['/pets']?.get?.parameters).toEqual([
      { name: 'authorization', in: 'header', required: true, schema: { type: 'string' } }
    ])
    expect(Object.keys(document.written.components?.schemas ?? {})).toEqual([
      'AuthorizationHeaders'
    ])
  })

  it('writes no parameters key for an operation that states none', async () => {
    const document = await documentOf([
      { path: '/ping', method: 'get', responses: { '200': { schema: z.string() } } }
    ])

    // No `parameters` key, which the comparison states by holding the whole value.
    expect(document.written.paths?.['/ping']?.get).toEqual({
      responses: {
        '200': {
          description: 'the 200 response',
          content: { 'application/json': { schema: { type: 'string' } } }
        }
      }
    })
  })

  it('states parameters in 3.0, which reads them the same way', async () => {
    const spelled = spellOpenApi(
      [
        {
          path: '/pets',
          method: 'get',
          parameters: { query: z.object({ a: z.string().nullable() }) },
          responses: { '200': { schema: z.string() } }
        }
      ],
      zodSource,
      { sides },
      info,
      '3.0'
    )
    if (isError(spelled)) {
      throw new Error(spelled.message)
    }

    expect((await validator.validate(spelled.written as never)).valid).toBe(true)
    // The 3.0 dialect reaches the parameter's schema too, so null is a flag rather than a type.
    expect(spelled.written.paths?.['/pets']?.get?.parameters?.[0]).toEqual({
      name: 'a',
      in: 'query',
      required: true,
      schema: { type: 'string', nullable: true }
    })
  })

  it('reports what a parameter schema gave up, under the operation', async () => {
    const document = await documentOf([
      {
        path: '/pets',
        method: 'get',
        parameters: { query: z.object({ a: z.tuple([z.string()]) }) },
        responses: { '200': { schema: z.string() } }
      }
    ])

    // The path names the operation and then the parameter inside it.
    expect(document.departures[0]).toEqual({
      at: ['get /pets', 'a'],
      direction: 'wider',
      cause: 'noWordForIt',
      said: expect.stringContaining('does not say which of them must be present')
    })
  })
})

describe('what a request outside the body cannot say', () => {
  it('refuses a path parameter that may be absent, because a path has no form without it', async () => {
    const spelled = spellOpenApi(
      [
        {
          path: '/pets/{petId}',
          method: 'get',
          parameters: { path: z.object({ petId: z.string().optional() }) },
          responses: { '200': { schema: z.string() } }
        }
      ],
      zodSource,
      { sides },
      info
    )

    expect(isError(spelled) ? spelled.message : 'written').toContain('Make petId required')
  })

  it('refuses a path parameter the path holds no expression for', async () => {
    // A parameter naming nothing is read by nobody, and the expression it was written for stays
    // unfilled. The typo is the whole defect and nothing downstream would report it.
    const spelled = spellOpenApi(
      [
        {
          path: '/pets/{petId}',
          method: 'get',
          parameters: { path: z.object({ ptId: z.string() }) },
          responses: { '200': { schema: z.string() } }
        }
      ],
      zodSource,
      { sides },
      info
    )

    expect(isError(spelled) ? spelled.message : 'written').toContain('no {ptId}')
  })

  it('refuses a place that states anything but an object', async () => {
    const spelled = spellOpenApi(
      [
        {
          path: '/pets',
          method: 'get',
          parameters: { query: z.string() },
          responses: { '200': { schema: z.string() } }
        }
      ],
      zodSource,
      { sides },
      info
    )

    expect(isError(spelled) ? spelled.message : 'written').toContain('the query parameters are')
  })
})

describe('a tagged disjunction states the tag, which only this target has a word for', () => {
  /**
   * **The one place this target writes a keyword 2020-12 does not have.** A generator reads
   * `discriminator` and emits a sealed hierarchy over the members. It reads a bare `oneOf` and emits
   * an untagged union, so a consumer of the generated client loses the tag the schema was built on.
   */
  const CatDetails = z
    .object({ kind: z.literal('cat'), name: z.string() })
    .meta({ id: 'CatDetails' })
  const DogDetails = z
    .object({ kind: z.literal('dog'), name: z.string() })
    .meta({ id: 'DogDetails' })
  const Animal = z.discriminatedUnion('kind', [CatDetails, DogDetails]).meta({ id: 'Animal' })

  it('maps each value of the tag to the member that states it', async () => {
    const document = await documentOf([
      { path: '/pets', method: 'get', responses: { '200': { schema: Animal } } }
    ])

    // The mapping is written rather than left implicit. OpenAPI resolves a value to a component of
    // that name where no mapping stands, and no component here is called `cat`. The names and the
    // values differ on purpose, because a bare `propertyName` resolves to nothing where a name and a
    // value differ.
    expect(document.written.components?.schemas?.['Animal']).toEqual({
      oneOf: [
        { $ref: '#/components/schemas/CatDetails' },
        { $ref: '#/components/schemas/DogDetails' }
      ],
      discriminator: {
        propertyName: 'kind',
        mapping: {
          cat: '#/components/schemas/CatDetails',
          dog: '#/components/schemas/DogDetails'
        }
      }
    })
  })

  it('reports no loss, because this dialect stated the tag the other could not', async () => {
    const document = await documentOf([
      { path: '/pets', method: 'get', responses: { '200': { schema: Animal } } }
    ])

    // The 2020-12 target gives the discriminant up and says so. A caller who refuses every loss
    // publishes this document, so the report must not survive into it.
    expect(document.departures).toEqual([])
  })

  it('states the tag in 3.0 too, which has the same keyword', async () => {
    const spelled = spellOpenApi(
      [{ path: '/pets', method: 'get', responses: { '200': { schema: Animal } } }],
      zodSource,
      { sides },
      info,
      '3.0'
    )
    if (isError(spelled)) {
      throw new Error(spelled.message)
    }

    expect((await validator.validate(spelled.written as never)).valid).toBe(true)
    // The same shape 3.1 writes. Both dialects hold the keyword, so the translation touches neither.
    expect(spelled.written.components?.schemas?.['Animal']).toEqual({
      oneOf: [
        { $ref: '#/components/schemas/CatDetails' },
        { $ref: '#/components/schemas/DogDetails' }
      ],
      discriminator: {
        propertyName: 'kind',
        mapping: {
          cat: '#/components/schemas/CatDetails',
          dog: '#/components/schemas/DogDetails'
        }
      }
    })
  })

  it('gives up the tag where a member has no name to map the value to', async () => {
    // The members are unnamed, so each is written in place and a mapping has no reference to hold.
    const Inline = z
      .discriminatedUnion('kind', [
        z.object({ kind: z.literal('a') }),
        z.object({ kind: z.literal('b') })
      ])
      .meta({ id: 'Inline' })

    const document = await documentOf([
      { path: '/pets', method: 'get', responses: { '200': { schema: Inline } } }
    ])

    // No `discriminator`, which the comparison states by holding the whole value.
    expect(document.written.components?.schemas?.['Inline']).toEqual({
      oneOf: [
        {
          type: 'object',
          properties: { kind: { type: 'string', enum: ['a'] } },
          required: ['kind']
        },
        {
          type: 'object',
          properties: { kind: { type: 'string', enum: ['b'] } },
          required: ['kind']
        }
      ]
    })
    expect(document.departures[0]).toEqual({
      at: ['Inline'],
      direction: 'neither',
      cause: 'noWordForIt',
      said: expect.stringContaining('no keyword for one')
    })
  })

  it('writes no tag for a disjunction that names no property to choose by', async () => {
    const Plain = z.union([CatDetails, DogDetails]).meta({ id: 'Plain' })
    const document = await documentOf([
      { path: '/pets', method: 'get', responses: { '200': { schema: Plain } } }
    ])

    // `anyOf` rather than `oneOf`, and no `discriminator`. A plain disjunction states no exclusivity,
    // and the comparison holds the whole value, so the absent keyword is part of the claim.
    expect(document.written.components?.schemas?.['Plain']).toEqual({
      anyOf: [
        { $ref: '#/components/schemas/CatDetails' },
        { $ref: '#/components/schemas/DogDetails' }
      ]
    })
    expect(document.departures).toEqual([])
  })
})

describe('one document from three validators', () => {
  it('reaches the same document from zod, arktype and effect', async () => {
    const operation = { path: '/users', method: 'get' } as const

    const fromZod = spellOpenApi(
      [{ ...operation, responses: { '200': { schema: z.object({ id: z.string() }) } } }],
      zodSource,
      { sides },
      info
    )
    const fromArk = spellOpenApi(
      [
        {
          ...operation,
          responses: {
            '200': {
              schema: type.raw({ id: 'string' }) as unknown as Parameters<
                typeof arktypeSource.read
              >[0]
            }
          }
        }
      ],
      arktypeSource,
      { sides },
      info
    )
    const fromEffect = spellOpenApi(
      [
        { ...operation, responses: { '200': { schema: Schema.Struct({ id: Schema.String }).ast } } }
      ],
      effectSource,
      { sides },
      info
    )

    if (isError(fromZod) || isError(fromArk) || isError(fromEffect)) {
      throw new Error('a document was refused')
    }

    expect(fromArk.written).toEqual(fromZod.written)
    expect(fromEffect.written).toEqual(fromZod.written)
    expect((await validator.validate(fromZod.written as never)).valid).toBe(true)
  })
})

describe('3.0 is a different dialect of one target', () => {
  /**
   * The first time two dialects of one target have met here.
   *
   * 3.1 holds a 2020-12 schema unchanged. 3.0 has a schema of its own that says four things another
   * way and one thing not at all, so a schema is translated once and nothing downstream asks which
   * dialect it is writing for.
   *
   * Both are read by the OpenAPI meta-schema, which knows both versions.
   */
  async function documentIn30(operations: readonly Operation<z.core.$ZodType>[]) {
    const spelled = spellOpenApi(operations, zodSource, { sides }, info, '3.0')
    if (isError(spelled)) {
      throw new Error(spelled.message)
    }

    const verdict = await validator.validate(spelled.written as unknown as Record<string, unknown>)
    expect(verdict.errors ?? [], JSON.stringify(verdict.errors)).toEqual([])
    return spelled
  }

  function schemaIn30(schema: z.core.$ZodType) {
    return async () => {
      const document = await documentIn30([
        { path: '/pets', method: 'get', responses: { '200': { schema: schema } } }
      ])
      const response = document.written.paths?.['/pets']?.get?.responses?.['200']
      return {
        written: (response as { content?: Record<string, { schema?: unknown }> })?.content?.[
          'application/json'
        ]?.schema,
        departures: document.departures
      }
    }
  }

  it('says null with a flag beside one type, where 3.1 names two', async () => {
    // A fifth spelling of the one fact, and the first this library reaches by translating rather
    // than by writing. A flag in ATD, a type list in 2020-12, a joined branch where there is no type
    // to widen, a member of the coproduct in DynamoDB, and here a flag again with one type beside it.
    const { written } = await schemaIn30(z.string().nullable())()
    expect(written).toEqual({ type: 'string', nullable: true })
  })

  it('folds a null branch of a disjunction into the branches that are left', async () => {
    const { written } = await schemaIn30(z.union([z.string(), z.number()]).nullable())()
    expect(written).toEqual({
      anyOf: [
        { type: 'string', nullable: true },
        { type: 'number', nullable: true }
      ]
    })
  })

  it('states an exclusive bound under the inclusive keyword with a flag', async () => {
    const { written } = await schemaIn30(z.number().gt(1).lte(9))()
    expect(written).toEqual({
      type: 'number',
      minimum: 1,
      exclusiveMinimum: true,
      maximum: 9
    })
  })

  it('has no positional form, and says what that gives up', async () => {
    const { written, departures } = await schemaIn30(z.tuple([z.string(), z.number()]))()

    expect(written).toEqual({
      type: 'array',
      items: { anyOf: [{ type: 'string' }, { type: 'number' }] }
    })
    expect(departures.map((one) => one.said)).toContainEqual(
      expect.stringContaining('which shape stands where')
    )
  })

  it('states one example where a term states several', async () => {
    const { written, departures } = await schemaIn30(z.string().meta({ examples: ['a', 'b'] }))()

    // One `example` and no `examples`, which the comparison states by holding the whole value.
    expect(written).toEqual({ type: 'string', example: 'a' })
    expect(departures.map((one) => one.direction)).toContain('neither')
  })

  it('writes the same references and the same split', async () => {
    const User = z
      .object({ id: z.string(), role: z.string().default('reader') })
      .meta({ id: 'User' })

    const document = await documentIn30([
      { path: '/users', method: 'post', body: User, responses: { '200': { schema: User } } }
    ])

    expect(Object.keys(document.written.components?.schemas ?? {}).sort()).toEqual([
      'UserInput',
      'UserOutput'
    ])
    expect(document.written.openapi).toBe('3.0.3')
  })
})
