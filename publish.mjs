/**
 * What reaches the registry.
 *
 * **The version in a manifest is the whole decision.** A tag named `<package>@<version>` records
 * that the version was published. A package whose tag exists is skipped, so a run that changed no
 * version publishes nothing, and a run that changed one version publishes one package. There is no
 * changeset file and no separate release commit to keep in agreement with the manifests.
 *
 * npm publishes through the OIDC token that the workflow requests, so no token is stored anywhere.
 * A publish under that token carries a provenance attestation, which is why each manifest states
 * `repository`.
 */
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'

/**
 * Each command runs through `execFileSync` with the arguments as a list, so no shell reads them. A
 * package name and a version reach the command as they are written, and a character that a shell
 * would treat as syntax is one more character of an argument here.
 *
 * `read` captures the output of a command that answers a question. `act` lets the output of a
 * command that changes something reach the log of the run, which is the only record of what npm
 * did. Both throw on a non-zero exit, and the message of the throw carries the stderr of the
 * command, so the publish stops at the first failure and names the cause.
 */
const read = (file, ...args) => execFileSync(file, args, { encoding: 'utf8' })
const act = (file, ...args) => execFileSync(file, args, { stdio: 'inherit' })

const published = readdirSync('packages', { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => JSON.parse(readFileSync(`packages/${entry.name}/package.json`, 'utf8')))
  .filter((manifest) => manifest.private !== true)

// A dependent publishes after what it depends on. Between the two publishes a consumer can install
// the dependent, and the dependency it names has to be there when they do.
const ordered = published.toSorted(
  (a, b) => Object.keys(a.dependencies ?? {}).length - Object.keys(b.dependencies ?? {}).length
)

const existing = new Set(read('git', 'tag').split('\n'))
const fresh = []

for (const manifest of ordered) {
  const tag = `${manifest.name}@${manifest.version}`
  if (existing.has(tag)) {
    console.log(`skip ${tag}, the tag exists`)
    continue
  }

  console.log(`publish ${tag}`)
  act('npm', 'publish', '-w', manifest.name)
  // The tag is pushed here rather than after the loop. A later package that fails ends the run, and
  // what this package published is already recorded, so the next run skips the package instead of
  // publishing a version the registry holds and refusing.
  act('git', 'tag', tag)
  act('git', 'push', 'origin', tag)
  fresh.push(tag)
}

if (fresh.length === 0) {
  console.log('no version changed, so nothing published')
  process.exit(0)
}

for (const tag of fresh) act('gh', 'release', 'create', tag, '--generate-notes')

console.log(`published ${fresh.length}: ${fresh.join(', ')}`)
