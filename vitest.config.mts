import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // A package resolves to its source, not to its build output. The suite checks this repository
  // rather than an artefact of it, so a spec fails on the edit and not on the build after the edit.
  resolve: {
    alias: {
      '@fasciajs/core': resolve('packages/core/src/index.ts'),
      '@fasciajs/zod': resolve('packages/zod/src/index.ts'),
      '@fasciajs/arktype': resolve('packages/arktype/src/index.ts'),
      '@fasciajs/effect': resolve('packages/effect/src/index.ts'),
      '@fasciajs/atd': resolve('packages/atd/src/index.ts'),
      '@fasciajs/json-schema': resolve('packages/json-schema/src/index.ts')
    }
  },
  test: {
    environment: 'node',
    include: ['packages/*/spec/**/*.spec.ts'],

    // No global names. Each spec imports what the spec uses, so a spec is a module rather than a
    // file that runs only inside a runner that injected names into the file.
    globals: false,

    // Printed output is part of a check. Vitest buffers console output by default, which removes a
    // number that a standing check reads.
    disableConsoleIntercept: true,

    // `@ark/attest`, which makes a claim about a type into an assertion that names the clause the
    // compiler refused the code with.
    globalSetup: ['./vitest.setup.mts']
  }
})
