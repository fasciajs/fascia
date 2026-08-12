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

Read the diff. Commit. Merge. The merge releases, because `publish.yml` runs on a push to `main`.
So merging the bump is the last step a person takes, and the diff is the last chance to read it.

A merge that carries no bump publishes nothing, because every version already has a tag.

`npm version --workspaces` raises each version and leaves the pins behind, which points the
workspace at a version the registry does not hold. Use `bump.mjs` instead.

`publish.mjs` publishes a package only when the tag `<package>@<version>` is absent, and it pushes
each tag as soon as the package it names is published. A run that changed no version publishes
nothing. A run that failed halfway resumes rather than repeats.

## Publishing a branch as an alpha

Comment `/alpha` on the pull request. The workflow builds the branch, publishes every package under
the `alpha` dist-tag, and replies with the version.

```sh
npm install @fasciajs/core@alpha @fasciajs/openapi@alpha
```

The version is the one the branch states, then the run number, then the commit: a branch at `0.2.0`
publishes `0.2.0-alpha.7.gc8749a6`. That sorts below `0.2.0`, so the release that follows wins.
`latest` does not move, and no tag and no release are written.

The run number comes before the commit because a prerelease compares identifier by identifier, and
a numeric one compares as a number. A commit alone would order two alphas by ASCII rather than by
time. The `g` before the commit is what `git describe` writes, and it is load-bearing: a short hash
of digits alone is a numeric identifier, and one leading zero makes the whole version invalid.

Run `node bump.mjs <next version>` on the branch first. A branch that still states the last released
version would publish an alpha that sorts below it, so the workflow refuses one and says so.

Three conditions gate the comment, and each one is necessary. The comment is on a pull request. The
commenter is an owner, a member, or a collaborator. The pull request comes from a branch of this
repository rather than from a fork.

The job builds and publishes the code on the branch, so a person who can start it can put code of
their choosing on the registry. The three conditions are what stands there. GitHub reads
`publish.yml` from `main` for a comment event, so a pull request cannot edit the conditions that
gate itself.

The alpha lives in `publish.yml` beside the release because npm registers a trusted publisher
against a repository and a workflow file name. A second file would need its own registration on
every package.

## How the workflow authenticates

No secret exists. The workflow publishes through an OIDC token that GitHub mints for it, and npm
accepts that token only from `publish.yml` in `fasciajs/fascia`. Each of the nine packages names
that pair as its trusted publisher.

```sh
npm trust list @fasciajs/core     # type, file, repository, permissions
```

`publish.yml` declares no `environment`, and the trusted publisher registers none. Adding one on
either side alone makes every release fail the check.

## Adding a package to the registry

npm configures a trusted publisher only for a package that exists. So a new name is published one
time by a person, and the workflow does every release after that.

```sh
npm login
npm run build
npm publish -w @fasciajs/<name>
npm trust github @fasciajs/<name> --file publish.yml --repository fasciajs/fascia --allow-publish
```

Run `npm trust` in a terminal. npm needs a second factor for the call, and it cannot ask for one
where there is no terminal to ask in.

That first publish carries no provenance attestation, because provenance needs the OIDC token that
only the workflow holds. Every release after it carries one.
