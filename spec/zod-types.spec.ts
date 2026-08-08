import { attest } from '@ark/attest'
import type { ZodTypeName } from '@fasciajs/zod'
import { isZodSchema, isZodType, ReadableZodTypes, UnreadableZodTypes } from '@fasciajs/zod'
import { describe, expect, it } from 'vitest'
import * as z from 'zod'

/**
 * One schema per readable type, so a name in the list is held to a schema that produces it.
 *
 * The list is checked against zod's declared discriminants by the compiler. This is the other half:
 * a name zod declares and no schema reaches is a name this package classified from the type
 * declarations without ever meeting the type.
 */
const aSchemaPerReadableType: Record<ReadableZodTypes, z.core.$ZodType> = {
  string: z.string(),
  number: z.number(),
  bigint: z.bigint(),
  boolean: z.boolean(),
  date: z.date(),
  null: z.null(),
  any: z.any(),
  unknown: z.unknown(),
  literal: z.literal('a'),
  enum: z.enum(['a', 'b']),
  template_literal: z.templateLiteral(['a', z.string()]),
  optional: z.string().optional(),
  nullable: z.string().nullable(),
  nonoptional: z.string().optional().nonoptional(),
  default: z.string().default('a'),
  prefault: z.string().prefault('a'),
  catch: z.string().catch('a'),
  readonly: z.string().readonly(),
  object: z.object({ a: z.string() }),
  array: z.array(z.string()),
  tuple: z.tuple([z.string()]),
  record: z.record(z.string(), z.string()),
  union: z.union([z.string(), z.number()]),
  intersection: z.intersection(z.object({ a: z.string() }), z.object({ b: z.string() })),
  pipe: z.string().pipe(z.string()),
  transform: z.transform((value: string) => value),
  lazy: z.lazy(() => z.string())
}

describe('every zod type is classified, and the classification is held to zod', () => {
  it('reaches a schema for every readable type, under the name it was filed as', () => {
    for (const name of ReadableZodTypes) {
      const schema = aSchemaPerReadableType[name]

      // The discriminant zod puts on the def, not a guess from the class or the method that built it.
      expect(isZodType(schema, [name]), `${name} did not read as ${name}`).toBe(true)
    }
  })

  it('files no type as both readable and unreadable', () => {
    const unreadable: string[] = Object.keys(UnreadableZodTypes)
    const inBoth = ReadableZodTypes.filter((name) => unreadable.includes(name))

    expect(inBoth).toEqual([])
  })

  it('gives a reason for every type it turns away, and the reason says what to send instead', () => {
    for (const [name, reason] of Object.entries(UnreadableZodTypes)) {
      expect(reason.length, `${name} has no reason`).toBeGreaterThan(20)
    }
  })
})

describe('isZodType narrows to the class behind the name', () => {
  it('answers on the discriminant', () => {
    expect(isZodType(z.string(), ['string'])).toBe(true)
    expect(isZodType(z.string(), ['number', 'bigint'])).toBe(false)
    expect(isZodType(z.string().optional(), ['optional'])).toBe(true)
  })

  it('narrows to a def a caller can read without a cast', () => {
    const schema: z.core.$ZodType = z.array(z.string())

    if (!isZodType(schema, ['array'])) {
      throw new Error('an array did not read as an array')
    }

    // `element` exists on an array's def and nowhere else, so reading it is the narrowing doing the
    // work. What is asserted is that the read compiles and finds a schema, not what zod calls the
    // type of the read: zod rewords its own declarations between versions.
    expect(isZodSchema(schema._zod.def.element)).toBe(true)

    attest(() => {
      // @ts-expect-error `shape` belongs to an object's def, and this narrowed to an array.
      return schema._zod.def.shape
    }).type.errors("Property 'shape' does not exist")
  })

  it('refuses a name zod does not have', () => {
    attest(() => {
      // @ts-expect-error
      return isZodType(z.string(), ['stringg'])
    }).type.errors('not assignable to type')
  })
})

describe('isZodSchema asks for the discriminant', () => {
  it('accepts a zod schema', () => {
    expect(isZodSchema(z.string())).toBe(true)
  })

  it('turns away a plain object that carries a _zod property', () => {
    // The weaker test, asking only for `_zod`, answers yes here and then matches no case.
    expect(isZodSchema({ _zod: { def: {} } })).toBe(false)
    expect(isZodSchema({ _zod: 'not a def' })).toBe(false)
  })

  it('turns away what is not an object', () => {
    expect(isZodSchema(null)).toBe(false)
    expect(isZodSchema('string')).toBe(false)
    expect(isZodSchema(undefined)).toBe(false)
  })
})

describe('the names are zod own', () => {
  it('holds a readable name to a name zod declares', () => {
    attest(() => {
      // @ts-expect-error
      const wrong: ZodTypeName = 'nothing zod has'
      return wrong
    }).type.errors('not assignable to type')
  })
})
