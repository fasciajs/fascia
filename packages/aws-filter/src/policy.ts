/**
 * A filter policy, in the subset of its operators this target writes.
 *
 * SNS calls the form a filter policy, and Lambda calls it a filter pattern on an event source
 * mapping. The operators here are the ones whose deliveries were recorded against AWS: a value, a
 * prefix, a suffix, a numeric range and `exists`. The other operators state nothing a term states.
 */

/** Where a policy reads a message. Each scope takes a different grammar, and names it explicitly. */
export type Scope = 'sns:attributes' | 'sns:body' | 'sqs:body' | 'sqs:attributes'

type Lower = '>' | '>='
type Upper = '<' | '<='

/** A comparison, or a range whose lower bound comes first. AWS refuses the reversed order. */
export type Numeric =
  | readonly ['=', number]
  | readonly [Lower | Upper, number]
  | readonly [Lower, number, Upper, number]

export type Condition =
  | string
  | number
  | boolean
  | null
  | { readonly prefix: string }
  | { readonly suffix: string }
  | { readonly numeric: Numeric }
  | { readonly exists: boolean }

/** A key matches where any one of its conditions matches. AWS refuses an empty list. */
export type Conditions = readonly [Condition, ...Condition[]]

/**
 * Each key holds conditions or a policy for the object under it, and `$or` holds two branches or
 * more. An index signature cannot single out `$or`, so the type takes branches under any key.
 */
export interface FilterPolicy {
  readonly [key: string]:
    | Conditions
    | FilterPolicy
    | readonly [FilterPolicy, FilterPolicy, ...FilterPolicy[]]
}
