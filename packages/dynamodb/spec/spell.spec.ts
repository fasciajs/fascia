import { attest } from '@ark/attest'
import type { Described, Spelled } from '@fasciajs/core'
import { describe as description, isError, noMeta } from '@fasciajs/core'
import type { AttributeShape, AttributeValue } from '@fasciajs/dynamodb'
import { spellDynamo, spellDynamoAll } from '@fasciajs/dynamodb'
import { zodSource } from '@fasciajs/zod'
import { describe, expect, it } from 'vitest'
import * as z from 'zod'

/**
 * A term, written as the AttributeValue members a value may take.
 *
 * **The first target here that does not describe JSON**, which is what it is for. ATD and 2020-12
 * disagree about how to say a thing and agree about what there is to say. This one has ten types, no
 * keyword for any assertion, no reference form, and a native set. So it states things both of the
 * others refuse and refuses most of what both of them state exactly, which is the sharpest test the
 * term has had of holding no target's vocabulary.
 *
 * **Nothing reads this format, and that is what these tests are worth.** The other two targets each
 * have a third party that disagrees: Ajv compiles a 2020-12 document and answers about values, and
 * arri's own guards say what an ATD schema is. Both found a defect nothing else could see. This
 * shape was designed here, written here and checked here, so every claim below about which member
 * carries what is this file agreeing with the file beside it.
 *
 * The type claims are the exception. A value carrying two members is refused by TypeScript, which
 * did not write the type.
 *
 * The oracle exists and is not used yet. `marshall` from the AWS SDK answers which member a value
 * actually lands under, so a value the schema accepts, marshalled, states its own member and the
 * shape either predicted it or did not. Until that runs, treat a green run here as well formed
 * rather than as true.
 */

function termOf(schema: z.core.$ZodType): Described {
  const described = description(schema, zodSource, 'input')
  if (isError(described)) {
    throw new Error(described.message)
  }
  return described.term
}

function shapeOf(schema: z.core.$ZodType): Spelled<AttributeShape> {
  const spelled = spellDynamo(termOf(schema))
  if (isError(spelled)) {
    throw new Error(spelled.message)
  }
  return spelled
}

function refusalOf(term: Described): string {
  const spelled = spellDynamo(term)
  if (!isError(spelled)) {
    throw new Error(`the term was written as ${JSON.stringify(spelled.written)}`)
  }
  return spelled.message
}

describe('a value is exactly one member and a description is at least one', () => {
  it('refuses a value carrying two members, which the service refuses', () => {
    // The law the type exists to hold. A mapped type over one key says nothing about the others and
    // an object type is open, so a bare `{ S: string }` admits this. Excess property checking does
    // not see it either: every key here is known to some member of the union.
    attest(() => {
      // @ts-expect-error
      const two: AttributeValue = { S: 'a', N: '1' }
      return two
    }).type.errors('not assignable to type')
  })

  it('refuses a value carrying no member', () => {
    attest(() => {
      // @ts-expect-error
      const none: AttributeValue = {}
      return none
    }).type.errors('not assignable to type')
  })

  it('admits a description carrying two members, which a nullable string is', () => {
    const both: AttributeShape = { S: {}, NULL: {} }
    expect(both).toEqual({ S: {}, NULL: {} })
  })

  it('refuses a description carrying no member, because a schema admits something', () => {
    attest(() => {
      // @ts-expect-error
      const none: AttributeShape = {}
      return none
    }).type.errors('not assignable to type')
  })

  it('holds every other member to its own type rather than leaving it unchecked', () => {
    // Asked of a value that is held rather than written here, which is the case that tells the two
    // apart. Excess property checking catches a literal whichever way the type is written, so a
    // literal proves nothing about the clause under test.
    const held = { S: {}, L: 'not a list' } as { S: Record<never, never>; L: string }

    attest(() => {
      // @ts-expect-error
      const wrong: AttributeShape = held
      return wrong
    }).type.errors('not assignable to type')
  })
})

describe('a term reaches the member that carries it', () => {
  it('carries a string under S', () => {
    expect(shapeOf(z.string()).written).toEqual({ S: {} })
  })

  it('carries a number under N', () => {
    expect(shapeOf(z.number()).written).toEqual({ N: {} })
  })

  it('carries a boolean under BOOL', () => {
    expect(shapeOf(z.boolean()).written).toEqual({ BOOL: {} })
  })

  it('carries an object under M, stating which names must be present', () => {
    const written = shapeOf(z.object({ id: z.string(), note: z.string().optional() })).written

    expect(written.M?.attributes.get('id')).toEqual({ shape: { S: {} }, required: true })
    expect(written.M?.attributes.get('note')).toEqual({ shape: { S: {} }, required: false })
  })

  it('carries a list under L', () => {
    expect(shapeOf(z.array(z.string())).written).toEqual({ L: { items: { S: {} } } })
  })

  it('adds NULL beside the member, which is a fourth way to spell one fact', () => {
    // A flag beside a type in ATD, a member of a type list in 2020-12, a joined branch where there
    // is no type to widen, and here a member of the coproduct itself.
    expect(shapeOf(z.string().nullable()).written).toEqual({ S: {}, NULL: {} })
  })

  it('admits every member where the schema states nothing', () => {
    expect(Object.keys(shapeOf(z.unknown()).written).sort()).toEqual([
      'B',
      'BOOL',
      'BS',
      'L',
      'M',
      'N',
      'NS',
      'NULL',
      'S',
      'SS'
    ])
  })
})

describe('what this target says that both of the others refuse', () => {
  it('carries a bigint under N, which is a string of up to thirty-eight digits', () => {
    // JSON has no form for one, so ATD and 2020-12 both refuse the term outright. DynamoDB writes
    // every number as a string and holds this one exactly.
    expect(shapeOf(z.literal(10n)).written).toEqual({ N: {} })
  })

  it('carries a set of strings under SS', () => {
    // Stated as a term, because no reading produces `unique` yet: zod refuses `z.set` outright and
    // neither of the others states uniqueness in a way any reader takes. The term carries the fact
    // and this is the first target with a word for it.
    const set: Described = {
      kind: 'typed',
      name: 'array',
      admitsNull: false,
      meta: noMeta,
      assertions: {
        items: { kind: 'typed', name: 'string', assertions: {}, admitsNull: false, meta: noMeta },
        unique: true
      }
    }

    const spelled = spellDynamo(set)
    expect(isError(spelled) ? spelled.message : spelled.written).toEqual({ SS: {} })
  })

  it('carries a set of numbers under NS', () => {
    const set: Described = {
      kind: 'typed',
      name: 'array',
      admitsNull: false,
      meta: noMeta,
      assertions: {
        items: { kind: 'typed', name: 'number', assertions: {}, admitsNull: false, meta: noMeta },
        unique: true
      }
    }

    const spelled = spellDynamo(set)
    expect(isError(spelled) ? spelled.message : spelled.written).toEqual({ NS: {} })
  })

  it('writes a list where the items are not ones a set holds', () => {
    const set: Described = {
      kind: 'typed',
      name: 'array',
      admitsNull: false,
      meta: noMeta,
      assertions: {
        items: { kind: 'typed', name: 'boolean', assertions: {}, admitsNull: false, meta: noMeta },
        unique: true
      }
    }

    const spelled = spellDynamo(set)
    expect(isError(spelled) ? spelled.message : spelled.written).toEqual({
      L: { items: { BOOL: {} } }
    })
  })

  it('states a disjunction, which ATD refuses, where the members land on different tags', () => {
    const spelled = shapeOf(z.union([z.string(), z.number()]))

    expect(spelled.written).toEqual({ S: {}, N: {} })
    expect(spelled.departures).toEqual([])
  })
})

describe('what this target gives up, which is every assertion', () => {
  it('reports a length, a bound and a pattern, having nowhere to put any of them', () => {
    const spelled = shapeOf(z.string().min(2).max(5).regex(/^a/))

    expect(spelled.written).toEqual({ S: {} })
    expect(spelled.departures).toHaveLength(1)
    expect(spelled.departures[0]).toMatchObject({ direction: 'wider', cause: 'noWordForIt' })
    expect(spelled.departures[0]?.said).toContain('minLength, maxLength, patterns')
  })

  it('reports the values an enum admits, keeping only the member they are carried under', () => {
    const spelled = shapeOf(z.enum(['a', 'b']))

    expect(spelled.written).toEqual({ S: {} })
    expect(spelled.departures[0]?.said).toContain('2 admitted value(s)')
  })

  it('reports a tuple twice over, because a list holds one shape for every element', () => {
    const spelled = shapeOf(z.tuple([z.string(), z.number()]))

    expect(spelled.written).toEqual({ L: { items: { S: {}, N: {} } } })
    expect(spelled.departures.map((one) => one.direction)).toEqual(['wider'])
    expect(spelled.departures[0]?.said).toContain('which shape stands where')
  })

  it('reports a disjunction whose members are carried under one member', () => {
    const spelled = shapeOf(z.union([z.object({ a: z.string() }), z.object({ b: z.number() })]))

    expect(Object.keys(spelled.written)).toEqual(['M'])
    expect(spelled.departures.at(-1)?.said).toContain('carried under one member')
  })

  it('refuses an intersection, having no form for one', () => {
    expect(
      refusalOf(termOf(z.intersection(z.object({ a: z.string() }), z.object({ b: z.number() }))))
    ).toContain('no form for an intersection')
  })
})

describe('a name has nowhere to go, and the refusal says so', () => {
  it('refuses a reference, because an AttributeValue holds no name', () => {
    const User = z.object({ id: z.string() }).meta({ id: 'User' })
    expect(refusalOf(termOf(User))).toContain('no reference form')
  })

  it('refuses a description that carries definitions, rather than writing a dangling name', () => {
    const Tree: z.ZodType = z
      .lazy(() => z.object({ name: z.string(), children: z.array(Tree) }))
      .meta({ id: 'Tree' })

    const described = description(Tree, zodSource, 'input')
    if (isError(described)) {
      throw new Error(described.message)
    }

    const spelled = spellDynamoAll(described)
    expect(isError(spelled) ? spelled.message : 'written').toContain('no reference form')
  })
})
