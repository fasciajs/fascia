import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * **What each package ships, asked of the tarball rather than of the manifest.**
 *
 * Every other check in this repository reads the source. None of them can see what a consumer
 * receives: `files` and `exports` are two lists that have to agree with each other and with what the
 * build produced, and nothing compares the three. A package whose `exports` names a file it does not
 * ship installs and then fails on the first import.
 *
 * `npm pack` is the answer, because it is what publishing does. It is also the check that says npm
 * does not replace `exports` from `publishConfig` when it packs, which is why this library does not
 * rely on it doing so when it publishes.
 */

const declares = (at: string): { private?: boolean } => JSON.parse(readFileSync(at, 'utf8'))

// A private package reaches no registry, and `rolldown.config.mjs` reads the same flag to decide
// what to build. Packing one asks what a consumer receives of a package no consumer receives.
const packages = readdirSync('packages', { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .filter((name) => declares(`packages/${name}/package.json`).private !== true)

interface Packed {
  readonly name: string
  readonly manifest: {
    exports: Record<string, Record<string, string>>
    files: string[]
    sideEffects?: boolean
  }
  readonly files: readonly string[]
}

let packed: Packed[] = []

// `execFileSync` resolves the file itself rather than through a shell, and a shell is what reads
// PATHEXT. npm on windows is `npm.cmd`, and the bare name finds nothing there.
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'

beforeAll(() => {
  const out = mkdtempSync(join(tmpdir(), 'fascia-pack-'))

  try {
    packed = packages.map((name) => {
      execFileSync(npm, ['pack', `./packages/${name}`, '--pack-destination', out, '--silent'], {
        encoding: 'utf8'
      })

      const [tarball] = readdirSync(out).filter((file) => file.includes(name))
      if (tarball === undefined) {
        throw new Error(`nothing was packed for ${name}`)
      }

      const listed = execFileSync('tar', ['-tzf', join(out, tarball)], { encoding: 'utf8' })
      const manifest = execFileSync('tar', ['-xzOf', join(out, tarball), 'package/package.json'], {
        encoding: 'utf8'
      })

      return {
        name,
        manifest: JSON.parse(manifest),
        files: listed
          .trim()
          .split('\n')
          .map((one) => one.replace(/^package\//, ''))
      }
    })
  } finally {
    rmSync(out, { recursive: true, force: true })
  }
}, 120_000)

describe('the suite reads the source rather than the build', () => {
  it('resolves a package to the file its own condition names', async () => {
    // This was wrong once and nothing said so. Setting the condition on one side of vitest left
    // every package resolving to whatever was last built, so a spec would have passed over an edit
    // until somebody rebuilt. The import below is the same one every spec makes, and the assertion
    // is that what answered it is a file under `src`.
    const core = await import('@fasciajs/core')
    const at = import.meta.resolve('@fasciajs/core')

    expect(at, 'a package resolved to its build output').toContain('/src/')
    expect(typeof core.isError).toBe('function')
  })
})

describe('a package ships every file it says it has', () => {
  it('packs one tarball per package', () => {
    expect(packed).toHaveLength(packages.length)
  })

  it('ships the file behind every condition of every export', () => {
    // The invariant `files` and `exports` can break between them. A condition naming a file the
    // tarball does not hold is a package that installs and fails on the first import, and neither
    // list says so on its own.
    for (const one of packed) {
      for (const conditions of Object.values(one.manifest.exports)) {
        for (const [condition, at] of Object.entries(conditions)) {
          expect(one.files, `${one.name} names ${at} under ${condition}`).toContain(
            at.replace(/^\.\//, '')
          )
        }
      }
    }
  })

  it('ships no spec, and nothing a consumer would run a check with', () => {
    for (const one of packed) {
      const unwanted = one.files.filter(
        (file) => /(^|\/)spec\//.test(file) || file.endsWith('.spec.ts') || file.includes('/lib/')
      )
      expect(unwanted, `${one.name} ships ${unwanted.join(', ')}`).toEqual([])
    }
  })

  it('states that importing it does nothing', () => {
    // Every file here declares and nothing else, so an export nobody uses is an export a bundler
    // may drop. Stated in the manifest because a bundler cannot see it any other way, and asserted
    // here because a package added without it would quietly stop being droppable.
    for (const one of packed) {
      expect(one.manifest.sideEffects, `${one.name} does not say`).toBe(false)
    }
  })

  it('ships a README, which npm includes whether files names it or not', () => {
    // A package added without one publishes a page that says only its name. npm puts a README in
    // the tarball on its own, so nothing about `files` would have said this was missing.
    for (const one of packed) {
      expect(one.files, `${one.name} ships no README`).toContain('README.md')
    }
  })

  it('ships a private package to nobody', () => {
    // `internal/grammar` is a workspace and not a package, so nothing above ever reaches it.
    // `packages/dynamodb` is a package that is not ready, and `private` is the whole of what holds
    // it back. A package sitting beside nine that publish is the case where the flag is easy to
    // drop by accident.
    expect(readdirSync('internal')).toContain('grammar')
    expect(readdirSync('packages')).toContain('dynamodb')
    expect(packed.map((one) => one.name)).not.toContain('grammar')
    expect(packed.map((one) => one.name)).not.toContain('dynamodb')
  })
})
