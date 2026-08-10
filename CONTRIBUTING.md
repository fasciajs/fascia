# Contributing

Node 24, in the devcontainer at `.devcontainer/devcontainer.json`. Run every command inside the
container.

`CLAUDE.md` states the rules this code is written under. Read it before you change anything.

## The loop

```sh
npm run check     # types, then lint, then the suite
npm run format    # apply the formatter
```

Work on a branch. Open a pull request. `pr.yml` runs `npm run check` on ubuntu, then runs the suite
alone on windows, on macos, and on two more Node versions. Wait for the `pr` job, which is the one
job the branch rule names.

A merge publishes nothing. A release is a separate step that a person starts.

## Adding a dependency

```sh
npm install <name> -w <package>
```

Two things differ from a workspace without this repository's settings.

**A version published in the last 24 hours does not resolve.** `.npmrc` sets `min-release-age=1440`.
A compromised release is normally found and unpublished inside that window. Pass
`--min-release-age=0` for one command when you need a version sooner.

**npm 12 runs no install script from a dependency.** Run `npm approve-scripts` if a new dependency
needs one. Approve what you trust, then commit the manifest.

## Adding a package

Create `packages/<name>/` with `package.json`, `src/index.ts`, and `README.md`. Copy the manifest of
a package that is already there. The manifest states:

| field | why |
| --- | --- |
| `version` | the number every published package here shares |
| `repository.directory` | npm refuses to attest provenance without it |
| `publishConfig.access` | a scoped package publishes private without it |
| `sideEffects: false` | a bundler cannot see this any other way |
| `exports` with `fascia-source` | the suite reads the source rather than the build |
| `files` | what reaches the tarball |

Run `npm install` to link the package. Nothing else registers it. `rolldown.config.mjs`,
`publish.mjs`, and `bump.mjs` each read the directory, and `spec/packaging.spec.ts` packs every
package and asserts the manifest agrees with the tarball.

## A package that is not ready

Set `private: true` in the manifest. The build skips the package, the publish skips the package, and
the packaging spec skips the package. The package still lives in the workspace, and the suite still
runs against it.

`packages/dynamodb` is such a package today. Two assertions in `spec/packaging.spec.ts` name it.
When the package is ready, delete the `private` line, then delete those two assertions.

## Releasing

Every published package carries one version, and a dependency between two of them states that same
version exactly. Ten packages that are ten readings of one core have nothing to say by moving apart.

Write the entry in `CHANGELOG.md` first. One entry covers every package, and a reader learns what
moved from that entry alone.

```sh
node bump.mjs 0.2.0     # ten versions, eleven pins, and the lockfile
```

Read the diff. Commit. Merge. Then start `publish.yml` from the Actions tab.

`npm version --workspaces` raises each version and leaves the pins behind, which points the
workspace at a version the registry does not hold. Use `bump.mjs` instead.

`publish.mjs` publishes a package only when the tag `<package>@<version>` is absent, and it pushes
each tag as soon as the package it names is published. A run that changed no version publishes
nothing. A run that failed halfway resumes rather than repeats.

## Before the first release

Three things, one time.

Configure trusted publishing on npmjs.com for each package. Name the repository `fasciajs/fascia`
and the workflow `publish.yml`. The workflow then publishes through an OIDC token, and no secret is
stored anywhere.

npm configures a trusted publisher only for a package that exists. So the first publish of each name
needs a token, or a publish from your machine.

Change `on: workflow_dispatch` in `publish.yml` to `push: branches: [main]` when you want a merge to
release. Do this after the versions leave `0.0.0`.
