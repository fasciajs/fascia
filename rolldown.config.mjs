import { readdirSync, readFileSync } from 'node:fs'
import { defineConfig } from 'rolldown'
import { dts } from 'rolldown-plugin-dts'

/**
 * What each package publishes.
 *
 * **Every package here is a leaf plus its dependencies, and nothing is bundled that a consumer
 * installs.** A dependency named in a package's manifest is external, so `@fasciajs/openapi` ships
 * one file that imports `@fasciajs/core` rather than a copy of it. A copy would give a consumer two
 * terms that are structurally alike and not the same, and every `instanceof` across the boundary
 * would answer wrong.
 *
 * The packages are read off the workspace rather than listed. A package added without being built is
 * a package that publishes an empty directory, and this is the one place that could happen.
 */
const roots = ['packages']

const published = roots.flatMap((root) =>
  readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `${root}/${entry.name}`)
    .filter((at) => {
      const manifest = JSON.parse(readFileSync(`${at}/package.json`, 'utf8'))
      return manifest.private !== true
    })
)

export default published.map((at) => {
  const manifest = JSON.parse(readFileSync(`${at}/package.json`, 'utf8'))
  const named = [
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {})
  ]

  return defineConfig({
    input: `${at}/src/index.ts`,
    output: { dir: `${at}/dist`, format: 'esm', sourcemap: true },
    // A dependency a consumer installs is imported rather than copied. Anything else named in the
    // manifest is external too, so a subpath of one is matched as well as the name itself.
    external: (id) => named.some((name) => id === name || id.startsWith(`${name}/`)),
    plugins: [dts({ tsconfig: 'tsconfig.build.json' })],
    platform: 'neutral'
  })
})
