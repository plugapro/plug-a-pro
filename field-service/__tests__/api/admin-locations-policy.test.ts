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
})
