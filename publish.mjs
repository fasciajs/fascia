/**
 * What reaches the registry.
 *
 * **The version in a manifest is the whole decision.** A tag named `<package>@<version>` records
 * that the version was published. A package whose tag exists is skipped, so a run that changed no
 * version publishes nothing, and a run that changed one version publishes one package. There is no
 * changeset file and no separate release commit to keep in agreement with the manifests.
 *
 * **A channel other than `latest` writes no ref.** `FASCIA_CHANNEL` names the npm dist-tag. An alpha
 * carries the run number in its version, so no two runs collide and the tag check has nothing to
 * decide. It also comes off a branch, and a branch has no business writing a tag or a release on
 * `main`. `npm install <package>` reaches `latest` only. A consumer asks for the `alpha` tag by
 * name.
 *
 * **Packing and publishing separate, so the job that holds the token runs no code off a branch.**
 * `FASCIA_PACK` names a directory to write a tarball into for each package, in the order they
 * publish. `FASCIA_FROM` names a directory of tarballs to publish. `npm publish` on a tarball reads
 * the tarball and runs nothing inside it, so the second half needs the branch only as data.
 *
 * npm publishes through the OIDC token that the workflow requests, so no token is stored anywhere.
 * A publish under that token carries a provenance attestation, which is why each manifest states
 * `repository`.
 */
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'

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

const channel = process.env.FASCIA_CHANNEL ?? 'latest'

/**
 * Publishing tarballs a previous job packed. This runs before the workspace is read, because this
 * is the half that holds the token and it reads no manifest, no `packages` directory, and no line
 * the branch wrote. `order.json` came from that job, so a name in it is checked against the shape
 * `npm pack` writes rather than trusted.
 */
const from = process.env.FASCIA_FROM
if (from !== undefined) {
  const order = JSON.parse(readFileSync(`${from}/order.json`, 'utf8'))

  // The shape first, then each name. A file holding an object or a string reaches the loop below as
  // something that iterates or does not, and the throw would name neither the file nor the cause.
  if (!Array.isArray(order)) {
    throw new Error(`order.json holds ${typeof order} rather than a list of tarballs`)
  }

  for (const filename of order) {
    if (typeof filename !== 'string' || !/^[\w.-]+\.tgz$/.test(filename)) {
      throw new Error(`order.json names ${JSON.stringify(filename)}, which is no tarball`)
    }
  }

  for (const filename of order) {
    console.log(`publish ${filename} to ${channel}`)
    execFileSync('npm', ['publish', `${from}/${filename}`, '--tag', channel], { stdio: 'inherit' })
  }

  console.log(`published ${order.length} to ${channel}: ${order.join(', ')}`)
  process.exit(0)
}

const published = readdirSync('packages', { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => JSON.parse(readFileSync(`packages/${entry.name}/package.json`, 'utf8')))
  .filter((manifest) => manifest.private !== true)

// A dependent publishes after what it depends on. Between the two publishes a consumer can install
// the dependent, and the dependency it names has to be there when they do.
const ordered = published.toSorted(
  (a, b) => Object.keys(a.dependencies ?? {}).length - Object.keys(b.dependencies ?? {}).length
)

/**
 * Packing for a later job to publish. The order is the order they publish in, and it travels with
 * the tarballs because the job that publishes them reads no manifest.
 */
const into = process.env.FASCIA_PACK
if (into !== undefined) {
  const order = ordered.map((manifest) => {
    const printed = read('npm', 'pack', '-w', manifest.name, '--pack-destination', into, '--silent')
    const filename = printed.trim().split('\n').at(-1)

    // `npm pack` prints the name it wrote. A version of npm that prints nothing would put an empty
    // name in the list, and the job that publishes it would refuse a file this job never named.
    if (filename === undefined || !/^[\w.-]+\.tgz$/.test(filename)) {
      throw new Error(`npm pack wrote no tarball name for ${manifest.name}`)
    }

    console.log(`packed ${manifest.name}@${manifest.version} as ${filename}`)
    return filename
  })

  writeFileSync(`${into}/order.json`, `${JSON.stringify(order, null, 2)}\n`)
  process.exit(0)
}

const records = channel === 'latest'

const existing = records ? new Set(read('git', 'tag').split('\n')) : new Set()
const fresh = []

for (const manifest of ordered) {
  const tag = `${manifest.name}@${manifest.version}`
  if (existing.has(tag)) {
    console.log(`skip ${tag}, the tag exists`)
    continue
  }

  console.log(`publish ${tag} to ${channel}`)
  act('npm', 'publish', '-w', manifest.name, '--tag', channel)
  fresh.push(tag)

  if (!records) continue
  // The tag is pushed here rather than after the loop. A later package that fails ends the run, and
  // what this package published is already recorded, so the next run skips the package instead of
  // publishing a version the registry holds and refusing.
  act('git', 'tag', tag)
  act('git', 'push', 'origin', tag)
}

if (fresh.length === 0) {
  console.log('no version changed, so nothing published')
  process.exit(0)
}

if (records) for (const tag of fresh) act('gh', 'release', 'create', tag, '--generate-notes')

console.log(`published ${fresh.length} to ${channel}: ${fresh.join(', ')}`)
