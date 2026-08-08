/**
 * A failure is a value, and the value is the error.
 *
 * A function that can fail returns `Happy | SomeError`, so the signature states every failure the
 * function has. Nothing wraps the happy path, and a caller reads the happy value without unwrapping
 * a container.
 *
 * A caller that does not branch cannot use the value: no property exists on every arm of the union,
 * so the compiler refuses the read.
 */
export abstract class FasciaError<T> extends Error {
  context: T
  protected constructor(message: string, context: T) {
    super(message)
    // The concrete class, so a message names the failure rather than the base.
    this.name = new.target.name
    this.context = context
  }
}

/**
 * Whether this value is a failure.
 *
 * `Extract<T, Error>` selects the failure arms of the union, so the true branch holds every
 * failure and the false branch holds the happy value. Neither arm is named at the call site.
 *
 * The test is `instanceof Error`, so every error is a failure and not only the ones this library
 * declares. A native error that a vendor library returns rather than throws reads as a failure of
 * whatever function returned the error, under a type that does not name the error.
 */
export function isError<T>(value: T): value is Extract<T, Error> {
  return value instanceof Error
}
