import { readdirSync, readFileSync, statSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * **The escape hatches, counted over the whole tree rather than over a list.**
 *
 * A cast, a non-null assertion and a suppression each tell the compiler to stop asking. One at the
 * boundary is sanctioned and the reason is written beside it; the type checker cannot tell that one
 * from a cast that hides a defect, and neither can a review that reads the files it thought to open.
 *
 * **A guard that names what it guards is silent about the rest.** So this walks the tree and holds
 * every file it finds, rather than holding a list somebody maintains. A package added tomorrow is
 * guarded on the day it is added, and the second block below is what says so: a directory under
 * `packages/` or `internal/` that this walk never reached is a failure here, not a gap nobody sees.
 *
 * The counts are held per file and fail on a rise. They are not a budget to spend. A number that
 * falls is a hatch closed, and lowering the number written here is how the fall is kept.
 */

/**
 * A path under the repository, written with `/` on every platform.
 *
 * `node:path` joins with the separator the host uses, and the counts below are keyed by the path, so
 * a census taken on Windows matched none of them and reported every file as a hatch closed. Node
 * reads a path spelled this way on Windows too, and a key that reads the same everywhere is what a
 * recorded number needs.
 */
function at(...parts: readonly string[]): string {
  return parts.join('/')
}

/** Where the source lives. A spec is not held: a cast in a test states what the test is about. */
const ROOTS = ['packages', 'internal'] as const

/**
 * What each file may still hold, and nothing more. A rise fails; a fall is written down here.
 *
 * Every one of these sits in a frontend, a target, or a grammar. `packages/core/src` holds none, and
 * that is the shape the rule asks for: a cast belongs where a third-party type is read, and the
 * waist reads nobody's types. The reason for each one is not held here. The count is what a guard
 * can check; whether the reason beside a cast is a good one is a reader's question.
 */
const SANCTIONED: ReadonlyMap<string, number> = new Map([
  ['internal/grammar/src/arktype.ts', 2],
  ['internal/grammar/src/valibot.ts', 5],
  ['packages/json-schema/src/refs.ts', 2],
  ['packages/json-schema/src/spell.ts', 1],
  ['packages/mcp/src/tools.ts', 2],
  ['packages/openapi/src/document.ts', 2],
  ['packages/openapi/src/v30.ts', 8],
  ['packages/valibot/src/read.ts', 5],
  ['packages/valibot/src/valibot-types.ts', 1],
  ['packages/zod/src/read.ts', 1],
  ['packages/zod/src/zod-checks.ts', 1],
  ['packages/zod/src/zod-types.ts', 2]
])

interface Hatch {
  readonly at: string
  readonly said: string
}

/**
 * The text with every comment and every literal removed.
 *
 * A cast is a token and prose is not. `read as a kind` in a sentence and `'a' as const` in a string
 * are both text that names nothing, and counting them would make the census a measure of how much
 * this codebase explains itself.
 */
function code(text: string): string {
  let out = ''
  let index = 0
  while (index < text.length) {
    const here = text.slice(index)
    if (here.startsWith('//')) {
      const end = text.indexOf('\n', index)
      index = end === -1 ? text.length : end
      continue
    }
    if (here.startsWith('/*')) {
      const end = text.indexOf('*/', index + 2)
      index = end === -1 ? text.length : end + 2
      out += ' '
      continue
    }
    const quote = here[0]
    if (quote === "'" || quote === '"' || quote === '`') {
      index += 1
      while (index < text.length && text[index] !== quote) {
        index += text[index] === '\\' ? 2 : 1
      }
      index += 1
      out += ' '
      continue
    }
    out += text[index]
    index += 1
  }
  return out
}

/** Every escape hatch one file holds. */
function hatchesIn(at: string, text: string): readonly Hatch[] {
  const found: Hatch[] = []

  // Read before the comments go, because a suppression is a comment.
  for (const suppression of text.match(/@ts-(expect-error|ignore|nocheck)/g) ?? []) {
    found.push({ at, said: `a suppression: ${suppression}` })
  }

  // An import and a re-export both spell a rename with `as`, and a rename is not a cast.
  const written = code(text).replace(/\b(?:import|export)\b[\s\S]*?\bfrom\s*(?=\s|$)/g, ' ')

  for (const cast of written.match(/\bas\s+(?!const\b)[A-Za-z_$][\w$]*/g) ?? []) {
    found.push({ at, said: `a cast: ${cast.replace(/\s+/g, ' ')}` })
  }
  for (const permissive of written.match(/:\s*any\b|<any>|\bany\[\]/g) ?? []) {
    found.push({ at, said: `a permissive type: ${permissive.trim()}` })
  }
  for (const assertion of written.match(/[\w$)\]]!\s*[.[(]/g) ?? []) {
    found.push({ at, said: `an assertion that a value exists: ${assertion.trim()}` })
  }

  return found
}

function filesUnder(under: string): readonly string[] {
  const found: string[] = []
  for (const entry of readdirSync(under, { withFileTypes: true })) {
    const path = at(under, entry.name)
    if (entry.isDirectory()) {
      found.push(...filesUnder(path))
    } else if (entry.name.endsWith('.ts')) {
      found.push(path)
    }
  }
  return found
}

/** Every source directory the tree holds, found rather than named. */
function sourceDirectories(): readonly { readonly of: string; readonly src: string }[] {
  const found: { of: string; src: string }[] = []
  for (const root of ROOTS) {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue
      }
      const src = at(root, entry.name, 'src')
      try {
        if (statSync(src).isDirectory()) {
          found.push({ of: at(root, entry.name), src })
        }
      } catch {
        // A package with no `src` ships nothing this guard is about.
      }
    }
  }
  return found
}

const directories = sourceDirectories()
const census = new Map<string, readonly Hatch[]>()
for (const { src } of directories) {
  for (const file of filesUnder(src)) {
    const found = hatchesIn(file, readFileSync(file, 'utf8'))
    if (found.length > 0) {
      census.set(file, found)
    }
  }
}

describe('the escape hatches are held to what was sanctioned', () => {
  it('holds every file to its count, and a rise names the file', () => {
    const risen = [...census]
      .map(([at, found]) => ({ at, was: SANCTIONED.get(at) ?? 0, now: found.length }))
      .filter((one) => one.now > one.was)
      .sort((left, right) => left.at.localeCompare(right.at))

    if (risen.length > 0) {
      console.log(
        `census:\n${[...census]
          .map(([at, found]) => `  ['${at}', ${found.length}],`)
          .sort()
          .join('\n')}`
      )
      console.log(
        `first rise: ${risen[0]?.at} holds ${risen[0]?.now}\n${(
          census.get(risen[0]?.at ?? '') ?? []
        )
          .map((one) => `  ${one.said}`)
          .join('\n')}`
      )
    }

    expect(risen).toEqual([])
  })

  it('holds a file whose count fell to the lower count, so a hatch closed stays closed', () => {
    const fallen = [...SANCTIONED]
      .map(([at, was]) => ({ at, was, now: census.get(at)?.length ?? 0 }))
      .filter((one) => one.now < one.was)

    expect(fallen).toEqual([])
  })
})

describe('the guard reaches the whole tree', () => {
  it('finds the source of every package, so a package laid out differently is not passed over', () => {
    // The walk asks the filesystem rather than a list, and the one thing it assumes is where the
    // source sits. A package that keeps its source elsewhere would be held to nothing, and the
    // guard would report a clean tree it never read.
    const named = ROOTS.flatMap((root) =>
      readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => at(root, entry.name))
    )

    expect(named.filter((of) => !directories.some((one) => one.of === of))).toEqual([])
    expect(directories.every(({ src }) => filesUnder(src).length > 0)).toBe(true)
  })
})
