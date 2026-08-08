import type {
  Ask,
  Departure,
  Described,
  SideNames,
  Source,
  Spelling,
  UndescribableSchema
} from '@fasciajs/core'
import { describeAll, isError, UnsayableTerm, under } from '@fasciajs/core'
import type {
  AtdApp,
  AtdDiscriminator,
  AtdHttpMethod,
  AtdProcedure,
  AtdProperties,
  AtdSchema
} from './atd.js'
import { ATD_SCHEMA_VERSION, isAtdDiscriminator, isAtdProperties } from './atd.js'
import { spellAtd } from './spell.js'

/**
 * A set of procedures, written as an arri app definition.
 *
 * **The first thing here that describes more than one schema at once**, and it is what the side and
 * the naming were built for. A procedure states what a caller sends and what comes back, which are
 * two positions and two sides of the same document. A schema standing in both, whose sides differ,
 * becomes two definitions.
 *
 * arri names a procedure's params and response rather than holding them: `params` and `response` are
 * keys into `definitions`. So every position must be named, and the naming rule below is arri's own
 * rather than one invented here.
 */

/** How a procedure is reached. */
export type Transport =
  | { readonly transport: 'http'; readonly method: AtdHttpMethod; readonly isEventStream?: boolean }
  | { readonly transport: 'ws' }

/** One procedure, and the schemas at its two ends. */
export type Procedure<S> = Transport & {
  readonly path: string
  /** What a caller sends. Described as the input side. */
  readonly params?: S
  /** What comes back. Described as the output side. */
  readonly response?: S
  readonly description?: string
  readonly deprecated?: boolean
}

/** What arri says an app is called, named rather than restated. */
export type AppInfo = NonNullable<AtdApp['info']>

/**
 * A document, or the reason there is none.
 *
 * Two errors rather than one, because this reads schemas as well as writing them. A schema that
 * cannot be described and a term that cannot be written are different failures with different
 * answers, and a caller branches on which.
 */
export type AppSpelling = Spelling<AtdApp> | UndescribableSchema

/**
 * Every procedure, described together and written as one document.
 *
 * Together rather than one at a time, because a name is scoped to a document: two procedures sharing
 * a schema share one definition, and two procedures naming different schemas the same thing is an
 * error a document can state.
 */
export function spellAtdApp<S>(
  procedures: Readonly<Record<string, Procedure<S>>>,
  source: Source<S>,
  names: SideNames,
  info?: AppInfo
): AppSpelling {
  const positions = positionsOf(procedures)

  const described = describeAll(
    positions.map((position) => position.ask),
    source,
    names
  )
  if (isError(described)) {
    return described
  }

  const definitions: Record<string, AtdSchema> = {}
  const departures: Departure[] = []

  // The definitions a description produced, before any position is named. A position that named
  // itself already points at one of these.
  for (const [name, term] of described.definitions) {
    const spelled = spellAtd(term)
    if (isError(spelled)) {
      return spelled
    }
    definitions[name] = withName(spelled.written, name)
    departures.push(...under(name, spelled.departures))
  }

  const named: string[] = []
  for (const [index, position] of positions.entries()) {
    const term = described.terms[index]
    if (term === undefined) {
      throw new Error('a position was described as nothing')
    }

    const settled = nameOf(position, term, definitions)
    if (isError(settled)) {
      return settled
    }

    if (settled.body !== undefined) {
      const spelled = spellAtd(term)
      if (isError(spelled)) {
        return spelled
      }
      definitions[settled.name] = withName(spelled.written, settled.name)
      departures.push(...under(settled.name, spelled.departures))
    }

    const form = definitions[settled.name]
    if (form !== undefined && !isMessage(form)) {
      return new UnsayableTerm(
        [settled.name],
        `arri holds a procedure's ${position.at} as a message, and ${settled.name} states a ${Object.keys(form).filter((key) => key !== 'metadata')[0] ?? 'value'}. Give the procedure an object`
      )
    }

    named.push(settled.name)
  }

  return {
    written: {
      schemaVersion: ATD_SCHEMA_VERSION,
      ...(info !== undefined && { info }),
      procedures: written(procedures, positions, named),
      definitions
    },
    departures
  }
}

interface Position<S> {
  readonly key: string
  readonly at: 'params' | 'response'
  readonly ask: Ask<S>
}

/**
 * Every schema a document holds, with the side its position gives it.
 *
 * The params of a procedure is what a caller sends and the response is what comes back, which is
 * where a side comes from: a position rather than a schema.
 */
function positionsOf<S>(procedures: Readonly<Record<string, Procedure<S>>>): Position<S>[] {
  const positions: Position<S>[] = []

  for (const [key, procedure] of Object.entries(procedures)) {
    if (procedure.params !== undefined) {
      positions.push({ key, at: 'params', ask: { schema: procedure.params, io: 'input' } })
    }
    if (procedure.response !== undefined) {
      positions.push({ key, at: 'response', ask: { schema: procedure.response, io: 'output' } })
    }
  }

  return positions
}

interface Settled {
  readonly name: string
  /** The position was not named by its schema, so its body is written under a derived name. */
  readonly body?: true
}

/**
 * What a position is called.
 *
 * **arri's own rule**, read from `createAppDefinition` rather than chosen: the schema's own name
 * where it has one, and otherwise the procedure's key with `Params` or `Response` after it. A
 * derived name that is already taken by something else is refused, where arri's helper writes over
 * it.
 */
function nameOf<S>(
  position: Position<S>,
  term: Described,
  definitions: Readonly<Record<string, AtdSchema>>
): Settled | UnsayableTerm {
  if (term.kind === 'ref') {
    return { name: term.name }
  }

  const derived = pascal(`${position.key.split('.').join('_')}_${position.at}`)
  if (definitions[derived] !== undefined) {
    return new UnsayableTerm(
      [derived],
      `the ${position.at} of ${position.key} has no name of its own, so it is called ${derived}, and something else is called that already. Name the schema`
    )
  }

  return { name: derived, body: true }
}

function pascal(text: string): string {
  return text
    .split(/[^a-zA-Z0-9]+/)
    .filter((word) => word.length > 0)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('')
}

/** arri keeps a definition's name in its metadata, beside what a caller said about it. */
function withName(written: AtdSchema, name: string): AtdSchema {
  return { ...written, metadata: { ...written.metadata, id: name } }
}

/**
 * Whether a form is one arri holds a procedure at.
 *
 * arri declares this in `RpcDefinitionHelper`, which takes the properties form or the discriminator
 * form and no other. A procedure carrying a bare string has no shape for a client to generate.
 */
function isMessage(form: AtdSchema): form is AtdProperties | AtdDiscriminator {
  return isAtdProperties(form) || isAtdDiscriminator(form)
}

/** The procedures, each pointing at the definitions its two positions were filed under. */
function written<S>(
  procedures: Readonly<Record<string, Procedure<S>>>,
  positions: readonly Position<S>[],
  named: readonly string[]
): Record<string, AtdProcedure> {
  const at = new Map<string, string>()
  for (const [index, position] of positions.entries()) {
    const name = named[index]
    if (name !== undefined) {
      at.set(`${position.key}.${position.at}`, name)
    }
  }

  const out: Record<string, AtdProcedure> = {}
  for (const [key, procedure] of Object.entries(procedures)) {
    const params = at.get(`${key}.params`)
    const response = at.get(`${key}.response`)

    out[key] = {
      ...(procedure.transport === 'http'
        ? {
            transport: 'http' as const,
            method: procedure.method,
            ...(procedure.isEventStream !== undefined && { isEventStream: procedure.isEventStream })
          }
        : { transport: 'ws' as const }),
      path: procedure.path,
      ...(params !== undefined && { params }),
      ...(response !== undefined && { response }),
      ...(procedure.description !== undefined && { description: procedure.description }),
      ...(procedure.deprecated !== undefined && { isDeprecated: procedure.deprecated })
    }
  }

  return out
}
