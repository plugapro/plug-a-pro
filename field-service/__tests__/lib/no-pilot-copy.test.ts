import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

// Phrases that described the Johannesburg launch fence. After the national
// rollout (docs/superpowers/specs/2026-10-03-national-rollout-design.md) none
// of them may appear in provider- or customer-facing code.
const FORBIDDEN_PHRASES = [
  'West Rand first',
  'Gauteng only',
  'live for leads',
  'open to register',
  'not live yet',
  'Not yet active',
  'Active pilot',
  'Currently serving',
] as const

// Left in place by the spec ("Out of scope"): the flag-gated West Rand pilot
// allowlist and its readiness/nudge consoles, and the advisory ops agents.
const EXCLUDED_DIRS = ['lib/launch', 'lib/nudges', 'lib/ops-agents'] as const

const SCAN_ROOTS = ['lib', 'components'] as const
const SOURCE_EXT = /\.(ts|tsx)$/

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (SOURCE_EXT.test(entry)) out.push(full)
  }
  return out
}

function isExcluded(relPath: string): boolean {
  const posix = relPath.split(sep).join('/')
  return EXCLUDED_DIRS.some((d) => posix === d || posix.startsWith(`${d}/`))
}

describe('no launch-fence copy remains in lib/ or components/', () => {
  const root = process.cwd() // vitest runs from field-service/
  const files = SCAN_ROOTS.flatMap((r) => walk(join(root, r)))
    .map((f) => relative(root, f))
    .filter((f) => !isExcluded(f))

  it('scans a meaningful number of source files', () => {
    expect(files.length).toBeGreaterThan(100)
  })

  for (const phrase of FORBIDDEN_PHRASES) {
    it(`no file contains "${phrase}"`, () => {
      const offenders = files.filter((f) => readFileSync(join(root, f), 'utf8').includes(phrase))
      expect(offenders).toEqual([])
    })
  }
})
