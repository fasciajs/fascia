import type {
  Ask,
  Departure,
  Described,
  Naming,
  Source,
  Spelling,
  UndescribableSchema
} from '@fasciajs/core'
import { describeAll, isError, refsIn, UnsayableTerm, under } from '@fasciajs/core'
import { spellJsonSchema } from '@fasciajs/json-schema'
import type { Tool as McpTool } from '@modelcontextprotocol/sdk/types.js'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

/**
 * A set of tools, written as Model Context Protocol tool definitions.
 *
 * **A fourth document over the same schema half.** MCP holds a 2020-12 schema, as OpenAPI 3.1 does,
 * so nothing is spelled here and the schemas are the ones already measured at `0 narrower`.
 *
 * Two things MCP states that the others do not. A tool takes named arguments, so the schema at each
 * end must be an object and nothing else: a tool whose arguments are a bare string is a tool no
 * client can call, and this refuses it rather than writing it. And a tool carries its own schemas
 * rather than pointing into a table, so each one holds the definitions it reaches and no others.
 */

export type { McpTool }

/** One tool, and the schemas at its two ends. */
export interface Tool<S> {
  readonly name: string
  readonly title?: string
  readonly description?: string
  /** What a caller sends. Described as the input side, and MCP holds it as named arguments. */
  readonly arguments: S
  /** What comes back. Described as the output side. */
  readonly result?: S
}

/** Tools, or the reason there are none. */
export type ToolSpelling = Spelling<McpTool[]> | UndescribableSchema

export function spellMcpTools<S>(
  tools: readonly Tool<S>[],
  source: Source<S>,
  naming: Naming<S>
): ToolSpelling {
  const positions = positionsOf(tools)

  const described = describeAll(
    positions.map((position) => position.ask),
    source,
    naming
  )
  if (isError(described)) {
    return described
  }

  const departures: Departure[] = []
  const written = new Map<string, JSONSchema>()

  for (const [index, position] of positions.entries()) {
    const term = described.terms[index]
    if (term === undefined) {
      throw new Error('a position was described as nothing')
    }

    const spelled = carrying(term, described.definitions)
    if (isError(spelled)) {
      return spelled
    }

    const object = asObject(spelled.written, position)
    if (isError(object)) {
      return object
    }

    written.set(`${position.tool}.${position.at}`, object)
    departures.push(...under(`${position.tool}.${position.at}`, spelled.departures))
  }

  return { written: tools.map((tool) => stated(tool, written)), departures }
}

/**
 * A schema, with the definitions it reaches carried inside it.
 *
 * A tool holds its own schema and points into no table, so a name has to travel with the tool that
 * uses it. Only what it reaches: every tool carrying every definition would put a request body into
 * a document about an unrelated tool, and the closure is over what a body refers to rather than over
 * what a document holds.
 */
function carrying(
  term: Described,
  definitions: ReadonlyMap<string, Described>
): Spelling<JSONSchema> {
  // A named schema stands here as its own body rather than as a reference to one. MCP holds a tool
  // at a schema that names `object`, and the SDK refuses a bare reference: a tool client reads the
  // arguments off the schema itself. The name stays in the definitions beside it, so a schema that
  // holds itself still has something to point at.
  const root = term.kind === 'ref' ? (definitions.get(term.name) ?? term) : term

  const spelled = spellJsonSchema(root)
  if (isError(spelled)) {
    return spelled
  }

  const reached = new Set<string>()
  const pending = [...refsIn(root), ...(term.kind === 'ref' ? [term.name] : [])]
  while (pending.length > 0) {
    const name = pending.pop()
    if (name === undefined || reached.has(name)) {
      continue
    }
    reached.add(name)

    const body = definitions.get(name)
    if (body !== undefined) {
      pending.push(...refsIn(body))
    }
  }

  if (reached.size === 0 || typeof spelled.written === 'boolean') {
    return spelled
  }

  const $defs: Record<string, JSONSchema> = {}
  const departures = [...spelled.departures]

  for (const name of reached) {
    const body = definitions.get(name)
    if (body === undefined) {
      return new UnsayableTerm([name], `this refers to ${name} and nothing states what ${name} is`)
    }

    const said = spellJsonSchema(body)
    if (isError(said)) {
      return said
    }
    $defs[name] = said.written
    departures.push(...under(name, said.departures))
  }

  return { written: { ...spelled.written, $defs }, departures }
}

/**
 * A schema MCP holds a tool at, which is an object and nothing else.
 *
 * The SDK refuses anything else, including a bare reference, so a named schema is inlined before it
 * reaches here and this asks only what the body says.
 */
function asObject<S>(written: JSONSchema, position: Position<S>): JSONSchema | UnsayableTerm {
  const stated = typeof written === 'object' ? written : undefined
  const named = stated?.['type']

  if (named === 'object') {
    return written
  }

  return new UnsayableTerm(
    [position.tool, position.at],
    `MCP holds the ${position.at} of a tool as named arguments, so it must be an object, and the ${position.at} of ${position.tool} states ${typeof named === 'string' ? `a ${named}` : 'no type'}`
  )
}

interface Position<S> {
  readonly tool: string
  readonly at: 'arguments' | 'result'
  readonly ask: Ask<S>
}

/** Every schema a set of tools holds, with the side its position gives it. */
function positionsOf<S>(tools: readonly Tool<S>[]): Position<S>[] {
  const positions: Position<S>[] = []

  for (const tool of tools) {
    positions.push({
      tool: tool.name,
      at: 'arguments',
      ask: { schema: tool.arguments, io: 'input' }
    })
    if (tool.result !== undefined) {
      positions.push({ tool: tool.name, at: 'result', ask: { schema: tool.result, io: 'output' } })
    }
  }

  return positions
}

/** One tool, pointing at the schemas its two positions were written as. */
function stated<S>(tool: Tool<S>, written: ReadonlyMap<string, JSONSchema>): McpTool {
  const args = written.get(`${tool.name}.arguments`)
  const result = written.get(`${tool.name}.result`)

  return {
    name: tool.name,
    ...(tool.title !== undefined && { title: tool.title }),
    ...(tool.description !== undefined && { description: tool.description }),
    inputSchema: (args ?? { type: 'object' }) as McpTool['inputSchema'],
    ...(result !== undefined && { outputSchema: result as McpTool['outputSchema'] })
  }
}
