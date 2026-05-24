import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

function readRoute(path: string) {
  return readFileSync(join(process.cwd(), path), 'utf8')
}

describe('admin location API policy boundary', () => {
  it('does not bypass audited location server actions for mutations', () => {
    const collectionRoute = readRoute('app/api/admin/locations/route.ts')
    const itemRoute = readRoute('app/api/admin/locations/[id]/route.ts')

    expect(collectionRoute).not.toContain('createLocationNode }')
    expect(collectionRoute).toContain('createLocationNodeAction')

    expect(itemRoute).not.toContain('updateLocationNode,')
    expect(itemRoute).not.toContain('deleteLocationNode,')
    expect(itemRoute).toContain('updateLocationNodeAction')
    expect(itemRoute).toContain('deleteLocationNodeAction')
  })

  it('keeps hard and fallback location deletes OWNER-only', () => {
    const actions = readRoute('app/(admin)/admin/locations/actions.ts')

    expect(actions).toContain("action: 'location.delete'")
    expect(actions).toContain("requiredRole: ['OWNER']")
    expect(actions).not.toContain("requiredRole: ['ADMIN', 'OWNER']")
  })
})
