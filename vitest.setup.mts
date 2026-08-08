import { cleanup, setup } from '@ark/attest'

/**
 * Analyses the project once, so that a claim about a type is a runtime assertion.
 *
 * In the main run rather than behind a second command. A check that runs separately is a check
 * someone forgets, and a type claim is the one this suite most needs held: `@ts-expect-error` is
 * satisfied by any error at all, including one from a rename that broke the line for another reason.
 */
export default () => {
  const teardown = setup({
    /**
     * An instantiation budget that is exceeded must fail rather than print.
     *
     * `'types'` rather than `true` on purpose. An instantiation count is deterministic for a given
     * TypeScript version, so a budget over the count is an invariant. A wall clock median is a fact
     * about the machine that ran the check, so a budget over the median buys a check that fails for
     * reasons that have nothing to do with the code.
     */
    benchErrorOnThresholdExceeded: 'types'
  })

  return () => {
    teardown()
    cleanup()
  }
}
