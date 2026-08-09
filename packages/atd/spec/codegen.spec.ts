import { createDartClient } from '@arrirpc/codegen-dart'
import { createTypescriptClient } from '@arrirpc/codegen-ts'
import type { Procedure } from '@fasciajs/atd'
import { spellAtdApp } from '@fasciajs/atd'
import type { SideNames } from '@fasciajs/core'
import { isError } from '@fasciajs/core'
import { zodSource } from '@fasciajs/zod'
import { describe, expect, it } from 'vitest'
import * as z from 'zod'

/**
 * **arri generates a client from a document this library wrote.**
 *
 * The strongest claim in this package, and the reason it is worth more than the shape guard beside
 * it. `isAppDefinition` answers whether a document is well formed. This runs arri's own TypeScript
 * generator over it and reads what came out, which answers whether the document is one arri can use.
 *
 * A shape guard cannot see a `ref` pointing at a definition that does not exist, a name a target
 * language has no room for, or a procedure key that does not split into services. The generator
 * either produces the types or it does not.
 */

const sides: SideNames = { input: (name) => `${name}Input`, output: (name) => `${name}Output` }

function appOf(procedures: Record<string, Procedure<z.core.$ZodType>>) {
  const spelled = spellAtdApp(procedures, zodSource, sides, { title: 'Users', version: '1' })
  if (isError(spelled)) {
    throw new Error(spelled.message)
  }
  return spelled.written
}

async function generated(procedures: Record<string, Procedure<z.core.$ZodType>>): Promise<string> {
  return createTypescriptClient(appOf(procedures), { clientName: 'UsersClient', outputFile: '' })
}

function generatedDart(procedures: Record<string, Procedure<z.core.$ZodType>>): string {
  return createDartClient(appOf(procedures), { clientName: 'UsersClient', outputFile: '' })
}

describe('arri writes a client from what this library wrote', () => {
  const User = z
    .object({ id: z.string(), name: z.string(), role: z.string().default('reader') })
    .meta({ id: 'User' })

  it('generates the two sides of one schema as two types', async () => {
    // The split reaching a generated client, which is what the whole side and naming layer was for.
    // A caller sends `role` or leaves it out, and always receives it.
    const source = await generated({
      'users.create': {
        transport: 'http',
        method: 'post',
        path: '/users/create',
        params: User,
        response: User
      }
    })

    // arri generated the side. A caller may leave `role` out of what it sends and always receives
    // one, which is the whole of what the side and the naming layer were built to say.
    expect(source).toMatch(/export interface UserInput \{[^}]*role\?: string;/)
    expect(source).toMatch(/export interface UserOutput \{[^}]*role: string;/)
  })

  it('generates a procedure under the service its key names', async () => {
    // arri splits a key on `.` into nested services, which a shape guard does not check.
    const source = await generated({
      'users.create': {
        transport: 'http',
        method: 'post',
        path: '/users/create',
        params: z.object({ name: z.string() })
      }
    })

    expect(source).toContain('UsersCreateParams')
    expect(source).toContain('create')
  })

  it('resolves every reference a nested schema makes', async () => {
    // The failure a shape guard cannot see. A definition referring to a name that is not in the
    // table is a well formed document that generates nothing.
    const Address = z.object({ city: z.string() }).meta({ id: 'Address' })
    const Person = z.object({ name: z.string(), home: Address }).meta({ id: 'Person' })

    const source = await generated({
      'people.get': { transport: 'http', method: 'get', path: '/people/get', response: Person }
    })

    // The generated field is typed as the referred model rather than left dangling. arri resolves
    // `{ ref: 'Address' }` against `definitions`, so a name this library filed under the wrong key
    // would reach the generator and produce nothing usable.
    expect(source).toContain('export interface Address')
    expect(source).toMatch(/export interface Person \{[^}]*home: Address;/)
  })

  it('generates a recursive schema, which arri resolves by name', async () => {
    const Tree: z.ZodType = z
      .lazy(() => z.object({ name: z.string(), children: z.array(Tree) }))
      .meta({ id: 'Tree' })

    const source = await generated({
      'trees.get': { transport: 'http', method: 'get', path: '/trees/get', response: Tree }
    })

    expect(source).toContain('Tree')
  })

  it('generates a websocket procedure', async () => {
    const source = await generated({
      'users.watch': { transport: 'ws', path: '/users/watch', response: User }
    })

    expect(source).toContain('UsersClient')
  })
})

describe('arri writes a Dart client from the same document', () => {
  /**
   * A second target language, and the reason to run one.
   *
   * TypeScript is forgiving: it has no reserved word this library can produce and its optional
   * fields read almost like the term. Dart is another matter, and a document that generates for one
   * and not for the other is a document that only looked right.
   */
  const User = z.object({ id: z.string(), role: z.string().default('reader') }).meta({ id: 'User' })

  it('carries the side into a second language', () => {
    const source = generatedDart({
      'users.create': {
        transport: 'http',
        method: 'post',
        path: '/users/create',
        params: User,
        response: User
      }
    })

    expect(source).toMatch(
      /class UserInput implements ArriModel \{\n {2}final String id;\n {2}final String\? role;/
    )
    expect(source).toMatch(
      /class UserOutput implements ArriModel \{\n {2}final String id;\n {2}final String role;/
    )
  })

  it('resolves a reference to the class it names', () => {
    const Address = z.object({ city: z.string() }).meta({ id: 'Address' })
    const Person = z.object({ name: z.string(), home: Address }).meta({ id: 'Person' })

    const source = generatedDart({
      'people.get': { transport: 'http', method: 'get', path: '/people/get', response: Person }
    })

    expect(source).toContain('class Address implements ArriModel')
    expect(source).toMatch(/class Person implements ArriModel \{[\s\S]*?final Address home;/)
  })

  it('escapes a key Dart reserves, which arri does and this library does not need to', () => {
    // A prediction that measuring refuted. A target language's reserved words looked like something
    // the naming layer would have to filter, and arri's own generator already does it: `class`
    // becomes `k_class` in Dart and stays `class` in TypeScript, where it is legal. So a name
    // travels as the caller wrote it and each generator decides what its own language can take.
    const Reserved = z.object({ class: z.string(), is: z.number() }).meta({ id: 'Class' })

    const source = generatedDart({
      'reserved.get': { transport: 'http', method: 'get', path: '/reserved', response: Reserved }
    })

    expect(source).toMatch(
      /class Class implements ArriModel \{\n {2}final String k_class;\n {2}final double k_is;/
    )
  })

  it('writes a service for each part of a procedure key', () => {
    const source = generatedDart({
      'users.create': {
        transport: 'http',
        method: 'post',
        path: '/users/create',
        params: User,
        response: User
      }
    })

    expect(source).toContain('class UsersClientUsersService')
  })
})
