import { arktypeSource } from '@fasciajs/arktype'
import type { Procedure } from '@fasciajs/atd'
import { isAtdApp, isAtdProcedure, spellAtdApp } from '@fasciajs/atd'
import type { SideNames } from '@fasciajs/core'
import { isError } from '@fasciajs/core'
import { effectSource } from '@fasciajs/effect'
import { zodSource } from '@fasciajs/zod'
import { type } from 'arktype'
import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'
import * as z from 'zod'

/**
 * A set of procedures, written as an arri app definition.
 *
 * **The first document here that holds more than one schema**, and it is what the side and the
 * naming were built for. A procedure's params is what a caller sends and its response is what comes
 * back, so the side comes from the position rather than from the schema, and a schema standing in
 * both places twice over becomes two definitions where its sides differ.
 *
 * **arri reads what this writes.** `isAppDefinition` and `isRpcDefinition` are arri's own answers
 * about what a document is, so a claim here is checked by something that did not write it. That is
 * what the DynamoDB target has no equivalent of.
 */

const sides: SideNames = { input: (name) => `${name}Input`, output: (name) => `${name}Output` }

function appOf(procedures: Record<string, Procedure<z.core.$ZodType>>) {
  const spelled = spellAtdApp(procedures, zodSource, { sides }, { title: 'Users', version: '1' })
  if (isError(spelled)) {
    throw new Error(spelled.message)
  }

  // arri's own guard, asked of every document this spec builds. A shape it refuses is not a document
  // whatever else the assertions below say about it.
  expect(isAtdApp(spelled.written)).toBe(true)
  for (const procedure of Object.values(spelled.written.procedures)) {
    expect(isAtdProcedure(procedure)).toBe(true)
  }

  return spelled
}

function refusalOf(procedures: Record<string, Procedure<z.core.$ZodType>>): string {
  const spelled = spellAtdApp(procedures, zodSource, { sides })
  if (!isError(spelled)) {
    throw new Error(`the app was written as ${JSON.stringify(spelled.written)}`)
  }
  return spelled.message
}

describe('a procedure names its two ends rather than holding them', () => {
  const User = z.object({ id: z.string(), name: z.string() }).meta({ id: 'User' })

  it('points params and response at entries in definitions', () => {
    const app = appOf({
      getUser: {
        transport: 'http',
        method: 'get',
        path: '/users/get',
        params: z.object({ id: z.string() }).meta({ id: 'UserId' }),
        response: User
      }
    })

    expect(app.written.procedures['getUser']).toEqual({
      transport: 'http',
      method: 'get',
      path: '/users/get',
      params: 'UserId',
      response: 'User'
    })
    expect(Object.keys(app.written.definitions).sort()).toEqual(['User', 'UserId'])
  })

  it("takes arri's own name for a position whose schema has none", () => {
    // Read from `createAppDefinition` rather than chosen: the schema's own name where it has one,
    // and the procedure's key with `Params` or `Response` after it where it does not.
    const app = appOf({
      'users.create': {
        transport: 'http',
        method: 'post',
        path: '/users/create',
        params: z.object({ name: z.string() })
      }
    })

    expect(app.written.procedures['users.create']?.params).toBe('UsersCreateParams')
    expect(app.written.definitions['UsersCreateParams']).toEqual({
      properties: { name: { type: 'string' } },
      metadata: { id: 'UsersCreateParams' }
    })
  })

  it('describes one schema once across two procedures', () => {
    const app = appOf({
      getUser: { transport: 'http', method: 'get', path: '/users/get', response: User },
      listUsers: { transport: 'http', method: 'get', path: '/users/list', response: User }
    })

    expect(Object.keys(app.written.definitions)).toEqual(['User'])
  })

  it('writes a websocket procedure, which states no method', () => {
    const app = appOf({
      watchUsers: { transport: 'ws', path: '/users/watch', response: User }
    })

    expect(app.written.procedures['watchUsers']).toEqual({
      transport: 'ws',
      path: '/users/watch',
      response: 'User'
    })
  })

  it('carries what a caller said about the procedure itself', () => {
    const app = appOf({
      getUser: {
        transport: 'http',
        method: 'get',
        path: '/users/get',
        response: User,
        description: 'one user',
        deprecated: true
      }
    })

    expect(app.written.procedures['getUser']).toEqual({
      transport: 'http',
      method: 'get',
      path: '/users/get',
      response: 'User',
      description: 'one user',
      isDeprecated: true
    })
  })
})

describe('one schema at two positions is two definitions where its sides differ', () => {
  it('splits a schema used as params and as response, because a default differs', () => {
    // The claim the whole document layer needed. `role` may be left out of what a caller sends and
    // is always in what comes back, so one name cannot state both.
    const User = z
      .object({ id: z.string(), role: z.string().default('reader') })
      .meta({ id: 'User' })

    const app = appOf({
      createUser: {
        transport: 'http',
        method: 'post',
        path: '/users/create',
        params: User,
        response: User
      }
    })

    expect(app.written.procedures['createUser']).toEqual({
      transport: 'http',
      method: 'post',
      path: '/users/create',
      params: 'UserInput',
      response: 'UserOutput'
    })
    expect(app.written.definitions['UserInput']).toEqual({
      properties: { id: { type: 'string' } },
      optionalProperties: { role: { type: 'string' } },
      metadata: { id: 'UserInput' }
    })
    expect(app.written.definitions['UserOutput']).toEqual({
      properties: { id: { type: 'string' }, role: { type: 'string' } },
      metadata: { id: 'UserOutput' }
    })
  })

  it('keeps one name where the two sides say the same thing', () => {
    const User = z.object({ id: z.string() }).meta({ id: 'User' })

    const app = appOf({
      createUser: {
        transport: 'http',
        method: 'post',
        path: '/users/create',
        params: User,
        response: User
      }
    })

    expect(Object.keys(app.written.definitions)).toEqual(['User'])
    expect(app.written.procedures['createUser']).toEqual({
      transport: 'http',
      method: 'post',
      path: '/users/create',
      params: 'User',
      response: 'User'
    })
  })
})

describe('what a document refuses, and what it says instead', () => {
  it('refuses a procedure whose params is not a message', () => {
    // arri declares this in `RpcDefinitionHelper`, which takes the properties form or the
    // discriminator form and no other. A bare string has no shape a client can generate.
    expect(
      refusalOf({
        getUser: {
          transport: 'http',
          method: 'get',
          path: '/users/get',
          params: z.string().meta({ id: 'Name' })
        }
      })
    ).toContain('as a message')
  })

  it('refuses two procedures whose derived names collide, where arri writes over one', () => {
    const app = spellAtdApp(
      {
        'users.create': {
          transport: 'http',
          method: 'post',
          path: '/a',
          params: z.object({ a: z.string() })
        },
        usersCreate: {
          transport: 'http',
          method: 'post',
          path: '/b',
          params: z.object({ b: z.string() })
        }
      },
      zodSource,
      { sides }
    )

    expect(isError(app) ? app.message : 'written').toContain('UsersCreateParams')
  })

  it('refuses a schema the reading cannot describe, and says which failure it was', () => {
    // Two errors reach a caller here, because this reads schemas as well as writing them.
    expect(
      refusalOf({
        getUser: {
          transport: 'http',
          method: 'get',
          path: '/users/get',
          params: z.object({ when: z.date() }).meta({ id: 'When' })
        }
      })
    ).toContain('no JSON form')
  })
})

describe('a document holds schemas from a library arri never heard of', () => {
  /**
   * The claim the shape exists for, at the document level rather than at the schema level.
   *
   * `spellAtdApp` takes a `Source<S>` and cannot see which library produced it, so three validators
   * that agree about nothing structurally reach one app definition. Written without names, so all
   * three take the same derived one and the documents are comparable in full.
   */
  const procedures = {
    'users.create': { transport: 'http', method: 'post', path: '/users/create' }
  } as const

  function appFrom<S>(source: Parameters<typeof spellAtdApp<S>>[1], params: S, response: S) {
    const spelled = spellAtdApp(
      { 'users.create': { ...procedures['users.create'], params, response } },
      source,
      { sides }
    )
    if (isError(spelled)) {
      throw new Error(spelled.message)
    }
    expect(isAtdApp(spelled.written)).toBe(true)
    return spelled.written
  }

  it('reaches one document from zod, arktype and effect', () => {
    const fromZod = appFrom(
      zodSource,
      z.object({ name: z.string() }),
      z.object({ id: z.string(), name: z.string() })
    )

    const fromArk = appFrom(
      arktypeSource,
      type.raw({ name: 'string' }) as unknown as Parameters<typeof arktypeSource.read>[0],
      type.raw({ id: 'string', name: 'string' }) as unknown as Parameters<
        typeof arktypeSource.read
      >[0]
    )

    const fromEffect = appFrom(
      effectSource,
      Schema.Struct({ name: Schema.String }).ast,
      Schema.Struct({ id: Schema.String, name: Schema.String }).ast
    )

    expect(fromArk).toEqual(fromZod)
    expect(fromEffect).toEqual(fromZod)
    expect(fromZod.definitions['UsersCreateParams']).toEqual({
      properties: { name: { type: 'string' } },
      metadata: { id: 'UsersCreateParams' }
    })
  })
})
