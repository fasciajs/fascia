import { arktypeSource } from '@fasciajs/arktype'
import type { SideNames } from '@fasciajs/core'
import { isError } from '@fasciajs/core'
import { effectSource } from '@fasciajs/effect'
import type { Operation, V31 } from '@fasciajs/openapi'
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

async function documentOf(operations: readonly Operation<z.core.$ZodType>[]) {
  const spelled = spellOpenApi(operations, zodSource, sides, info)
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
        responses: { '200': User }
      }
    ])

    const operation = document.written.paths?.['/users']?.post
    expect(operation?.operationId).toBe('createUser')
    expect(operation?.requestBody).toMatchObject({
      content: { 'application/json': { schema: { $ref: '#/components/schemas/UserInput' } } }
    })
    expect(operation?.responses?.['200']).toMatchObject({
      content: { 'application/json': { schema: { $ref: '#/components/schemas/UserOutput' } } }
    })
  })

  it('splits one schema at two positions, because a default differs', async () => {
    const document = await documentOf([
      { path: '/users', method: 'post', body: User, responses: { '200': User } }
    ])

    const schemas = document.written.components?.schemas
    expect(Object.keys(schemas ?? {}).sort()).toEqual(['UserInput', 'UserOutput'])
    expect(schemas?.['UserInput']).toMatchObject({ required: ['id'] })
    expect(schemas?.['UserOutput']).toMatchObject({ required: ['id', 'role'] })
  })

  it('answers with several statuses, which a procedure has no room for', async () => {
    // Where this differs from an arri procedure. A position is not one of a pair, and each response
    // is described as the output side.
    const Problem = z.object({ message: z.string() }).meta({ id: 'Problem' })

    const document = await documentOf([
      {
        path: '/users/{id}',
        method: 'get',
        responses: { '200': User, '404': Problem }
      }
    ])

    const responses = document.written.paths?.['/users/{id}']?.get?.responses
    expect(Object.keys(responses ?? {})).toEqual(['200', '404'])
    expect(responses?.['404']).toMatchObject({
      content: { 'application/json': { schema: { $ref: '#/components/schemas/Problem' } } }
    })
  })

  it('writes two methods under one path', async () => {
    const document = await documentOf([
      { path: '/users', method: 'get', responses: { '200': User } },
      { path: '/users', method: 'post', body: User, responses: { '200': User } }
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
        responses: { '200': User }
      }
    ])

    expect(document.written.paths?.['/users']?.get).toMatchObject({
      summary: 'every user',
      description: 'in no order',
      deprecated: true
    })
  })

  it('inlines a schema that has no name of its own', async () => {
    const document = await documentOf([
      {
        path: '/ping',
        method: 'get',
        responses: { '200': z.object({ at: z.string() }) }
      }
    ])

    expect(document.written.paths?.['/ping']?.get?.responses?.['200']).toMatchObject({
      content: { 'application/json': { schema: { type: 'object' } } }
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
      [{ path: '/x', method: 'get', responses: { '200': Spaced } }],
      zodSource,
      sides,
      info
    )

    expect(isError(spelled) ? spelled.message : 'written').toContain('a user')
  })

  it('reports what the schema half gave up, at the position that gave it up', async () => {
    const document = await documentOf([
      { path: '/t', method: 'get', responses: { '200': z.tuple([z.string()]) } }
    ])

    // The tuple widening the 2020-12 target reports, reaching a caller with the operation that
    // produced it in its path.
    expect(document.departures[0]).toMatchObject({ direction: 'wider' })
    expect(document.departures[0]?.at[0]).toBe('get /t')
  })
})

describe('one document from three validators', () => {
  it('reaches the same document from zod, arktype and effect', async () => {
    const operation = { path: '/users', method: 'get' } as const

    const fromZod = spellOpenApi(
      [{ ...operation, responses: { '200': z.object({ id: z.string() }) } }],
      zodSource,
      sides,
      info
    )
    const fromArk = spellOpenApi(
      [
        {
          ...operation,
          responses: {
            '200': type.raw({ id: 'string' }) as unknown as Parameters<typeof arktypeSource.read>[0]
          }
        }
      ],
      arktypeSource,
      sides,
      info
    )
    const fromEffect = spellOpenApi(
      [{ ...operation, responses: { '200': Schema.Struct({ id: Schema.String }).ast } }],
      effectSource,
      sides,
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
