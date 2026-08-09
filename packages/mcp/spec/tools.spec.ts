import type { SideNames } from '@fasciajs/core'
import { isError } from '@fasciajs/core'
import type { Tool } from '@fasciajs/mcp'
import { spellMcpTools } from '@fasciajs/mcp'
import { zodSource } from '@fasciajs/zod'
import { ToolSchema } from '@modelcontextprotocol/sdk/types.js'
import { describe, expect, it } from 'vitest'
import * as z from 'zod'

/**
 * A set of tools, written as Model Context Protocol tool definitions.
 *
 * **A fourth document over the same schema half**, and the second one whose vendor reads what this
 * writes: the SDK states `ToolSchema` as a zod schema, so a tool definition is checked by the thing
 * that will receive it.
 *
 * MCP is the first target to require a shape at a position. A tool takes named arguments, so a bare
 * string at either end is a tool no client can call, and that is refused rather than written.
 */

const sides: SideNames = { input: (name) => `${name}Input`, output: (name) => name }

function toolsOf(tools: readonly Tool<z.core.$ZodType>[], named?: Map<z.core.$ZodType, string>) {
  const spelled = spellMcpTools(tools, zodSource, { sides, ...(named !== undefined && { named }) })
  if (isError(spelled)) {
    throw new Error(spelled.message)
  }

  // The SDK's own reader, asked of every tool this spec builds.
  for (const tool of spelled.written) {
    const verdict = ToolSchema.safeParse(tool)
    expect(verdict.success, JSON.stringify(verdict.error?.issues)).toBe(true)
  }

  return spelled
}

describe('a tool states what it takes and what it answers with', () => {
  const User = z.object({ id: z.string(), role: z.string().default('reader') })

  it('writes both ends of a tool, and the SDK reads them', () => {
    const [tool] = toolsOf(
      [
        {
          name: 'create_user',
          title: 'Create a user',
          description: 'makes one',
          arguments: User,
          result: User
        }
      ],
      new Map<z.core.$ZodType, string>([[User, 'User']])
    ).written

    expect(tool?.name).toBe('create_user')
    expect(tool?.title).toBe('Create a user')
    // Inlined rather than referenced. MCP holds a tool at a schema naming `object`, and the SDK
    // refuses a bare reference, so a named schema stands as its own body with the name beside it.
    expect(tool?.inputSchema).toMatchObject({ type: 'object', required: ['id'] })
    expect(tool?.outputSchema).toMatchObject({ type: 'object', required: ['id', 'role'] })
  })

  it('carries the side, so what is sent and what comes back differ', () => {
    const [tool] = toolsOf(
      [{ name: 't', arguments: User, result: User }],
      new Map<z.core.$ZodType, string>([[User, 'User']])
    ).written

    const defs = (schema: unknown): Record<string, { required?: string[] }> =>
      (schema as { $defs?: Record<string, { required?: string[] }> }).$defs ?? {}

    expect(defs(tool?.inputSchema)['UserInput']?.required).toEqual(['id'])
    expect(defs(tool?.outputSchema)['User']?.required).toEqual(['id', 'role'])
    expect((tool?.inputSchema as { required?: string[] } | undefined)?.required).toEqual(['id'])
  })

  it('carries only the definitions a tool reaches', () => {
    // A tool holds its own schema and points into no table, so a name travels with the tool that
    // uses it. Every tool carrying every definition would put one tool's shapes into another's.
    const Address = z.object({ city: z.string() })
    const Person = z.object({ home: Address })
    const Other = z.object({ n: z.number() })

    const spelled = toolsOf(
      [
        { name: 'people', arguments: Person },
        { name: 'other', arguments: Other }
      ],
      new Map<z.core.$ZodType, string>([
        [Address, 'Address'],
        [Person, 'Person'],
        [Other, 'Other']
      ])
    )

    const defsOf = (index: number) => {
      const schema = spelled.written[index]?.inputSchema as
        | { $defs?: Record<string, unknown> }
        | undefined
      return Object.keys(schema?.$defs ?? {}).sort()
    }

    expect(defsOf(0)).toEqual(['Address', 'Person'])
    expect(defsOf(1)).toEqual(['Other'])
  })

  it('writes an unnamed schema in place', () => {
    const [tool] = toolsOf([{ name: 'ping', arguments: z.object({ at: z.string() }) }]).written

    expect(tool?.inputSchema).toMatchObject({
      type: 'object',
      properties: { at: { type: 'string' } }
    })
    expect(tool?.inputSchema).not.toHaveProperty('$defs')
  })
})

describe('what MCP refuses, and what this says instead', () => {
  function refusalOf(tools: readonly Tool<z.core.$ZodType>[]): string {
    const spelled = spellMcpTools(tools, zodSource, { sides })
    if (!isError(spelled)) {
      throw new Error(`the tools were written as ${JSON.stringify(spelled.written)}`)
    }
    return spelled.message
  }

  it('refuses a tool whose arguments are not named arguments', () => {
    // The first target that requires a shape at a position. The SDK refuses it too, and this says
    // which tool and which end rather than letting a client find out.
    expect(refusalOf([{ name: 'shout', arguments: z.string() }])).toContain('must be an object')
  })

  it('refuses a tool whose result is not an object', () => {
    expect(
      refusalOf([{ name: 'count', arguments: z.object({ a: z.string() }), result: z.number() }])
    ).toContain('result of count')
  })

  it('refuses a schema no document can carry, and says which failure it was', () => {
    expect(refusalOf([{ name: 'when', arguments: z.object({ at: z.date() }) }])).toContain(
      'no JSON form'
    )
  })
})
