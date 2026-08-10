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
    // A subpath states a file directly or states one per condition. `./package.json` is the first
    // kind, because a reader of a manifest asks for the file and not for a build of it.
    exports: Record<string, Record<string, string> | string>
    files: string[]
    sideEffects?: boolean
    keywords?: string[]
  }
  readonly files: readonly string[]
}

let packed: Packed[] = []

/**
 * npm on windows is a `.cmd` shim. `execFileSync` resolves the file itself rather than through a
 * shell, and Node refuses to spawn a `.cmd` without one since it closed CVE-2024-27980. Passing
 * `shell: true` answers that and then splits an argument on a space, which a temporary path holds
 * on a developer's machine.
 *
 * A tarball does not vary by the OS that packed it, and publishing runs on linux. So this asks its
 * question where the question is asked for real, and the rest of the suite still runs everywhere.
 */
const packs = describe.skipIf(process.platform === 'win32')

beforeAll(() => {
  if (process.platform === 'win32') return

  const out = mkdtempSync(join(tmpdir(), 'fascia-pack-'))

  try {
    packed = packages.map((name) => {
      execFileSync('npm', ['pack', `./packages/${name}`, '--pack-destination', out, '--silent'], {
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

packs('a package ships every file it says it has', () => {
  it('packs one tarball per package', () => {
    expect(packed).toHaveLength(packages.length)
  })

  it('ships the file behind every condition of every export', () => {
    // The invariant `files` and `exports` can break between them. A condition naming a file the
    // tarball does not hold is a package that installs and fails on the first import, and neither
    // list says so on its own.
    for (const one of packed) {
      for (const [subpath, target] of Object.entries(one.manifest.exports)) {
        const named =
          typeof target === 'string'
            ? [[subpath, target] as const]
            : Object.entries(target).map(([condition, at]) => [condition, at] as const)

        for (const [condition, at] of named) {
          expect(one.files, `${one.name} names ${at} under ${condition}`).toContain(
            at.replace(/^\.\//, '')
          )
        }
      }
    }
  })

  it('lets a reader ask for the manifest, which tooling does', () => {
    // A subpath a package does not name is a subpath Node refuses. A build tool that reads a
    // dependency's version or its `type` reads `package.json`, and without this every such read
    // throws ERR_PACKAGE_PATH_NOT_EXPORTED.
    for (const one of packed) {
      expect(one.manifest.exports['./package.json'], `${one.name} hides its manifest`).toBe(
        './package.json'
      )
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

  it('states the words somebody would search for', () => {
    // Registry search reads `keywords` and reads no other field this way. A package published
    // without them is a package nobody reaches except by its exact name, and `0.1.0` went out that
    // way. The two shared words put every package in one result, and the rest name what this one
    // package reads or writes.
    for (const one of packed) {
      expect(one.manifest.keywords ?? [], `${one.name} states none`).toEqual(
        expect.arrayContaining(['schema', 'fascia'])
      )
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
