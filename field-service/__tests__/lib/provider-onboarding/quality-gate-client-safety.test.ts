import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

/**
 * Regression guard for the mobile provider-registration crash.
 *
 * `ProviderRegistrationClient.tsx` is a `'use client'` component that imports
 * pure helpers (`evidenceStepComplete`, `MIN_EVIDENCE_PHOTOS`) from
 * `lib/provider-onboarding/quality-gate.ts`. If that module *statically* pulls
 * in `lib/db.ts` (the Prisma singleton), the whole Prisma client is bundled into
 * the browser. `lib/prisma-service-category-normalization.ts` calls
 * `Prisma.defineExtension(...)` at module scope, which THROWS in a browser
 * ("Extensions.defineExtension is unable to run in this browser environment"),
 * taking the entire registration wizard down to the error boundary.
 *
 * This test walks the static import graph of the client-imported module and
 * asserts `lib/db.ts` is unreachable. It intentionally ignores dynamic
 * `import()` calls, which are code-split and never evaluated on client load.
 */

const FIELD_SERVICE_ROOT = path.resolve(__dirname, '..', '..', '..')

// Modules a `'use client'` file may import directly and expect to stay
// server-free. If any of these ever gains a static path to lib/db, the client
// bundle breaks again.
const CLIENT_ENTRY = 'lib/provider-onboarding/quality-gate.ts'
const FORBIDDEN = 'lib/db.ts'

const EXT_CANDIDATES = ['', '.ts', '.tsx', '.js', '/index.ts', '/index.tsx']

function resolveSpec(spec: string, fromFile: string): string | null {
  let base: string
  if (spec.startsWith('@/')) {
    base = path.join(FIELD_SERVICE_ROOT, spec.slice(2))
  } else if (spec.startsWith('.')) {
    base = path.resolve(path.dirname(fromFile), spec)
  } else {
    // bare package specifier (node_modules) — not first-party, skip
    return null
  }
  for (const ext of EXT_CANDIDATES) {
    const candidate = base + ext
    if (existsSync(candidate)) return candidate
  }
  return null
}

/** Static `import ... from '...'` / `export ... from '...'`, excluding `import type`. */
function staticImportSpecs(source: string): string[] {
  const specs: string[] = []
  const re = /^\s*(?:import|export)\s+(?!type\b)[^;'"]*?\s+from\s+['"]([^'"]+)['"]/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(source)) !== null) specs.push(m[1])
  return specs
}

function staticImportGraph(entry: string): { visited: Set<string>; path: Map<string, string> } {
  const start = path.join(FIELD_SERVICE_ROOT, entry)
  const visited = new Set<string>()
  const parent = new Map<string, string>()
  const stack = [start]
  while (stack.length) {
    const file = stack.pop()!
    if (visited.has(file)) continue
    visited.add(file)
    const source = readFileSync(file, 'utf8')
    for (const spec of staticImportSpecs(source)) {
      const resolved = resolveSpec(spec, file)
      if (resolved && !visited.has(resolved)) {
        if (!parent.has(resolved)) parent.set(resolved, file)
        stack.push(resolved)
      }
    }
  }
  return { visited, path: parent }
}

describe('quality-gate client bundle safety', () => {
  it('does not statically reach lib/db (which would bundle Prisma into the browser)', () => {
    const forbiddenAbs = path.join(FIELD_SERVICE_ROOT, FORBIDDEN)
    const { visited, path: parent } = staticImportGraph(CLIENT_ENTRY)

    if (visited.has(forbiddenAbs)) {
      // Build the offending chain for a readable failure.
      const chain: string[] = []
      let cur: string | undefined = forbiddenAbs
      while (cur) {
        chain.unshift(path.relative(FIELD_SERVICE_ROOT, cur))
        cur = parent.get(cur)
      }
      throw new Error(
        `${CLIENT_ENTRY} statically imports ${FORBIDDEN}, which bundles Prisma into the client and crashes the registration wizard.\nChain:\n  ${chain.join('\n  -> ')}`,
      )
    }

    expect(visited.has(forbiddenAbs)).toBe(false)
  })
})
