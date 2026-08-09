import type { Naming } from '@fasciajs/core'
import { describeAll, isError, refusing } from '@fasciajs/core'
import { spellJsonSchema } from '@fasciajs/json-schema'
import { zodSource } from '@fasciajs/zod'
import { describe, expect, it } from 'vitest'
import * as z from 'zod'

/**
 * The two things a caller had no way to say.
 *
 * Everything else in this repository is about what a document says. These are about what a caller
 * says: what a schema is called, and which losses they will not accept.
 */

const sides = { input: (name: string) => `${name}Input`, output: (name: string) => name }

describe('a caller names a schema without touching it', () => {
  it('names a schema the validator never named', () => {
    // The schema is somebody else's, or the caller would rather keep a document's vocabulary out of
    // their domain code. `nameOf` asks the validator and the validator only knows what was written
    // into it, so this is the only place a name like that can come from.
    const User = z.object({ id: z.string() })

    const naming: Naming<z.core.$ZodType> = { sides, named: new Map([[User, 'User']]) }
    const described = describeAll([{ schema: User, io: 'input' }], zodSource, naming)
    if (isError(described)) {
      throw new Error(described.message)
    }

    expect(described.terms[0]).toEqual({ kind: 'ref', name: 'User', admitsNull: false, meta: {} })
    expect([...described.definitions.keys()]).toEqual(['User'])
  })

  it('wins over the name the validator carries', () => {
    const User = z.object({ id: z.string() }).meta({ id: 'ZodUser' })

    const described = describeAll([{ schema: User, io: 'input' }], zodSource, {
      sides,
      named: new Map([[User, 'Person']])
    })
    if (isError(described)) {
      throw new Error(described.message)
    }

    expect([...described.definitions.keys()]).toEqual(['Person'])
  })

  it('still splits a name whose two sides differ', () => {
    const User = z.object({ role: z.string().default('reader') })

    const described = describeAll(
      [
        { schema: User, io: 'input' },
        { schema: User, io: 'output' }
      ],
      zodSource,
      { sides, named: new Map([[User, 'User']]) }
    )
    if (isError(described)) {
      throw new Error(described.message)
    }

    expect([...described.definitions.keys()].sort()).toEqual(['User', 'UserInput'])
  })
})

describe('a caller refuses a loss rather than reading about one', () => {
  function spelled(schema: z.core.$ZodType) {
    const described = describeAll([{ schema, io: 'input' }], zodSource, { sides })
    if (isError(described)) {
      throw new Error(described.message)
    }
    const term = described.terms[0]
    if (term === undefined) {
      throw new Error('nothing was described')
    }
    return spellJsonSchema(term)
  }

  it('takes a spelling that gave up nothing', () => {
    const held = refusing(spelled(z.string().min(2)), ['wider', 'narrower', 'neither'])

    expect(isError(held)).toBe(false)
  })

  it('refuses one that widened, and says what it gave up', () => {
    // A tuple states values at positions and a term does not say which must be present, so the
    // document accepts a shorter list. A caller publishing a contract may not want that.
    const held = refusing(spelled(z.tuple([z.string()])), ['wider'])

    expect(isError(held) ? held.message : 'written').toContain('must be present')
  })

  it('takes the same spelling where the caller refuses only a narrowing', () => {
    // Which losses stop a build is the caller's decision, and a widening is recoverable: a caller
    // sends something a reader allows and the service refuses it.
    expect(isError(refusing(spelled(z.tuple([z.string()])), ['narrower']))).toBe(false)
  })

  it('passes a refusal through, so this composes with a spelling that already failed', () => {
    // A bigint literal describes, because a term states the value and its type, and this target
    // refuses it: JSON has no form for one.
    const held = refusing(spelled(z.literal(10n)), ['wider'])

    expect(isError(held)).toBe(true)
  })
})
