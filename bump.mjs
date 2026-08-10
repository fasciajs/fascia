/**
 * What a release is numbered.
 *
 * **Every published package carries one version, and a dependency between two of them states that
 * same version exactly.** A consumer who installs one package and reads its manifest learns which
 * build of every other package it was written against, without a range to resolve. Ten packages
 * that are ten readings of one core have nothing to say by moving apart.
 *
 * `npm version --workspaces` raises each version and leaves the pins behind, which points the
 * workspace at a version the registry does not hold. This writes both in one pass.
 *
 * Run `node bump.mjs 0.1.0`, then read the diff, then commit. Publishing is a separate step.
 */
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'

const version = process.argv[2]

// A version is the one argument, and a wrong one is a mistake to report rather than a state to
// carry into ten files.
if (version === undefined || !/^\d+\.\d+\.\d+(-[\w.]+)*$/.test(version)) {
  console.error(`usage: node bump.mjs <version>, where a version reads 1.2.3 or 1.2.3-rc.1`)
  process.exit(1)
}

const roots = ['packages', 'internal']

const manifests = roots.flatMap((root) =>
  readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `${root}/${entry.name}/package.json`)
    .map((at) => ({ at, manifest: JSON.parse(readFileSync(at, 'utf8')) }))
)

// A private package takes no version and reaches no registry. A private package can still depend on
// a published one, and that pin is rewritten like any other.
const names = new Set(
  manifests.filter(({ manifest }) => manifest.private !== true).map(({ manifest }) => manifest.name)
)

if (names.size === 0) {
  console.error('no published package found under packages/ or internal/')
  process.exit(1)
}

for (const { at, manifest } of manifests) {
  const written = manifest.private === true ? manifest : { ...manifest, version }

  for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
    const declared = written[field]
    if (declared === undefined) continue
    for (const name of Object.keys(declared)) {
      if (names.has(name)) declared[name] = version
    }
  }

  writeFileSync(at, `${JSON.stringify(written, null, 2)}\n`)
}

console.log(`wrote ${version} to ${names.size} published packages and every pin between them`)

// The lockfile states a version for each workspace package. `npm ci` reads the lockfile and refuses
// a lockfile that disagrees with a manifest, so the lockfile is part of the same change.
execFileSync('npm', ['install', '--package-lock-only'], { stdio: 'inherit' })
