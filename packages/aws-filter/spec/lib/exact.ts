/**
 * JSON read so a number keeps the value its text states.
 *
 * JSON.parse rounds a number to the nearest double, and SNS and Lambda refuse a bound that no double
 * holds. A number whose double prints back as another value is read as `Unheld`, so neither function
 * beside this file compares the rounded double in its place.
 */
export class Unheld {
  readonly text: string

  constructor(text: string) {
    this.text = text
  }

  /** Whether the text states a fraction. SNS reads such a bound rounded, and Lambda refuses it. */
  get fraction(): boolean {
    return this.text.includes('.')
  }
}

export function exactly(text: string): unknown {
  // Node passes the source text of each primitive as a third argument the lib does not declare.
  return JSON.parse(text, (_key, value: unknown, context?: { readonly source?: string }) =>
    typeof value === 'number' &&
    context?.source !== undefined &&
    decimal(context.source) !== decimal(String(value))
      ? new Unheld(context.source)
      : value
  )
}

/** A number's text as digits and an exponent, so two spellings of one value compare equal. */
function decimal(text: string): string {
  const [, sign = '', whole = '', fraction = '', exponent = '0'] =
    /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(text) ?? []
  let digits = (whole + fraction).replace(/^0+/, '')
  let power = Number(exponent) - fraction.length
  while (digits.endsWith('0')) {
    digits = digits.slice(0, -1)
    power += 1
  }
  return digits === '' ? '0' : `${sign}${digits}e${power}`
}
