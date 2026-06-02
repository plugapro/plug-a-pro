import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

describe('provider applications admin layout', () => {
  it('keeps approved providers collapsed until an admin expands the row', () => {
    const source = readFileSync(join(process.cwd(), 'app/(admin)/admin/applications/page.tsx'), 'utf8')

    expect(source).toContain('data-admin-application-row="approved-provider"')
    expect(source).toContain('data-admin-application-details="approved-provider"')
    expect(source).toContain('<summary')
    expect(source).toContain('View categories')
    expect(source).toContain('Category-level approval')
    expect(source).not.toContain('<details open')
  })
})
