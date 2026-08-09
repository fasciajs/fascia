import { defineConfig } from 'vitest/config'

export default defineConfig({
  // A package resolves to its source, not to its build output. The suite checks this repository
  // rather than an artefact of it, so a spec fails on the edit and not on the build after the edit.
  //
  // Stated as the condition each package's own `exports` names, rather than as a list of packages
  // here. The list was one entry short of the workspace already, and a package added without being
  // listed would have been checked against whatever was last built.
  //
  // The condition is named for this library rather than `development`, which anyone may set for
  // their own reasons. A consumer who set that one would have resolved a package to source this
  // repository compiles under its own flags and theirs may not.
  resolve: { conditions: ['fascia-source'] },

  test: {
    environment: 'node',
    include: ['packages/*/spec/**/*.spec.ts', 'spec/**/*.spec.ts'],

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
