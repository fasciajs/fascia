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

const packages = readdirSync('packages', { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)

interface Packed {
  readonly name: string
  readonly manifest: { exports: Record<string, Record<string, string>>; files: string[] }
  readonly files: readonly string[]
}

let packed: Packed[] = []

beforeAll(() => {
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

  it('ships a private package to nobody', () => {
    // `internal/grammar` is a workspace and not a package, so nothing above ever reaches it.
    expect(readdirSync('internal')).toContain('grammar')
    expect(packed.map((one) => one.name)).not.toContain('grammar')
  })
})
