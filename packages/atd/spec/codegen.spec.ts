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

async function generated(procedures: Record<string, Procedure<z.core.$ZodType>>): Promise<string> {
  const spelled = spellAtdApp(procedures, zodSource, sides, { title: 'Users', version: '1' })
  if (isError(spelled)) {
    throw new Error(spelled.message)
  }

  return createTypescriptClient(spelled.written, { clientName: 'UsersClient', outputFile: '' })
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
